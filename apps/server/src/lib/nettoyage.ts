const JOUR = 24 * 60 * 60 * 1000;

/** Tâche quotidienne : on ne garde que ce qui sert, pour la vie privée comme pour le quota D1. */
export async function nettoyer(db: D1Database, maintenant: number): Promise<void> {
  await db.batch([
    db.prepare("DELETE FROM etats_oauth WHERE cree_le < ?1").bind(maintenant - 60 * 60 * 1000),
    db.prepare("DELETE FROM limites WHERE debut < ?1").bind(maintenant - JOUR),
    db
      .prepare("DELETE FROM sessions WHERE (revoquee_le IS NOT NULL AND revoquee_le < ?1) OR expire_le < ?1")
      .bind(maintenant - 30 * JOUR),
    db.prepare("DELETE FROM evenements_securite WHERE cree_le < ?1").bind(maintenant - 180 * JOUR),
  ]);
}
