import type { Plateforme } from "@unichat/shared";
import { aleatoire, empreinte } from "./crypto";
import { journaliser } from "./evenements";

const MINUTE = 60 * 1000;
const HEURE = 60 * MINUTE;
const JOUR = 24 * HEURE;

export const DUREES = {
  /** Session fermée après ce délai sans activité. */
  inactivite: 30 * JOUR,
  /** Durée de vie maximale : il faut repasser par Google au-delà. */
  maximale: 90 * JOUR,
  /** Le jeton change à cette fréquence. */
  rotation: 12 * HEURE,
  /** L'ancien jeton reste accepté ce temps-là, pour les requêtes déjà parties. */
  grace: 60 * 1000,
  /** « Vu le » n'est réécrit qu'à cet intervalle : chaque écriture D1 compte. */
  majVu: 5 * MINUTE,
} as const;

export interface LigneSession {
  id: string;
  utilisateur_id: string;
  jeton_hash: string;
  jeton_precedent_hash: string | null;
  rotation_le: number;
  plateforme: Plateforme;
  appareil: string;
  ville: string | null;
  pays: string | null;
  cree_le: number;
  vu_le: number;
  expire_le: number;
  alertes_vues_le: number;
  revoquee_le: number | null;
  motif_revocation: string | null;
}

export type MotifRevocation = "deconnexion" | "revoquee" | "expiration" | "reutilisation";

export type ResultatSession =
  | { etat: "valide"; session: LigneSession; nouveauJeton?: string }
  | { etat: "absente" }
  | { etat: "revoquee"; motif: MotifRevocation };

export interface NouvelAppareil {
  utilisateurId: string;
  plateforme: Plateforme;
  appareil: string;
  ville: string | null;
  pays: string | null;
}

export async function creerSession(
  db: D1Database,
  a: NouvelAppareil,
  maintenant: number,
): Promise<{ id: string; jeton: string }> {
  const id = crypto.randomUUID();
  const jeton = aleatoire(32);
  await db.batch([
    db
      .prepare(
        `INSERT INTO sessions (id, utilisateur_id, jeton_hash, rotation_le, plateforme, appareil, ville, pays,
           cree_le, vu_le, expire_le, alertes_vues_le)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?4, ?4, ?9, ?4)`,
      )
      .bind(id, a.utilisateurId, await empreinte(jeton), maintenant, a.plateforme, a.appareil, a.ville, a.pays, maintenant + DUREES.maximale),
    journaliser(db, {
      utilisateurId: a.utilisateurId,
      type: "connexion",
      sessionId: id,
      appareil: a.appareil,
      ville: a.ville,
      pays: a.pays,
      maintenant,
    }),
  ]);
  return { id, jeton };
}

/**
 * Vérifie un jeton et applique la politique de session : expiration,
 * renouvellement périodique et détection de la réutilisation d'un ancien
 * jeton. Un jeton renouvelé n'est valable qu'une fois l'ancien remplacé ; si
 * l'ancien revient après le délai de grâce, quelqu'un d'autre le détient :
 * la session est fermée pour tous.
 */
export async function verifierSession(db: D1Database, jeton: string, maintenant: number): Promise<ResultatSession> {
  const hash = await empreinte(jeton);
  const s = await db
    .prepare("SELECT * FROM sessions WHERE jeton_hash = ?1 OR jeton_precedent_hash = ?1")
    .bind(hash)
    .first<LigneSession>();
  if (!s) return { etat: "absente" };
  if (s.revoquee_le !== null) return { etat: "revoquee", motif: (s.motif_revocation as MotifRevocation) ?? "revoquee" };

  if (s.jeton_hash !== hash) {
    if (maintenant - s.rotation_le <= DUREES.grace) return { etat: "valide", session: s };
    await revoquer(db, s, "reutilisation", maintenant);
    return { etat: "revoquee", motif: "reutilisation" };
  }

  if (maintenant > s.expire_le || maintenant - s.vu_le > DUREES.inactivite) {
    await revoquer(db, s, "expiration", maintenant);
    return { etat: "revoquee", motif: "expiration" };
  }

  if (maintenant - s.rotation_le > DUREES.rotation) {
    const nouveau = aleatoire(32);
    // Conditionnel : si une requête concurrente a déjà renouvelé le jeton,
    // celle-ci n'écrase rien et se contente de l'ancien, encore en grâce.
    const resultat = await db
      .prepare(
        `UPDATE sessions SET jeton_hash = ?1, jeton_precedent_hash = ?2, rotation_le = ?3, vu_le = ?3
         WHERE id = ?4 AND jeton_hash = ?2`,
      )
      .bind(await empreinte(nouveau), hash, maintenant, s.id)
      .run();
    if (resultat.meta.changes === 1) {
      return { etat: "valide", session: { ...s, vu_le: maintenant, rotation_le: maintenant }, nouveauJeton: nouveau };
    }
    return { etat: "valide", session: s };
  }

  if (maintenant - s.vu_le > DUREES.majVu) {
    await db.prepare("UPDATE sessions SET vu_le = ?1 WHERE id = ?2").bind(maintenant, s.id).run();
    return { etat: "valide", session: { ...s, vu_le: maintenant } };
  }
  return { etat: "valide", session: s };
}

export async function revoquer(
  db: D1Database,
  s: Pick<LigneSession, "id" | "utilisateur_id" | "appareil" | "ville" | "pays">,
  motif: MotifRevocation,
  maintenant: number,
): Promise<void> {
  const instructions = [
    db
      .prepare("UPDATE sessions SET revoquee_le = ?1, motif_revocation = ?2 WHERE id = ?3 AND revoquee_le IS NULL")
      .bind(maintenant, motif, s.id),
  ];
  const type = motif === "reutilisation" ? "reutilisation_jeton" : motif === "revoquee" ? "session_revoquee" : motif === "deconnexion" ? "deconnexion" : null;
  if (type) {
    instructions.push(
      journaliser(db, {
        utilisateurId: s.utilisateur_id,
        type,
        sessionId: s.id,
        appareil: s.appareil,
        ville: s.ville,
        pays: s.pays,
        maintenant,
      }),
    );
  }
  await db.batch(instructions);
}

export async function sessionsActives(db: D1Database, utilisateurId: string, maintenant: number): Promise<LigneSession[]> {
  const { results } = await db
    .prepare(
      `SELECT * FROM sessions
       WHERE utilisateur_id = ?1 AND revoquee_le IS NULL AND expire_le > ?2 AND vu_le > ?3
       ORDER BY vu_le DESC`,
    )
    .bind(utilisateurId, maintenant, maintenant - DUREES.inactivite)
    .all<LigneSession>();
  return results;
}
