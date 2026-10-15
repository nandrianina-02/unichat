import { z } from "zod";

export const LIMITES_GROUPE = {
  nom: 100,
  description: 512,
  // Offre gratuite de Cloudflare : 50 sous-requêtes par opération. Un message
  // de groupe est relayé à la boîte de chaque membre ; 40 laisse de la marge
  // pour les lectures de la base. À relever avec une offre payante.
  membres: 40,
} as const;

export const schemaNomGroupe = z
  .string()
  .trim()
  .min(1, "Donnez un nom au groupe.")
  .max(LIMITES_GROUPE.nom, `${LIMITES_GROUPE.nom} caractères au maximum.`);

export const schemaCreationGroupe = z
  .object({
    nom: schemaNomGroupe,
    membres: z.array(z.string().uuid()).min(1, "Choisissez au moins une personne.").max(LIMITES_GROUPE.membres - 1),
  })
  .strict();

export const schemaMajGroupe = z
  .object({
    nom: schemaNomGroupe.optional(),
    description: z.string().trim().max(LIMITES_GROUPE.description, `${LIMITES_GROUPE.description} caractères au maximum.`).optional(),
  })
  .strict();

export const schemaAjoutMembres = z
  .object({ membres: z.array(z.string().uuid()).min(1, "Choisissez au moins une personne.").max(LIMITES_GROUPE.membres) })
  .strict();

export type RoleGroupe = "admin" | "membre";

export interface MembreGroupe {
  id: string;
  nom: string;
  pseudo: string | null;
  photo: string | null;
  role: RoleGroupe;
  estSoi: boolean;
}

export interface Groupe {
  id: string;
  nom: string;
  description: string;
  creeLe: number;
  /** Absent : je ne fais plus partie du groupe. */
  membres: MembreGroupe[];
  moiAdmin: boolean;
  moiMembre: boolean;
}

