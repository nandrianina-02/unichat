import { z } from "zod";
import { LIMITE_TEXTE } from "./temps-reel";

/** Messages joints à un signalement : les derniers de la personne ou du groupe, comme le fait WhatsApp. */
export const MESSAGES_SIGNALES = 5;

export const schemaBlocage = z.object({ id: z.string().uuid("Identifiant invalide.") }).strict();

/**
 * Signalement d'une personne ou d'un groupe. Le serveur ne garde pas les
 * messages : c'est l'application qui joint les derniers reçus, et seulement
 * ceux-là (jamais ceux de la personne qui signale).
 */
export const schemaSignalement = z
  .object({
    type: z.enum(["personne", "groupe"]),
    cible: z.string().uuid("Identifiant invalide."),
    messages: z
      .array(
        z
          .object({
            id: z.string().uuid(),
            de: z.string().uuid(),
            texte: z.string().max(LIMITE_TEXTE),
            le: z.number().int().nonnegative(),
            media: z.object({ type: z.enum(["image", "video", "audio", "document"]), nom: z.string().max(180) }).strict().optional(),
          })
          .strict(),
      )
      .max(MESSAGES_SIGNALES),
    /** Bloquer la personne dans la foulée (signalement d'une personne seulement). */
    bloquer: z.boolean().default(false),
  })
  .strict();
export type Signalement = z.input<typeof schemaSignalement>;
