import { z } from "zod";
import { schemaMediaEnvoye, type MediaMessage } from "./medias";

/**
 * Protocole temps réel entre les applications et le serveur (WebSocket,
 * messages JSON). Le serveur ne garde un message que jusqu'à sa remise à
 * chaque appareil : l'historique vit sur les appareils.
 */

export const LIMITE_TEXTE = 4096;
export const LIMITE_EXTRAIT = 200;
/** Délai pendant lequel on peut supprimer un message pour tout le monde. */
export const DELAI_SUPPRESSION = 48 * 60 * 60 * 1000;
/** Délai pendant lequel on peut modifier un message envoyé, comme dans WhatsApp. */
export const DELAI_MODIFICATION = 15 * 60 * 1000;
/** Destinataires d'un même transfert : au-delà, c'est de la diffusion. */
export const TRANSFERT_MAX = 5;
/** Transféré au moins autant de fois : « Transféré plusieurs fois ». */
export const TRANSFERTS_NOMBREUX = 5;
/** Messages épinglés en haut d'une discussion. */
export const EPINGLES_MESSAGES_MAX = 3;
const JOUR = 24 * 60 * 60 * 1000;
export const DUREES_EPINGLE = [
  { libelle: "24 heures", duree: JOUR },
  { libelle: "7 jours", duree: 7 * JOUR },
  { libelle: "30 jours", duree: 30 * JOUR },
] as const;

// --- Discussions -----------------------------------------------------------------

/** Discussion à deux : identifiant stable, quel que soit l'ordre des participants. */
export function conversationDirecte(a: string, b: string): string {
  const [x, y] = [a, b].sort();
  return `d:${x}:${y}`;
}

export const conversationGroupe = (groupeId: string) => `g:${groupeId}`;
export const estGroupe = (conversation: string) => conversation.startsWith("g:");
export const idGroupe = (conversation: string) => conversation.slice(2);

export function autreParticipant(conversation: string, moi: string): string {
  const [, x, y] = conversation.split(":");
  return x === moi ? y! : x!;
}

const UUID = "[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}";
const motifConversation = new RegExp(`^(d:${UUID}:${UUID}|g:${UUID})$`, "i");

// --- Réactions -----------------------------------------------------------------------

/**
 * Réactions d'UniChat : des pictogrammes, pas des emoji. Le code voyage, chaque
 * application l'affiche avec son propre dessin.
 */
export const REACTIONS = ["pouce", "coeur", "rire", "bravo", "triste", "merci"] as const;
export type Reaction = (typeof REACTIONS)[number];

// --- Contenus ------------------------------------------------------------------------

/** Citation du message auquel on répond : copiée, pour rester lisible même si l'original manque. */
export interface Citation {
  id: string;
  de: string;
  extrait: string;
}

export interface Message {
  id: string;
  conversation: string;
  de: string;
  /** Destinataire : une personne, ou le groupe. */
  a: string;
  /** Texte, ou légende d'un fichier (peut alors être vide). */
  texte: string;
  media?: MediaMessage;
  /** Heure du serveur à l'acceptation du message. */
  le: number;
  reponseA?: Citation;
  /** Nombre de fois que ce contenu a été transféré avant d'arriver ici. */
  transfere?: number;
}

export type ActionGroupe = "creation" | "ajout" | "retrait" | "depart" | "renommage" | "description";

export interface EvenementGroupe {
  id: string;
  conversation: string;
  action: ActionGroupe;
  par: string;
  cibles: string[];
  nom?: string;
  le: number;
}

export type EtatRemise = "remis" | "lu";

/** Sourdine sans fin : une date que l'on n'atteindra pas. */
export const MUET_TOUJOURS = 8.64e15;

/**
 * Réglages d'une discussion qui ne regardent que moi (sourdine, favori,
 * archive, effacement). Ils passent par ma propre boîte pour que tous mes
 * appareils les appliquent ; les autres participants n'en savent rien.
 */
export const schemaPreference = z
  .object({
    /** Fin de la sourdine (ms), null pour rétablir le son. */
    muetJusqua: z.number().int().nonnegative().max(MUET_TOUJOURS).nullable().optional(),
    favori: z.boolean().optional(),
    archive: z.boolean().optional(),
    /** Épinglée en haut de la liste (trois au plus, comme WhatsApp). */
    epingle: z.boolean().optional(),
    /** Messages effacés jusqu'à cette date incluse. */
    effaceAvant: z.number().int().nonnegative().optional(),
    /** Discussion retirée de la liste ; elle revient au prochain message. */
    supprimee: z.boolean().optional(),
  })
  .strict()
  .refine((p) => Object.keys(p).length > 0, "Réglage vide.");
