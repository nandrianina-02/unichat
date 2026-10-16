import type { Bindings } from "../types";
import { abandonnerEnvoi, supprimerFichier, type ConfigKaraks } from "./karaks";

const HEURE = 60 * 60 * 1000;
const JOUR = 24 * HEURE;
/** Fichiers traités par passage : chacun coûte deux appels, sous la limite de 50 sous-requêtes. */
const MEDIAS_PAR_PASSAGE = 15;

/** Tâche horaire : on ne garde que ce qui sert, pour la vie privée comme pour les quotas. */
export async function nettoyer(env: Bindings, maintenant: number, recuperer: typeof fetch): Promise<void> {
  const db = env.DB;
  await db.batch([
    db.prepare("DELETE FROM etats_oauth WHERE cree_le < ?1").bind(maintenant - HEURE),
    db.prepare("DELETE FROM limites WHERE debut < ?1").bind(maintenant - JOUR),
    db
      .prepare("DELETE FROM sessions WHERE (revoquee_le IS NOT NULL AND revoquee_le < ?1) OR expire_le < ?1")
      .bind(maintenant - 30 * JOUR),
    db.prepare("DELETE FROM evenements_securite WHERE cree_le < ?1").bind(maintenant - 180 * JOUR),
  ]);
  await nettoyerMedias(env, maintenant, recuperer);
}

/** Fichiers expirés (30 jours, message supprimé, compte supprimé) et envois jamais terminés. */
export async function nettoyerMedias(env: Bindings, maintenant: number, recuperer: typeof fetch): Promise<number> {
  if (!env.KARAKS_STORAGE_URL || !env.KARAKS_STORAGE_CLE) return 0;
  const config: ConfigKaraks = { url: env.KARAKS_STORAGE_URL, cle: env.KARAKS_STORAGE_CLE };
  const { results } = await env.DB.prepare(
    `SELECT id, envoi_id, fichier_id FROM medias
     WHERE expire_le < ?1 OR (fichier_id IS NULL AND cree_le < ?2)
     LIMIT ?3`,
  )
    .bind(maintenant, maintenant - JOUR, MEDIAS_PAR_PASSAGE)
    .all<{ id: string; envoi_id: string; fichier_id: string | null }>();
  let effaces = 0;
  for (const m of results) {
    try {
      if (m.fichier_id) await supprimerFichier(recuperer, config, m.fichier_id);
      else await abandonnerEnvoi(recuperer, config, m.envoi_id).catch(() => {});
      await env.DB.prepare("DELETE FROM medias WHERE id = ?1").bind(m.id).run();
      effaces += 1;
    } catch (erreur) {
      // Le stockage ne répond pas : on réessaiera au passage suivant.
      console.warn("fichier non effacé", m.id, String(erreur));
    }
  }
  return effaces;
}
