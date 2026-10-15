import { z } from "zod";

// Mêmes longueurs que WhatsApp : 25 caractères pour le nom, 139 pour les infos.
export const LIMITES = {
  nom: 25,
  infos: 139,
  pseudoMin: 3,
  pseudoMax: 30,
  // Photos préparées dans le navigateur (640 px et 128 px) : ces plafonds
  // laissent de la marge tout en protégeant le quota D1.
  photoGrande: 300 * 1024,
  photoPetite: 48 * 1024,
  contacts: 2000,
} as const;

export const INFOS_PAR_DEFAUT = "Salut ! J'utilise UniChat.";

const PSEUDOS_RESERVES = new Set([
  "admin",
  "administrateur",
  "aide",
  "api",
  "contact",
  "equipe",
  "help",
  "info",
  "moderation",
  "null",
  "officiel",
  "root",
  "securite",
  "support",
  "systeme",
  "system",
  "unichat",
  "undefined",
  "www",
]);

export const schemaPseudo = z
  .string()
  .trim()
  .toLowerCase()
  .min(LIMITES.pseudoMin, `Au moins ${LIMITES.pseudoMin} caractères.`)
  .max(LIMITES.pseudoMax, `${LIMITES.pseudoMax} caractères au maximum.`)
  .regex(/^[a-z][a-z0-9._]*$/, "Lettres, chiffres, point ou tiret bas, en commençant par une lettre.")
  .refine((p) => !p.includes(".."), "Pas deux points à la suite.")
  .refine((p) => !p.endsWith("."), "Le nom d'utilisateur ne peut pas finir par un point.")
  .refine((p) => !PSEUDOS_RESERVES.has(p), "Ce nom d'utilisateur est réservé.");

export const schemaNom = z
  .string()
  .trim()
  .min(1, "Indiquez votre nom.")
  .max(LIMITES.nom, `${LIMITES.nom} caractères au maximum.`);

export const schemaInfos = z.string().trim().max(LIMITES.infos, `${LIMITES.infos} caractères au maximum.`);

export const VISIBILITES = ["tous", "contacts", "personne"] as const;
export const schemaVisibilite = z.enum(VISIBILITES);
export type Visibilite = z.infer<typeof schemaVisibilite>;

export const schemaMajProfil = z
  .object({
    nom: schemaNom.optional(),
    infos: schemaInfos.optional(),
    pseudo: schemaPseudo.optional(),
    visibilitePhoto: schemaVisibilite.optional(),
    visibiliteInfos: schemaVisibilite.optional(),
    trouvableParEmail: z.boolean().optional(),
  })
  .strict();
export type MajProfil = z.infer<typeof schemaMajProfil>;

export const schemaAjoutContact = z.object({ id: z.string().uuid("Identifiant invalide.") }).strict();

/** Recherche exacte : une adresse e-mail ou un nom d'utilisateur, jamais un fragment. */
export function lireRecherche(brute: string): { type: "email"; valeur: string } | { type: "pseudo"; valeur: string } | null {
  const texte = brute.trim().toLowerCase();
  if (!texte || texte.length > 254) return null;
  if (texte.includes("@") && !texte.startsWith("@")) {
    return z.string().email().safeParse(texte).success ? { type: "email", valeur: texte } : null;
  }
  const pseudo = schemaPseudo.safeParse(texte.replace(/^@/, ""));
  return pseudo.success ? { type: "pseudo", valeur: pseudo.data } : null;
}
