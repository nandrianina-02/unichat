/**
 * Limitation du nombre de demandes, par fenêtre fixe, dans D1.
 *
 * Une seule écriture par appel (UPSERT … RETURNING). Réservé aux routes
 * sensibles et peu fréquentes (connexion, recherche) : le temps réel aura
 * ses propres compteurs en mémoire dans les Durable Objects.
 */
export async function autoriser(
  db: D1Database,
  cle: string,
  maximum: number,
  fenetreMs: number,
  maintenant: number,
): Promise<{ ok: boolean; reessayerDans: number }> {
  const debut = Math.floor(maintenant / fenetreMs) * fenetreMs;
  const ligne = await db
    .prepare(
      `INSERT INTO limites (cle, debut, compte) VALUES (?1, ?2, 1)
       ON CONFLICT (cle) DO UPDATE SET
         compte = CASE WHEN limites.debut = ?2 THEN limites.compte + 1 ELSE 1 END,
         debut = ?2
       RETURNING compte`,
    )
    .bind(cle, debut)
    .first<{ compte: number }>();
  const compte = ligne?.compte ?? 1;
  return { ok: compte <= maximum, reessayerDans: Math.ceil((debut + fenetreMs - maintenant) / 1000) };
}
