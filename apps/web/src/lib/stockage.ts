import type { CarteProfil, Citation, EvenementGroupe, Groupe, MediaMessage, Preference, Reaction } from "@unichat/shared";
import { openDB, type DBSchema, type IDBPDatabase, type IDBPTransaction } from "idb";

export type EtatMessage = "attente" | "envoye" | "remis" | "lu" | "echec";

/** Un message tel qu'il est gardé sur l'appareil : c'est ici que vit l'historique. */
export interface MessageLocal {
  id: string;
  conversation: string;
  de: string;
  a: string;
  texte: string;
  le: number;
  /** « evenement » : ligne système d'un groupe (création, ajout, départ…). */
  type?: "texte" | "evenement";
  evenement?: EvenementGroupe;
  reponseA?: Citation;
  /** Fichier joint. Son identifiant reste vide tant que l'envoi n'est pas terminé. */
  media?: MediaMessage;
  /** Réactions, par personne. */
  reactions?: Record<string, Reaction>;
  /** Supprimé pour tout le monde par son auteur. */
  supprime?: boolean;
  /** Pour mes messages : où en est la remise. */
  etat?: EtatMessage;
  erreur?: string;
  /** Groupe : nombre de destinataires, et qui a reçu ou lu. */
  attendus?: number;
  remisPar?: string[];
  luPar?: string[];
  /** Pour les messages reçus : lu sur l'un de mes appareils. */
  lu?: boolean;
}

export interface ConversationLocale {
  id: string;
  /** Discussion à deux : l'autre personne. Groupe : l'identifiant du groupe. */
  autre: string;
  dernier: {
    id: string;
    texte: string;
    le: number;
    de: string;
    deMoi: boolean;
    etat?: EtatMessage;
    supprime?: boolean;
    evenement?: EvenementGroupe;
    media?: { type: MediaMessage["type"]; nom: string; duree?: number; vocal?: boolean };
  } | null;
  nonLus: number;
  /** Effacée (sans être supprimée) : elle reste dans la liste, à cette date. */
  videeLe?: number;
  /** Sourdine, favori, archive, épingle : réglages propres à moi, partagés entre mes appareils. */
  reglages?: ReglagesDiscussion;
}

export type ReglagesDiscussion = Pick<Preference, "muetJusqua" | "favori" | "archive" | "epingle">;

export interface PersonneLocale extends CarteProfil {
  maj: number;
}

export interface GroupeLocal extends Groupe {
  maj: number;
}

/** Contenu d'un fichier gardé sur l'appareil, rangé sous l'identifiant du message. */
export interface FichierLocal {
  id: string;
  blob: Blob;
}

export interface Schema extends DBSchema {
  messages: { key: string; value: MessageLocal; indexes: { conversation: [string, number]; etat: string } };
  conversations: { key: string; value: ConversationLocale };
  personnes: { key: string; value: PersonneLocale };
  groupes: { key: string; value: GroupeLocal };
  fichiers: { key: string; value: FichierLocal };
  reglages: { key: string; value: unknown };
}

export type Stockage = IDBPDatabase<Schema>;
export type TransactionMessages = IDBPTransaction<Schema, ["messages", "conversations"], "readwrite">;

/** Une base par compte : deux comptes sur le même navigateur ne se mélangent pas. */
export function ouvrirStockage(utilisateurId: string): Promise<Stockage> {
  return openDB<Schema>(`unichat-${utilisateurId}`, 3, {
    upgrade(db, ancienne) {
      if (ancienne < 1) {
        const messages = db.createObjectStore("messages", { keyPath: "id" });
        messages.createIndex("conversation", ["conversation", "le"]);
        messages.createIndex("etat", "etat");
        db.createObjectStore("conversations", { keyPath: "id" });
        db.createObjectStore("personnes", { keyPath: "id" });
        db.createObjectStore("reglages");
      }
      // Version 2 : les groupes. L'historique déjà présent est conservé.
      if (ancienne < 2) db.createObjectStore("groupes", { keyPath: "id" });
      // Version 3 : les fichiers reçus et envoyés, gardés sur l'appareil.
      if (ancienne < 3) db.createObjectStore("fichiers", { keyPath: "id" });
    },
  });
}

export const plageConversation = (conversation: string) =>
  IDBKeyRange.bound([conversation, -Infinity], [conversation, Infinity]);
