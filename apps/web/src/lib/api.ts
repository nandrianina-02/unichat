import type {
  ActionAdmin,
  ApercuInvitation,
  AppareilsCompte,
  ApercuLien,
  AppareilConnecte,
  CarteProfil,
  CleSigneeTransport,
  CleUniqueTransport,
  Decision,
  ErreurApiCorps,
  EtatCles,
  EtatHistorique,
  EtatLiaison,
  FicheAdmin,
  InscriptionCles,
  PaquetsCompte,
  SignalementAdmin,
  TableauAdmin,
  UtilisateurAdmin,
  EvenementSecurite,
  Groupe,
  MajProfil,
  Moi,
  Signalement,
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
  bloques: () => appel<{ bloques: CarteProfil[] }>("/blocages"),
  bloquer: (id: string) => appel<CarteProfil>("/blocages", json("POST", { id })),
  debloquer: (id: string) => appel<CarteProfil>(`/blocages/${encodeURIComponent(id)}`, { method: "DELETE" }),
  signaler: (signalement: Signalement) => appel<void>("/signalements", json("POST", signalement)),
  apercu: (url: string, signal?: AbortSignal) => appel<ApercuLien>(`/apercu?url=${encodeURIComponent(url)}`, { signal }),

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
  envoyerPhotoGroupe: (id: string, grande: Blob, petite: Blob) => {
    const formulaire = new FormData();
    formulaire.append("grande", grande, "grande");
    formulaire.append("petite", petite, "petite");
    return appel<Groupe>(`/groupes/${encodeURIComponent(id)}/photo`, { method: "PUT", body: formulaire });
  },
  supprimerPhotoGroupe: (id: string) => appel<Groupe>(`/groupes/${encodeURIComponent(id)}/photo`, { method: "DELETE" }),
  invitationGroupe: (id: string) => appel<{ code: string }>(`/groupes/${encodeURIComponent(id)}/invitation`),
  reinitialiserInvitation: (id: string) => appel<{ code: string }>(`/groupes/${encodeURIComponent(id)}/invitation`, { method: "POST" }),
  apercuInvitation: (code: string) => appel<ApercuInvitation>(`/invitations/${encodeURIComponent(code)}`),
  rejoindre: (code: string) => appel<Groupe>(`/invitations/${encodeURIComponent(code)}`, { method: "POST" }),
  nommerAdmin: (id: string, membre: string) =>
    appel<Groupe>(`/groupes/${encodeURIComponent(id)}/admins/${encodeURIComponent(membre)}`, { method: "POST" }),

  etatCles: () => appel<EtatCles>("/cles"),
  inscrireCles: (inscription: InscriptionCles) => appel<EtatCles>("/cles/identite", json("POST", inscription)),
  reprendreCles: (numero: number, jeton: string) => appel<EtatCles>("/cles/reprendre", json("POST", { numero, jeton })),
  ajouterClesUniques: (cles: CleUniqueTransport[]) => appel<EtatCles>("/cles/uniques", json("POST", { cles })),
  publierCleSignee: (cleSignee: CleSigneeTransport) => appel<EtatCles>("/cles/signee", json("PUT", { cleSignee })),
  paquets: (comptes: { id: string; appareils?: number[] }[]) => appel<{ comptes: PaquetsCompte[] }>("/cles/paquets", json("POST", { comptes })),
  appareilsCles: (comptes: string[]) => appel<{ comptes: AppareilsCompte[] }>("/cles/appareils", json("POST", { comptes })),
  creerLiaison: (role: "donneur" | "receveur") => appel<{ canal: string; expireLe: number }>("/cles/liaisons", json("POST", { role })),
  liaison: (canal: string) => appel<EtatLiaison>(`/cles/liaisons/${encodeURIComponent(canal)}`),
  repondreLiaison: (canal: string, reponse: { cle: string; preuve: string; cles?: string }) =>
    appel<EtatLiaison>(`/cles/liaisons/${encodeURIComponent(canal)}/reponse`, json("POST", reponse)),
  deposerCles: (canal: string, cles: string) => appel<EtatLiaison>(`/cles/liaisons/${encodeURIComponent(canal)}/cles`, json("POST", { cles })),
  // Historique pour l'appareil relié (lot 8) : des morceaux en base64, envoyés tels quels (pas en JSON).
  deposerMorceauHistorique: (canal: string, indice: number, texte: string) =>
    appel<void>(`/cles/liaisons/${encodeURIComponent(canal)}/historique/${indice}`, { method: "PUT", body: new Blob([texte], { type: "text/plain" }) }),
  finirHistorique: (canal: string, fin: { morceaux: number; cle?: string }) => appel<void>(`/cles/liaisons/${encodeURIComponent(canal)}/historique`, json("POST", fin)),
  etatHistorique: (canal: string) => appel<EtatHistorique>(`/cles/liaisons/${encodeURIComponent(canal)}/historique`),
  morceauHistorique: async (canal: string, indice: number): Promise<string> => {
    const reponse = await fetch(`/api/cles/liaisons/${encodeURIComponent(canal)}/historique/${indice}`, { credentials: "same-origin" });
    if (!reponse.ok) throw new ErreurApi("historique", "L'historique n'a pas pu être téléchargé.", reponse.status);
    return reponse.text();
  },
  supprimerHistorique: (canal: string) => appel<void>(`/cles/liaisons/${encodeURIComponent(canal)}/historique`, { method: "DELETE" }),
  relierAppareil: (canal: string, appareil: InscriptionCles["appareil"]) => appel<EtatCles>("/cles/appareil", json("POST", { canal, appareil })),
  reinitialiserCles: (inscription: InscriptionCles) => appel<EtatCles>("/cles/reinitialisation", json("POST", inscription)),

  admin: {
    tableau: () => appel<TableauAdmin>("/admin/tableau"),
    utilisateurs: (q: string, filtre: "tous" | "signales" | "suspendus", avant?: number) =>
      appel<{ utilisateurs: UtilisateurAdmin[]; suite: number | null }>(
        `/admin/utilisateurs?${new URLSearchParams({ q, ...(filtre !== "tous" ? { filtre } : {}), ...(avant ? { avant: String(avant) } : {}) })}`,
      ),
    fiche: (id: string) => appel<FicheAdmin>(`/admin/utilisateurs/${encodeURIComponent(id)}`),
    suspendre: (id: string, motif: string) => appel<FicheAdmin>(`/admin/utilisateurs/${encodeURIComponent(id)}/suspension`, json("POST", { motif })),
    leverSuspension: (id: string) => appel<FicheAdmin>(`/admin/utilisateurs/${encodeURIComponent(id)}/suspension`, { method: "DELETE" }),
    deconnecter: (id: string) => appel<FicheAdmin>(`/admin/utilisateurs/${encodeURIComponent(id)}/deconnexion`, { method: "POST" }),
    supprimer: (id: string, confirmation: string) => appel<void>(`/admin/utilisateurs/${encodeURIComponent(id)}`, json("DELETE", { confirmation })),
    signalements: (etat: "ouverts" | "traites") => appel<{ signalements: SignalementAdmin[] }>(`/admin/signalements?etat=${etat}`),
    decider: (id: string, decision: Decision, motif?: string) =>
      appel<void>(`/admin/signalements/${encodeURIComponent(id)}/decision`, json("POST", { decision, ...(motif ? { motif } : {}) })),
    fermerGroupe: (id: string, motif: string) => appel<void>(`/admin/groupes/${encodeURIComponent(id)}/fermeture`, json("POST", { motif })),
    journal: (avant?: number) => appel<{ actions: ActionAdmin[]; suite: number | null }>(`/admin/journal${avant ? `?avant=${avant}` : ""}`),
  },
};

export function urlPhoto(id: string, version: string, taille: "petite" | "grande"): string {
  return `/api/personnes/${encodeURIComponent(id)}/photo?taille=${taille}&v=${version}`;
}

export function urlPhotoGroupe(id: string, version: string, taille: "petite" | "grande"): string {
  return `/api/groupes/${encodeURIComponent(id)}/photo?taille=${taille}&v=${version}`;
}
