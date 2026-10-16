import { z } from "zod";

/**
 * Annuaire des clés publiques (chiffrement de bout en bout, étape 3). Le
 * serveur ne reçoit jamais une clé privée : il range et redonne ce que les
 * appareils publient. Les signatures sont vérifiées par les applications, pas
 * par lui : un serveur malveillant ne pourrait de toute façon pas les forger.
 */

/** Clés uniques déposées par appareil : la réserve est refaite sous le seuil. */
export const CLES_UNIQUES = { lot: 100, maximum: 200, seuil: 40 } as const;
const JOUR = 24 * 60 * 60 * 1000;
/** La clé signée d'un appareil change chaque mois ; l'ancienne reste lisible un mois de plus. */
export const CLE_SIGNEE = { renouvellement: 30 * JOUR, conservation: 60 * JOUR } as const;
/** Un appareil qui ne s'est pas présenté depuis ce délai quitte l'annuaire. */
export const APPAREIL_INACTIF = 90 * JOUR;
/** Comptes dont on peut demander les clés d'un coup (un groupe, plus mes appareils). */
export const PAQUETS_MAX = 50;

// Base64 « URL » sans remplissage : 43 caractères pour 32 octets, 86 pour 64.
const octets = (n: number) => z.string().regex(new RegExp(`^[A-Za-z0-9_-]{${Math.ceil((n * 4) / 3)}}$`), "Clé mal formée.");
const cle = octets(32);
const numero = z.number().int().min(1).max(0x7fffffff);

export const schemaIdentiteCles = z.object({ signature: cle, echange: cle, preuve: octets(64) }).strict();
export const schemaCleSignee = z.object({ id: numero, cle, signature: octets(64) }).strict();
export const schemaCleUnique = z.object({ id: numero, cle }).strict();
const clesUniques = z
  .array(schemaCleUnique)
  .min(1)
  .max(CLES_UNIQUES.lot, `${CLES_UNIQUES.lot} clés au plus par envoi.`)
  .refine((liste) => new Set(liste.map((c) => c.id)).size === liste.length, "Numéros de clés en double.");

/** Premier appareil d'un compte : il crée l'identité et s'inscrit. */
export const schemaInscriptionCles = z
  .object({
    identite: schemaIdentiteCles,
    appareil: z.object({ cleSignee: schemaCleSignee, clesUniques, jeton: cle }).strict(),
  })
  .strict();

/** Un appareil déjà inscrit se présente à nouveau après une reconnexion. */
export const schemaRepriseCles = z.object({ numero, jeton: cle }).strict();
export const schemaClesUniques = z.object({ cles: clesUniques }).strict();
export const schemaNouvelleCleSignee = z.object({ cleSignee: schemaCleSignee }).strict();
export const schemaDemandePaquets = z
  .object({
    comptes: z
      .array(z.object({ id: z.string().uuid(), appareils: z.array(numero).max(20).optional() }).strict())
      .min(1)
      .max(PAQUETS_MAX),
  })
  .strict();

export type IdentiteCles = z.infer<typeof schemaIdentiteCles>;
export type CleSigneeTransport = z.infer<typeof schemaCleSignee>;
export type CleUniqueTransport = z.infer<typeof schemaCleUnique>;
export type InscriptionCles = z.infer<typeof schemaInscriptionCles>;

export interface EtatCles {
  identite: (IdentiteCles & { version: number }) | null;
  /** L'appareil de cette session, s'il est inscrit. */
  appareil: { numero: number; cleSigneeId: number; cleSigneeLe: number; clesUniques: number } | null;
}

export interface PaquetAppareil {
  numero: number;
  cleSignee: CleSigneeTransport;
  /** Absente quand la réserve de l'appareil est vide : X3DH s'en passe. */
  cleUnique?: CleUniqueTransport;
}

export interface PaquetsCompte {
  id: string;
  identite: IdentiteCles & { version: number };
  appareils: PaquetAppareil[];
}
