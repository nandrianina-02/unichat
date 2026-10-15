import type {
  AppareilConnecte,
  CarteProfil,
  ErreurApiCorps,
  EvenementSecurite,
  Groupe,
  MajProfil,
  Moi,
} from "@unichat/shared";

/** Erreur de l'API : un code pour le programme, un message prêt à afficher. */
export class ErreurApi extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly statut: number,
  ) {
    super(message);
  }
}

async function appel<T>(chemin: string, init: RequestInit = {}): Promise<T> {
  const enTetes = new Headers(init.headers);
  if (typeof init.body === "string") enTetes.set("Content-Type", "application/json");
  let reponse: Response;
  try {
    reponse = await fetch(`/api${chemin}`, { ...init, headers: enTetes, credentials: "same-origin" });
  } catch {
    throw new ErreurApi("reseau", "Connexion impossible. Vérifiez votre réseau, puis réessayez.", 0);
  }
  if (reponse.status === 204) return undefined as T;
  const corps = (await reponse.json().catch(() => null)) as (T & Partial<ErreurApiCorps>) | null;
  if (!reponse.ok) {
    throw new ErreurApi(
      corps?.erreur ?? "inconnue",
      corps?.message ?? "Une erreur est survenue. Réessayez dans un instant.",
      reponse.status,
    );
  }
  return corps as T;
}

const json = (methode: string, corps?: unknown): RequestInit => ({
  method: methode,
  body: corps === undefined ? undefined : JSON.stringify(corps),
});

export const api = {
  moi: () => appel<Moi>("/moi"),
  majProfil: (changements: MajProfil) => appel<Moi>("/moi", json("PATCH", changements)),
  pseudoDisponible: (pseudo: string, signal?: AbortSignal) =>
    appel<{ disponible: boolean; message?: string }>(`/moi/pseudo-disponible?p=${encodeURIComponent(pseudo)}`, { signal }),
  envoyerPhoto: (grande: Blob, petite: Blob) => {
    const formulaire = new FormData();
    formulaire.append("grande", grande, "grande");
    formulaire.append("petite", petite, "petite");
    return appel<Moi>("/moi/photo", { method: "PUT", body: formulaire });
  },
  supprimerPhoto: () => appel<Moi>("/moi/photo", { method: "DELETE" }),
  supprimerCompte: (confirmation: string) => appel<void>("/moi", json("DELETE", { confirmation })),

  rechercher: (texte: string, signal?: AbortSignal) =>
    appel<{ resultats: CarteProfil[] }>(`/recherche?q=${encodeURIComponent(texte)}`, { signal }),
  personne: (id: string) => appel<CarteProfil>(`/personnes/${encodeURIComponent(id)}`),
  contacts: () => appel<{ contacts: CarteProfil[] }>("/contacts"),
  ajouterContact: (id: string) => appel<CarteProfil>("/contacts", json("POST", { id })),
  retirerContact: (id: string) => appel<void>(`/contacts/${encodeURIComponent(id)}`, { method: "DELETE" }),

  appareils: () => appel<{ appareils: AppareilConnecte[] }>("/sessions"),
  deconnecterAppareil: (id: string) => appel<void>(`/sessions/${encodeURIComponent(id)}`, { method: "DELETE" }),
  deconnecterAutres: () => appel<{ nombre: number }>("/sessions/deconnecter-autres", { method: "POST" }),

  evenements: () => appel<{ evenements: EvenementSecurite[] }>("/securite/evenements"),
  alertes: () => appel<{ alertes: EvenementSecurite[] }>("/securite/alertes"),
  alertesVues: () => appel<void>("/securite/alertes/vues", { method: "POST" }),

  deconnexion: () => appel<void>("/auth/deconnexion", { method: "POST" }),

  groupes: () => appel<{ groupes: { id: string; nom: string }[] }>("/groupes"),
  groupe: (id: string) => appel<Groupe>(`/groupes/${encodeURIComponent(id)}`),
  creerGroupe: (nom: string, membres: string[]) => appel<Groupe>("/groupes", json("POST", { nom, membres })),
  majGroupe: (id: string, changements: { nom?: string; description?: string }) =>
    appel<Groupe>(`/groupes/${encodeURIComponent(id)}`, json("PATCH", changements)),
  ajouterMembres: (id: string, membres: string[]) =>
    appel<Groupe>(`/groupes/${encodeURIComponent(id)}/membres`, json("POST", { membres })),
  retirerMembre: (id: string, membre: string) =>
    appel<void>(`/groupes/${encodeURIComponent(id)}/membres/${encodeURIComponent(membre)}`, { method: "DELETE" }),
  nommerAdmin: (id: string, membre: string) =>
    appel<Groupe>(`/groupes/${encodeURIComponent(id)}/admins/${encodeURIComponent(membre)}`, { method: "POST" }),
};

export function urlPhoto(id: string, version: string, taille: "petite" | "grande"): string {
  return `/api/personnes/${encodeURIComponent(id)}/photo?taille=${taille}&v=${version}`;
}
