import { ErreurApi } from "./api";

/** Ouvre un envoi : le serveur vérifie la discussion, le type et la taille avant d'accepter. */
export async function identifiantsEnvoi(
  conversation: string,
  f: { nom: string; mime: string; blob: Blob },
): Promise<{ id: string; tailleMorceau: number }> {
  const reponse = await fetch("/api/medias", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    credentials: "same-origin",
    body: JSON.stringify({ conversation, nom: f.nom, mime: f.mime, taille: f.blob.size }),
  }).catch(() => {
    throw new ErreurApi("reseau", "Connexion impossible. Vérifiez votre réseau.", 0);
  });
  const corps = (await reponse.json().catch(() => null)) as { id?: string; tailleMorceau?: number; erreur?: string; message?: string } | null;
  if (!reponse.ok || !corps?.id) {
    throw new ErreurApi(corps?.erreur ?? "envoi", corps?.message ?? "L'envoi n'a pas pu commencer.", reponse.status);
  }
  return { id: corps.id, tailleMorceau: corps.tailleMorceau ?? 0 };
}

export async function telechargerMedia(mediaId: string): Promise<Blob> {
  const reponse = await fetch(`/api/medias/${encodeURIComponent(mediaId)}`, { credentials: "same-origin" }).catch(() => {
    throw new ErreurApi("reseau", "Connexion impossible. Vérifiez votre réseau.", 0);
  });
  if (!reponse.ok) {
    const corps = (await reponse.json().catch(() => null)) as { erreur?: string; message?: string } | null;
    throw new ErreurApi(corps?.erreur ?? "telechargement", corps?.message ?? "Le fichier n'a pas pu être téléchargé.", reponse.status);
  }
  return reponse.blob();
}

export async function retirerMedia(mediaId: string): Promise<void> {
  await fetch(`/api/medias/${encodeURIComponent(mediaId)}`, { method: "DELETE", credentials: "same-origin" }).catch(() => {});
}
