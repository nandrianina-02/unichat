import { conversationGroupe, type ActionAdministration } from "@unichat/shared";
import type { Bindings } from "../types";
import { fermerConnexions } from "./connexions";
import { journaliser } from "./evenements";
import { annoncer, membresDe } from "./groupes";
import { revoquer, type LigneSession } from "./sessions";

/**
 * Comptes d'administration : identifiants UniChat listés dans le secret
 * ADMINS, séparés par des virgules. Rien dans la base ne donne ce droit.
 */
export function estAdmin(env: Bindings, utilisateurId: string): boolean {
  return (env.ADMINS ?? "")
    .split(",")
    .map((id) => id.trim().toLowerCase())
    .includes(utilisateurId.toLowerCase());
}

export interface Trace {
  admin: { id: string; nom: string };
  action: ActionAdministration;
  cibleType: "utilisateur" | "groupe" | "signalement";
  cibleId: string;
  cibleNom: string | null;
  detail?: string | null;
  maintenant: number;
}

/** Chaque action d'administration laisse une ligne, pour que la modération reste vérifiable. */
export function tracer(db: D1Database, t: Trace): D1PreparedStatement {
  return db
    .prepare(
      `INSERT INTO actions_admin (id, admin_id, admin_nom, action, cible_type, cible_id, cible_nom, detail, cree_le)
       VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)`,
    )
    .bind(crypto.randomUUID(), t.admin.id, t.admin.nom, t.action, t.cibleType, t.cibleId, t.cibleNom, t.detail ?? null, t.maintenant);
}

/** Toutes les sessions encore ouvertes d'un compte sont fermées, et leurs connexions coupées. */
export async function fermerSessions(env: Bindings, utilisateurId: string, motif: "revoquee" | "suspension", maintenant: number): Promise<number> {
  const { results } = await env.DB.prepare("SELECT * FROM sessions WHERE utilisateur_id = ?1 AND revoquee_le IS NULL")
    .bind(utilisateurId)
    .all<LigneSession>();
  for (const s of results) await revoquer(env.DB, s, motif, maintenant);
  await fermerConnexions(
    env,
    utilisateurId,
    results.map((s) => s.id),
  );
  return results.length;
}

/**
 * Suspension : le compte ne peut plus se connecter, ses appareils sont
 * déconnectés et on ne peut plus lui écrire. Ses clés de chiffrement restent :
 * une fois la suspension levée, ses appareils reprennent leur place.
 */
export async function suspendre(env: Bindings, utilisateurId: string, motif: string, maintenant: number): Promise<boolean> {
  const { meta } = await env.DB.prepare("UPDATE utilisateurs SET suspendu_le = ?1, motif_suspension = ?2 WHERE id = ?3 AND suspendu_le IS NULL")
    .bind(maintenant, motif, utilisateurId)
    .run();
  if (meta.changes === 0) return false;
  await fermerSessions(env, utilisateurId, "suspension", maintenant);
  await journaliser(env.DB, {
    utilisateurId,
    type: "compte_suspendu",
    sessionId: null,
    appareil: null,
    ville: null,
    pays: null,
    maintenant,
  }).run();
  return true;
}

export async function leverSuspension(env: Bindings, utilisateurId: string, maintenant: number): Promise<boolean> {
  const [maj] = await env.DB.batch([
    env.DB.prepare("UPDATE utilisateurs SET suspendu_le = NULL, motif_suspension = NULL WHERE id = ?1 AND suspendu_le IS NOT NULL").bind(utilisateurId),
    journaliser(env.DB, { utilisateurId, type: "suspension_levee", sessionId: null, appareil: null, ville: null, pays: null, maintenant }),
  ]);
  return (maj?.meta.changes ?? 0) > 0;
}

/**
 * Groupe fermé par la modération : chaque membre en est averti dans la
 * discussion, puis le groupe disparaît, ses fichiers avec lui.
 */
export async function fermerGroupe(env: Bindings, groupeId: string, maintenant: number): Promise<void> {
  const membres = (await membresDe(env.DB, groupeId)).map((m) => m.id);
  await annoncer(env, membres, { groupeId, action: "fermeture", par: groupeId, cibles: [], le: maintenant });
  await env.DB.batch([
    env.DB.prepare("UPDATE medias SET expire_le = 0 WHERE conversation = ?1").bind(conversationGroupe(groupeId)),
    env.DB.prepare("DELETE FROM groupes WHERE id = ?1").bind(groupeId),
  ]);
}