export type Preference = z.infer<typeof schemaPreference>;

/** Élément du journal d'un utilisateur, numéroté : chaque appareil accuse réception jusqu'à un numéro. */
export type Entree =
  | { seq: number; type: "message"; message: Message }
  | { seq: number; type: "accuse"; conversation: string; ids: string[]; etat: EtatRemise; par: string; le: number }
  /** Messages lus sur un autre de mes appareils : les compteurs se mettent à jour partout. */
  | { seq: number; type: "lu"; conversation: string; ids: string[]; le: number }
  | { seq: number; type: "reaction"; conversation: string; message: string; par: string; code: Reaction | null; le: number }
  | { seq: number; type: "suppression"; conversation: string; message: string; par: string; le: number }
  /** Message modifié par son auteur (dans les 15 minutes, vérifié par chaque application). */
  | { seq: number; type: "modification"; conversation: string; message: string; par: string; texte: string; le: number }
  /** Message épinglé (ou désépinglé avec null) pour tous les participants. */
  | { seq: number; type: "epingle"; conversation: string; message: string; par: string; jusqua: number | null; le: number }
  /** Message marqué important sur l'un de mes appareils : il l'est sur tous. */
  | { seq: number; type: "important"; conversation: string; message: string; important: boolean; le: number }
  | { seq: number; type: "groupe"; evenement: EvenementGroupe }
  /** Blocage ou déblocage fait sur l'un de mes appareils : les autres se mettent à jour. */
  | { seq: number; type: "blocage"; conversation: string; personne: string; bloque: boolean; le: number }
  | { seq: number; type: "preference"; conversation: string; preference: Preference; le: number };

// --- Messages des applications -----------------------------------------------------

const uuid = z.string().uuid();
const conversation = z.string().regex(motifConversation, "Discussion invalide.");

export const schemaClient = z.discriminatedUnion("t", [
  /** Ouverture : l'appareil indique le dernier numéro reçu (null : appareil neuf). */
  z.object({ t: z.literal("bonjour"), depuis: z.number().int().nonnegative().nullable() }),
  z.object({ t: z.literal("recu"), jusqua: z.number().int().nonnegative() }),
  z
    .object({
      t: z.literal("envoyer"),
      id: uuid,
      a: uuid.optional(),
      groupe: uuid.optional(),
      texte: z.string().max(LIMITE_TEXTE, `${LIMITE_TEXTE} caractères au maximum.`),
      media: schemaMediaEnvoye.optional(),
      reponseA: z.object({ id: uuid, de: uuid, extrait: z.string().max(LIMITE_EXTRAIT) }).optional(),
      transfere: z.number().int().min(1).max(10_000).optional(),
    })
    .refine((m) => Boolean(m.a) !== Boolean(m.groupe), "Destinataire manquant.")
    .refine((m) => m.texte.trim().length > 0 || m.media, "Message vide."),
  /** Messages lus, groupés par auteur : c'est lui qui verra « lu ». */
  z.object({ t: z.literal("lu"), conversation, auteur: uuid, ids: z.array(uuid).min(1).max(500) }),
  z.object({ t: z.literal("ecrit"), conversation }),
  z.object({ t: z.literal("presence"), de: uuid }),
  z.object({ t: z.literal("reagir"), conversation, message: uuid, code: z.enum(REACTIONS).nullable() }),
  z.object({ t: z.literal("supprimer"), conversation, message: uuid }),
  z.object({ t: z.literal("preference"), conversation, preference: schemaPreference }),
  z.object({
    t: z.literal("modifier"),
    conversation,
    message: uuid,
    texte: z.string().trim().min(1, "Message vide.").max(LIMITE_TEXTE, `${LIMITE_TEXTE} caractères au maximum.`),
  }),
  z.object({ t: z.literal("epingler"), conversation, message: uuid, jusqua: z.number().int().positive().nullable() }),
  z.object({ t: z.literal("important"), conversation, message: uuid, important: z.boolean() }),
]);
export type MessageClient = z.infer<typeof schemaClient>;

// --- Messages du serveur ------------------------------------------------------------

export type MessageServeur =
  | { t: "lot"; entrees: Entree[]; fin: boolean }
  | { t: "entree"; entree: Entree }
  /** `destinataires` : nombre de personnes qui doivent recevoir le message (groupe). */
  | { t: "accepte"; id: string; le: number; destinataires: number }
  | { t: "refuse"; id?: string; message: string }
  | { t: "ecrit"; de: string; conversation: string }
  | { t: "presence"; de: string; enLigne: boolean; vuLe: number | null };

/** Code de fermeture : la session de l'appareil n'est plus valable. */
export const FERMETURE_SESSION = 4001;
