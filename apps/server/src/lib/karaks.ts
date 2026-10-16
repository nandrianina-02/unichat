/**
 * Client de Karaks Storage (stockage des fichiers joints).
 *
 * La clé d'API ne quitte jamais le serveur : les navigateurs envoient leurs
 * morceaux à UniChat, qui les relaie ; ils téléchargent par UniChat, qui
 * vérifie qu'ils participent à la discussion avant de demander un lien
 * temporaire.
 */

export interface ConfigKaraks {
  url: string;
  cle: string;
}

export class ErreurKaraks extends Error {
  constructor(
    message: string,
    readonly statut: number,
  ) {
    super(message);
  }
}

async function appel<T>(recuperer: typeof fetch, config: ConfigKaraks, chemin: string, init: RequestInit = {}): Promise<T> {
  const enTetes = new Headers(init.headers);
  enTetes.set("Authorization", `Bearer ${config.cle}`);
  const reponse = await recuperer(`${config.url.replace(/\/$/, "")}/api/v1${chemin}`, { ...init, headers: enTetes });
  const corps = (await reponse.json().catch(() => null)) as (T & { error?: { message?: string } }) | null;
  if (!reponse.ok) throw new ErreurKaraks(corps?.error?.message ?? `Karaks Storage a répondu ${reponse.status}`, reponse.status);
  return corps as T;
}

export interface FichierKaraks {
  id: string;
  size: number;
  mimeType: string;
}

export async function ouvrirEnvoi(
  recuperer: typeof fetch,
  config: ConfigKaraks,
  p: { nom: string; mime: string; taille: number },
): Promise<string> {
  const r = await appel<{ upload: { id: string } }>(recuperer, config, "/uploads", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name: p.nom, mimeType: p.mime, size: p.taille }),
  });
  return r.upload.id;
}

/** Un morceau ; renvoie le fichier quand l'envoi est complet, et le nombre d'octets reçus. */
export async function envoyerMorceau(
  recuperer: typeof fetch,
  config: ConfigKaraks,
  envoiId: string,
  plage: string,
  morceau: Uint8Array<ArrayBuffer>,
): Promise<{ recu: number; fichier: FichierKaraks | null }> {
  const r = await appel<{ upload: { received: number }; file: FichierKaraks | null }>(
    recuperer,
    config,
    `/uploads/${encodeURIComponent(envoiId)}`,
    { method: "PUT", headers: { "Content-Range": plage, "Content-Type": "application/octet-stream" }, body: morceau },
  );
  return { recu: r.upload.received, fichier: r.file };
}

export async function abandonnerEnvoi(recuperer: typeof fetch, config: ConfigKaraks, envoiId: string): Promise<void> {
  await appel(recuperer, config, `/uploads/${encodeURIComponent(envoiId)}`, { method: "DELETE" });
}

/** Lien temporaire de lecture : valable cinq minutes, demandé à chaque téléchargement. */
export async function lienTemporaire(recuperer: typeof fetch, config: ConfigKaraks, fichierId: string): Promise<string> {
  const r = await appel<{ url: string }>(recuperer, config, `/files/${encodeURIComponent(fichierId)}/signed-url`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ type: "stream", expiresIn: 300 }),
  });
  return r.url;
}

/** Suppression définitive : corbeille, puis effacement. */
export async function supprimerFichier(recuperer: typeof fetch, config: ConfigKaraks, fichierId: string): Promise<void> {
  const id = encodeURIComponent(fichierId);
  try {
    await appel(recuperer, config, `/files/${id}`, { method: "DELETE" });
  } catch (erreur) {
    if (!(erreur instanceof ErreurKaraks && erreur.statut === 404)) throw erreur;
    return;
  }
  await appel(recuperer, config, `/files/${id}/permanent`, { method: "DELETE" });
}
