import { z } from "zod";

const base64url = z.string().regex(/^[A-Za-z0-9_-]+$/, "Clé invalide.");

/** Abonnement Web Push tel que le donne le navigateur (PushSubscription.toJSON()). */
export const schemaAbonnementPush = z.object({
  endpoint: z.string().url().max(1000),
  expirationTime: z.number().nullable().optional(),
  keys: z.object({ p256dh: base64url.min(80).max(100), auth: base64url.min(16).max(30) }),
});
