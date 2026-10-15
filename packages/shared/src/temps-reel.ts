import { z } from "zod";

/**
 * Protocole temps réel entre les applications et le serveur (WebSocket,
 * messages JSON). Le serveur ne garde un message que jusqu'à sa remise à
 * chaque appareil : l'historique vit sur les appareils.
 */

export const LIMITE_TEXTE = 4096;

/** Discussion à deux : identifiant stable, quel que soit l'ordre des participants. */
export function conversationDirecte(a: string, b: string): string {
  const [x, y] = [a, b].sort();
  return `d:${x}:${y}`;
}

export function autreParticipant(conversation: string, moi: string): string {
  const [, x, y] = conversation.split(":");
  return x === moi ? y! : x!;
}

export interface Message {
  id: string;
  conversation: string;
  de: string;
  a: string;
  texte: string;
  /** Heure du serveur à l'acceptation du message. */
  le: number;
}

export type EtatRemise = "remis" | "lu";

/** Élément du journal d'un utilisateur, numéroté : chaque appareil accuse réception jusqu'à un numéro. */
export type Entree =
  | { seq: number; type: "message"; message: Message }
  | { seq: number; type: "accuse"; conversation: string; ids: string[]; etat: EtatRemise; par: string; le: number }
  /** Messages lus sur un autre de mes appareils : les compteurs se mettent à jour partout. */
  | { seq: number; type: "lu"; conversation: string; ids: string[]; le: number };

const uuid = z.string().uuid();

export const schemaClient = z.discriminatedUnion("t", [
  /** Ouverture : l'appareil indique le dernier numéro reçu (null : appareil neuf). */
  z.object({ t: z.literal("bonjour"), depuis: z.number().int().nonnegative().nullable() }),
  z.object({ t: z.literal("recu"), jusqua: z.number().int().nonnegative() }),
  z.object({
    t: z.literal("envoyer"),
    id: uuid,
    a: uuid,
    texte: z
      .string()
      .max(LIMITE_TEXTE, `${LIMITE_TEXTE} caractères au maximum.`)
      .refine((t) => t.trim().length > 0, "Message vide."),
  }),
  z.object({ t: z.literal("lu"), avec: uuid, ids: z.array(uuid).min(1).max(500) }),
  z.object({ t: z.literal("ecrit"), a: uuid }),
  z.object({ t: z.literal("presence"), de: uuid }),
]);
export type MessageClient = z.infer<typeof schemaClient>;

export type MessageServeur =
  | { t: "lot"; entrees: Entree[]; fin: boolean }
  | { t: "entree"; entree: Entree }
  | { t: "accepte"; id: string; le: number }
  | { t: "refuse"; id?: string; message: string }
  | { t: "ecrit"; de: string }
  | { t: "presence"; de: string; enLigne: boolean; vuLe: number | null };

/** Code de fermeture : la session de l'appareil n'est plus valable. */
export const FERMETURE_SESSION = 4001;
