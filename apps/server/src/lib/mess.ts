/**
 * Client de Mess, le service SMS (codes de vérification).
 *
 * Mess tire le code, l'envoie et le vérifie : UniChat ne le voit jamais, il
 * ne garde que l'identifiant de la demande. La clé d'API reste sur le
 * serveur (secret MESS_CLE).
 */

export interface ConfigMess {
  url: string;
  cle: string;
}

export class ErreurMess extends Error {
  constructor(
    message: string,
    readonly statut: number,
    readonly code: string,
  ) {
    super(message);
  }
}

async function appel<T>(recuperer: typeof fetch, config: ConfigMess, chemin: string, corps: unknown): Promise<T> {
  let reponse: Response;
  try {
    reponse = await recuperer(`${config.url.replace(/\/$/, "")}/v1${chemin}`, {
      method: "POST",
      headers: { Authorization: `Bearer ${config.cle}`, "Content-Type": "application/json" },
      body: JSON.stringify(corps),
    });
  } catch (e) {
    throw new ErreurMess(`Le service SMS ne répond pas (${e instanceof Error ? e.message : String(e)}).`, 502, "injoignable");
  }
  const donnees = (await reponse.json().catch(() => null)) as (T & { erreur?: string; message?: string }) | null;
  if (!reponse.ok) throw new ErreurMess(donnees?.message ?? `Mess a répondu ${reponse.status}.`, reponse.status, donnees?.erreur ?? "inconnu");
  return donnees as T;
}

export interface DemandeMess {
  id: string;
  expireLe: number;
}

export function demanderCode(recuperer: typeof fetch, config: ConfigMess, numero: string): Promise<DemandeMess> {
  return appel<DemandeMess>(recuperer, config, "/codes", { a: numero, service: "UniChat", duree: 600 });
}

export type ResultatMess =
  | { valide: true; destinataire: string }
  | { valide: false; raison: "incorrect" | "expire" | "trop_d_essais" | "deja_utilise"; essaisRestants?: number };

export function verifierCode(recuperer: typeof fetch, config: ConfigMess, demande: string, code: string): Promise<ResultatMess> {
  return appel<ResultatMess>(recuperer, config, `/codes/${encodeURIComponent(demande)}/verifier`, { code });
}
