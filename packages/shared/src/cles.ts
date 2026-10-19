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
/** Un code de liaison vaut cinq minutes ; l'inscription qui suit a cinq minutes de plus. */
export const LIAISON = { duree: 5 * 60 * 1000, inscription: 5 * 60 * 1000 } as const;
const canal = z.string().regex(/^[A-Za-z0-9_-]{22}$/, "Code de liaison invalide.");
// Identité scellée : quelques centaines d'octets en base64.
const scelle = z.string().regex(/^[A-Za-z0-9_-]{40,2000}$/, "Clés scellées invalides.");

export const schemaNouvelleLiaison = z.object({ role: z.enum(["donneur", "receveur"]) }).strict();
export const schemaReponseLiaison = z.object({ cle, preuve: octets(32), cles: scelle.optional() }).strict();
export const schemaClesLiaison = z.object({ cles: scelle }).strict();
/** Appareil relié : il s'inscrit au nom de la liaison qui lui a remis l'identité. */
export const schemaAppareilRelie = z
  .object({ canal, appareil: z.object({ cleSignee: schemaCleSignee, clesUniques, jeton: cle }).strict() })
  .strict();

/**
 * Historique transmis à l'appareil relié (lot 8) : une archive chiffrée sur
 * le donneur, déposée en morceaux de 512 Kio (en base64, ce qu'une requête
 * traite en quelques millisecondes), et gardée moins d'une heure.
 */
export const HISTORIQUE = { morceau: 512 * 1024, morceauxMax: 32, duree: 50 * 60 * 1000 } as const;
/** Un morceau en base64 « URL » : la taille du morceau, un tiers en plus. */
export const schemaMorceauHistorique = z
  .string()
  .min(1)
  .max(Math.ceil((HISTORIQUE.morceau * 4) / 3), "Morceau d'historique trop gros.")
  .regex(/^[A-Za-z0-9_-]+$/, "Morceau d'historique mal formé.");
export const schemaFinHistorique = z
  .object({ morceaux: z.number().int().min(0).max(HISTORIQUE.morceauxMax), cle: scelle.optional() })
  .strict()
  .refine((h) => h.morceaux === 0 || h.cle, "La clé de l'historique manque.");

export interface EtatHistorique {
  /** attente : le donneur dépose encore (ou n'a pas commencé) ; pret : tout est là. */
  etat: "attente" | "pret";
  /** Morceaux déjà déposés : l'appareil qui attend voit que l'envoi avance. */
  deposes: number;
  morceaux?: number;
  /** Clé de l'archive, scellée sous la clé de la liaison. */
  cle?: string;
}

export interface EtatLiaison {
  /** attente : code affiché ; repondu : l'autre appareil a lu ; cles : identité déposée ; termine : appareil inscrit. */
  etat: "attente" | "repondu" | "cles" | "termine";
  role: "donneur" | "receveur";
  expireLe: number;
  reponse?: { cle: string; preuve: string };
  cles?: string;
  /** L'autre appareil, tel qu'il s'est présenté (« Chrome sur Android »). */
  autre?: string;
}

export const schemaDemandePaquets = z
  .object({
    comptes: z
      .array(z.object({ id: z.string().uuid(), appareils: z.array(numero).max(20).optional() }).strict())
      .min(1)
      .max(PAQUETS_MAX),
  })
  .strict();

/** Appareils inscrits de quelques comptes, sans consommer de clé unique. */
export const schemaListeAppareils = z.object({ comptes: z.array(z.string().uuid()).min(1).max(PAQUETS_MAX) }).strict();

export interface AppareilsCompte {
  id: string;
  identite: IdentiteCles & { version: number };
  appareils: number[];
}

export type IdentiteCles = z.infer<typeof schemaIdentiteCles>;
export type CleSigneeTransport = z.infer<typeof schemaCleSignee>;
export type CleUniqueTransport = z.infer<typeof schemaCleUnique>;
export type InscriptionCles = z.infer<typeof schemaInscriptionCles>;

export interface EtatCles {
  identite: (IdentiteCles & { version: number }) | null;
  /** Appareils du compte qui détiennent l'identité : sans aucun, il ne reste qu'à la refaire. */
  appareilsInscrits: number;
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
