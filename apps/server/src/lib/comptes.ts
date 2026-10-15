import { INFOS_PAR_DEFAUT, LIMITES } from "@unichat/shared";
import type { IdentiteGoogle } from "./google";
import { importerPhotoGoogle } from "./photos";
import type { LigneUtilisateur } from "./profils";

/**
 * Compte rattaché à l'identifiant Google (`sub`), jamais à l'adresse : une
 * adresse peut être supprimée puis réattribuée à quelqu'un d'autre.
 */
export async function trouverOuCreerCompte(
  db: D1Database,
  recuperer: typeof fetch,
  identite: IdentiteGoogle,
  maintenant: number,
): Promise<string> {
  const nouvelId = crypto.randomUUID();
  // ON CONFLICT : deux premières connexions simultanées ne créent pas deux comptes.
  const cree = await db
    .prepare(
      `INSERT INTO utilisateurs (id, google_sub, email, nom, infos, cree_le)
       VALUES (?1, ?2, ?3, ?4, ?5, ?6)
       ON CONFLICT (google_sub) DO NOTHING`,
    )
    .bind(nouvelId, identite.sub, identite.email, identite.nom.slice(0, LIMITES.nom), INFOS_PAR_DEFAUT, maintenant)
    .run();

  if (cree.meta.changes === 1) {
    if (identite.photo) {
      await importerPhotoGoogle(db, recuperer, nouvelId, identite.photo, maintenant).catch((erreur) =>
        console.warn("photo Google non importée", String(erreur)),
      );
    }
    return nouvelId;
  }

  const existant = await db
    .prepare("SELECT id, email FROM utilisateurs WHERE google_sub = ?1")
    .bind(identite.sub)
    .first<Pick<LigneUtilisateur, "id" | "email">>();
  if (!existant) throw new Error("compte introuvable après création");
  if (existant.email !== identite.email) {
    await db.prepare("UPDATE utilisateurs SET email = ?1 WHERE id = ?2").bind(identite.email, existant.id).run();
  }
  return existant.id;
}

export async function lireUtilisateur(db: D1Database, id: string): Promise<LigneUtilisateur | null> {
  return db.prepare("SELECT * FROM utilisateurs WHERE id = ?1").bind(id).first<LigneUtilisateur>();
}
