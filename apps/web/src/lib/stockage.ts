import type { CarteProfil } from "@unichat/shared";
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
  /** Pour mes messages : où en est la remise. */
  etat?: EtatMessage;
  erreur?: string;
  /** Pour les messages reçus : lu sur l'un de mes appareils. */
  lu?: boolean;
}

export interface ConversationLocale {
  id: string;
  autre: string;
  dernier: { id: string; texte: string; le: number; deMoi: boolean; etat?: EtatMessage } | null;
  nonLus: number;
}

export interface PersonneLocale extends CarteProfil {
  maj: number;
}

export interface Schema extends DBSchema {
  messages: { key: string; value: MessageLocal; indexes: { conversation: [string, number]; etat: string } };
  conversations: { key: string; value: ConversationLocale };
  personnes: { key: string; value: PersonneLocale };
  reglages: { key: string; value: unknown };
}

export type Stockage = IDBPDatabase<Schema>;
export type TransactionMessages = IDBPTransaction<Schema, ["messages", "conversations"], "readwrite">;

/** Une base par compte : deux comptes sur le même navigateur ne se mélangent pas. */
export function ouvrirStockage(utilisateurId: string): Promise<Stockage> {
  return openDB<Schema>(`unichat-${utilisateurId}`, 1, {
    upgrade(db) {
      const messages = db.createObjectStore("messages", { keyPath: "id" });
      messages.createIndex("conversation", ["conversation", "le"]);
      messages.createIndex("etat", "etat");
      db.createObjectStore("conversations", { keyPath: "id" });
      db.createObjectStore("personnes", { keyPath: "id" });
      db.createObjectStore("reglages");
    },
  });
}

export const plageConversation = (conversation: string) =>
  IDBKeyRange.bound([conversation, -Infinity], [conversation, Infinity]);
