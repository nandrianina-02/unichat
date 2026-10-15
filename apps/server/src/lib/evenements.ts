import type { TypeEvenement } from "@unichat/shared";

export interface NouvelEvenement {
  utilisateurId: string;
  type: TypeEvenement;
  sessionId: string | null;
  appareil: string | null;
  ville: string | null;
  pays: string | null;
  maintenant: number;
}

/** Instruction préparée, à exécuter seule ou dans un lot avec l'action qu'elle décrit. */
export function journaliser(db: D1Database, e: NouvelEvenement): D1PreparedStatement {
  return db
    .prepare(
      `INSERT INTO evenements_securite (id, utilisateur_id, type, session_id, appareil, ville, pays, cree_le)
       VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)`,
    )
    .bind(crypto.randomUUID(), e.utilisateurId, e.type, e.sessionId, e.appareil, e.ville, e.pays, e.maintenant);
}
