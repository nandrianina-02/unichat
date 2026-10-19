import { z } from "zod";

const base64url = z.string().regex(/^[A-Za-z0-9_-]+$/, "Clé invalide.");

/** Abonnement Web Push tel que le donne le navigateur (PushSubscription.toJSON()). */
export const schemaAbonnementPush = z.object({
  endpoint: z.string().url().max(1000),
  expirationTime: z.number().nullable().optional(),
  keys: z.object({ p256dh: base64url.min(80).max(100), auth: base64url.min(16).max(30) }),
});

/**
 * Message chiffré joint à une notification (étape 3, lot 6) : l'appareil le
 * déchiffre lui-même pour en montrer le texte. Le serveur n'y met que ce
 * qu'il relaie déjà, l'enveloppe et la clé destinée à cet appareil-là.
 */
export interface NotificationChiffree {
  id: string;
  de: string;
  deAppareil: number;
  conversation: string;
  corps: string;
  cle: string;
}

export interface ContenuNotification {
  titre: string;
  corps: string;
  conversation: string;
  /** Compte destinataire : l'appareil ouvre sa base, propre à chaque compte. */
  pour?: string;
  /** Nom de l'auteur, pour préfixer le texte déchiffré dans un groupe. */
  auteur?: string;
  chiffre?: NotificationChiffree;
}

/** Au-delà, le message ne tient pas dans une notification (4 Ko, chiffrement compris) : elle part sans lui. */
export const NOTIFICATION_OCTETS_MAX = 3000;
