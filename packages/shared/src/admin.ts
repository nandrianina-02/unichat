import { z } from "zod";
import type { Plateforme } from "./types";

/**
 * Administration d'UniChat : comptes, signalements, groupes. Réservée aux
 * comptes désignés par le secret ADMINS du serveur. Le contenu des messages
 * n'y figure pas : le serveur ne le garde pas, sauf les messages qu'une
 * personne joint elle-même à un signalement.
 */

export const MOTIF_SUSPENSION_MAX = 300;
/** Supprimer un compte ou fermer un groupe : session ouverte avec Google depuis moins de 24 heures. */
export const CONNEXION_RECENTE = 24 * 60 * 60 * 1000;
export const PAGE_ADMIN = 50;

export const schemaSuspension = z
  .object({ motif: z.string().trim().min(3, "Indiquez le motif de la suspension.").max(MOTIF_SUSPENSION_MAX) })
  .strict();

export const DECISIONS = ["classe", "suspendu", "groupe_ferme"] as const;
export type Decision = (typeof DECISIONS)[number];

export const schemaDecision = z
  .object({
    decision: z.enum(DECISIONS),
    /** Motif de la suspension ou de la fermeture, montré dans le journal. */
    motif: z.string().trim().min(3, "Indiquez le motif.").max(MOTIF_SUSPENSION_MAX).optional(),
  })
  .strict()
  .refine((d) => d.decision === "classe" || d.motif, "Indiquez le motif.");

/** Recopier le nom d'utilisateur visé : une suppression ne part pas d'un clic égaré. */
export const schemaSuppressionAdmin = z.object({ confirmation: z.string().trim().min(1) }).strict();
export const schemaFermetureGroupe = z.object({ motif: z.string().trim().min(3, "Indiquez le motif.").max(MOTIF_SUSPENSION_MAX) }).strict();

export interface TableauAdmin {
  comptes: number;
  /** Inscription commencée sans nom d'utilisateur choisi. */
  inacheves: number;
  nouveaux7j: number;
  actifs24h: number;
  actifs7j: number;
  appareils: number;
  groupes: number;
  fichiers: number;
  octetsFichiers: number;
  signalementsOuverts: number;
  suspendus: number;
  abonnementsPush: number;
  comptesChiffres: number;
  /** Taille de la base D1, pour la comparer aux 500 Mo de l'offre gratuite. */
  octetsBase: number;
  /** Inscriptions des 14 derniers jours, du plus ancien au plus récent (jour UTC, en ms). */
  inscriptions: { jour: number; nombre: number }[];
}

export interface UtilisateurAdmin {
  id: string;
  nom: string;
  pseudo: string | null;
  email: string;
  creeLe: number;
  vuLe: number | null;
  appareils: number;
  signalements: number;
  suspenduLe: number | null;
  admin: boolean;
}

export interface FicheAdmin extends UtilisateurAdmin {
  infos: string;
  motifSuspension: string | null;
  sessions: { id: string; plateforme: Plateforme; appareil: string; ville: string | null; pays: string | null; creeLe: number; vuLe: number }[];
  groupes: { id: string; nom: string; role: "admin" | "membre"; membres: number }[];
  contacts: number;
  signalementsFaits: number;
  recus: SignalementAdmin[];
}

export interface MessageSignale {
  id: string;
  de: string;
  texte: string;
  le: number;
  media?: { type: string; nom: string };
}

export interface SignalementAdmin {
  id: string;
  type: "personne" | "groupe";
  creeLe: number;
  auteur: { id: string; nom: string; pseudo: string | null } | null;
  cible: { id: string; nom: string; pseudo?: string | null; suspenduLe?: number | null; admin?: boolean; membres?: number; existe: boolean };
  messages: MessageSignale[];
  /** Noms des auteurs des messages joints (groupe : plusieurs membres). */
  auteurs: Record<string, string>;
  /** Signalements ouverts sur la même cible, celui-ci compris. */
  surLaCible: number;
  traiteLe: number | null;
  decision: Decision | null;
  traitePar: string | null;
}

export type ActionAdministration =
  | "suspension"
  | "suspension_levee"
  | "deconnexion"
  | "suppression_compte"
  | "fermeture_groupe"
  | "signalement_classe";

export interface ActionAdmin {
  id: string;
  adminNom: string;
  action: ActionAdministration;
  cibleType: "utilisateur" | "groupe" | "signalement";
  cibleId: string;
  cibleNom: string | null;
  detail: string | null;
  creeLe: number;
}
