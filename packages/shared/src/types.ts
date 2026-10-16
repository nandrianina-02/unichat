import type { AjoutGroupes, Visibilite, VisibiliteEnLigne } from "./profil";

export type Plateforme = "web" | "android" | "desktop";

/** Le compte connecté, tel que le voit son propriétaire. */
export interface Moi {
  id: string;
  email: string;
  nom: string;
  /** Absent tant que l'accueil n'est pas terminé. */
  pseudo: string | null;
  infos: string;
  /** Version de la photo (sert à invalider le cache), absente sans photo. */
  photo: string | null;
  visibilitePhoto: Visibilite;
  visibiliteInfos: Visibilite;
  trouvableParEmail: boolean;
  /** Qui voit ma dernière connexion ; « personne » m'empêche aussi de voir celle des autres. */
  visibiliteVu: Visibilite;
  enLigne: VisibiliteEnLigne;
  /** Désactivées : je n'envoie ni ne vois les confirmations de lecture (discussions à deux). */
  confirmationsLecture: boolean;
  ajoutGroupes: AjoutGroupes;
  sessionId: string;
}

/** Une autre personne, réduite à ce que ses réglages de confidentialité laissent voir. */
export interface CarteProfil {
  id: string;
  nom: string;
  pseudo: string | null;
  infos: string | null;
  photo: string | null;
  estContact: boolean;
  estSoi: boolean;
  /** Je l'ai bloquée. L'inverse n'est jamais révélé : la personne bloquée n'en est pas avertie. */
  bloque: boolean;
}

export interface AppareilConnecte {
  id: string;
  plateforme: Plateforme;
  appareil: string;
  ville: string | null;
  pays: string | null;
  creeLe: number;
  vuLe: number;
  actuel: boolean;
}

export type TypeEvenement = "connexion" | "deconnexion" | "session_revoquee" | "reutilisation_jeton" | "pseudo_modifie";

export interface EvenementSecurite {
  id: string;
  type: TypeEvenement;
  sessionId: string | null;
  appareil: string | null;
  ville: string | null;
  pays: string | null;
  creeLe: number;
  /** Pour une connexion : l'appareil est-il encore connecté ? */
  sessionActive: boolean;
}

/** Réponse d'erreur de l'API : un code stable pour le programme, un message pour la personne. */
export interface ErreurApiCorps {
  erreur: string;
  message: string;
}
