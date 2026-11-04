import { afficherTelephone } from "@unichat/shared";
import type { Bindings } from "../types";
import { compteTelephone } from "./profils";
import { Refus, refus } from "./erreurs";
import { demanderCode, ErreurMess, verifierCode, type ConfigMess } from "./mess";

/*
 * Le numéro de téléphone du profil. Mess envoie le code et le vérifie ;
 * UniChat ne garde que l'identifiant de la demande, le temps de la saisie.
 */

export function configurationMess(env: Bindings): ConfigMess {
  if (!env.MESS_URL || !env.MESS_CLE) {
    throw new Refus(503, "sms_indisponible", "La vérification par SMS n'est pas encore configurée sur ce serveur.");
  }
  return { url: env.MESS_URL, cle: env.MESS_CLE };
}

/** Par la liaison de service quand elle existe (production), sinon par le réseau (tests, local). */
export function versMess(env: Bindings, recuperer: typeof fetch): typeof fetch {
  const liaison = env.MESS;
  return liaison ? (entree, init) => liaison.fetch(entree, init) : recuperer;
}

/** Ce que Mess refuse se dit en mots d'UniChat ; une panne de Mess n'est pas la faute de la personne. */
function traduire(e: unknown): never {
  if (!(e instanceof ErreurMess)) throw e;
  // La cause exacte va au journal du Worker ; la personne reçoit un message simple.
  console.warn("Mess a refusé :", e.statut, e.code, e.message);
  if (e.statut === 429) throw new Refus(429, "trop_de_demandes", "Trop de codes demandés pour ce numéro. Réessayez dans quelques minutes.");
  if (e.code === "numero") throw refus.requete("Ce numéro ne peut pas recevoir de SMS : il faut un mobile malgache.");
  throw new Refus(503, "sms_indisponible", "L'envoi de SMS est momentanément indisponible. Réessayez plus tard.");
}

export interface Verification {
  numero: string;
  expireLe: number;
}

/** La vérification en cours, si elle n'a pas expiré. */
export async function verificationEnCours(db: D1Database, utilisateurId: string, maintenant: number): Promise<Verification | null> {
  const v = await db
    .prepare("SELECT numero, expire_le FROM verifications_telephone WHERE utilisateur_id = ?1 AND expire_le > ?2")
    .bind(utilisateurId, maintenant)
    .first<{ numero: string; expire_le: number }>();
  return v ? { numero: v.numero, expireLe: v.expire_le } : null;
}

export async function demanderVerification(
  env: Bindings,
  recuperer: typeof fetch,
  utilisateurId: string,
  numero: string,
  maintenant: number,
): Promise<void> {
  const config = configurationMess(env);
  const actuel = await env.DB.prepare("SELECT telephone FROM utilisateurs WHERE id = ?1").bind(utilisateurId).first<{ telephone: string | null }>();
  if (actuel?.telephone === numero) throw refus.requete(`Le ${afficherTelephone(numero)} est déjà votre numéro.`);
  await exigerNumeroLibre(env.DB, numero, utilisateurId);
  const demande = await demanderCode(versMess(env, recuperer), config, numero).catch(traduire);
  await env.DB.prepare(
    `INSERT INTO verifications_telephone (utilisateur_id, numero, demande_mess, expire_le) VALUES (?1, ?2, ?3, ?4)
     ON CONFLICT (utilisateur_id) DO UPDATE SET numero = ?2, demande_mess = ?3, expire_le = ?4`,
  )
    .bind(utilisateurId, numero, demande.id, Math.min(demande.expireLe, maintenant + 10 * 60_000))
    .run();
}

const RAISONS = {
  expire: "Le code a expiré. Demandez-en un nouveau.",
  trop_d_essais: "Trop d'essais : ce code est bloqué. Demandez-en un nouveau.",
  deja_utilise: "Ce code a déjà servi. Demandez-en un nouveau.",
} as const;

/**
 * Le code saisi. Juste, le numéro passe sur ce compte ; s'il était sur un
 * autre, il le quitte : un numéro appartient à qui le détient aujourd'hui.
 */
export async function confirmerVerification(
  env: Bindings,
  recuperer: typeof fetch,
  utilisateurId: string,
  code: string,
  maintenant: number,
): Promise<string> {
  const config = configurationMess(env);
  const v = await env.DB.prepare("SELECT numero, demande_mess FROM verifications_telephone WHERE utilisateur_id = ?1 AND expire_le > ?2")
    .bind(utilisateurId, maintenant)
    .first<{ numero: string; demande_mess: string }>();
  if (!v) throw refus.requete("Aucune vérification en cours, ou elle a expiré. Demandez un nouveau code.");

  const r = await verifierCode(versMess(env, recuperer), config, v.demande_mess, code).catch(traduire);
  if (!r.valide) {
    if (r.raison === "incorrect") {
      const reste = r.essaisRestants ?? 0;
      throw refus.requete(`Code incorrect. ${reste > 0 ? `Encore ${reste} essai${reste > 1 ? "s" : ""}.` : "Demandez un nouveau code."}`);
    }
    await env.DB.prepare("DELETE FROM verifications_telephone WHERE utilisateur_id = ?1").bind(utilisateurId).run();
    throw refus.requete(RAISONS[r.raison]);
  }

  await exigerNumeroLibre(env.DB, v.numero, utilisateurId);
  await env.DB.batch([
    env.DB.prepare("UPDATE utilisateurs SET telephone = NULL WHERE telephone = ?1 AND id <> ?2").bind(v.numero, utilisateurId),
    env.DB.prepare("UPDATE utilisateurs SET telephone = ?1 WHERE id = ?2").bind(v.numero, utilisateurId),
    env.DB.prepare("DELETE FROM verifications_telephone WHERE utilisateur_id = ?1").bind(utilisateurId),
  ]);
  return v.numero;
}

/**
 * Un numéro qui ouvre un compte sans Google en est la seule clé : le lui
 * prendre fermerait ce compte pour toujours. Qui détient ce numéro se
 * connecte plutôt avec lui.
 */
async function exigerNumeroLibre(db: D1Database, numero: string, utilisateurId: string): Promise<void> {
  const titulaire = await db
    .prepare("SELECT google_sub FROM utilisateurs WHERE telephone = ?1 AND id <> ?2")
    .bind(numero, utilisateurId)
    .first<{ google_sub: string }>();
  if (titulaire && compteTelephone(titulaire.google_sub)) {
    throw refus.conflit("Ce numéro sert déjà à se connecter à un autre compte UniChat. Connectez-vous avec lui.");
  }
}

// --- Inscription et connexion par numéro -------------------------------------------------

/** Durée d'une demande de connexion : celle du code chez Mess. */
const DUREE_CONNEXION = 10 * 60_000;

/** Même réponse que le numéro ait un compte ou non : la page ne dit pas qui est inscrit. */
export async function demanderConnexion(
  env: Bindings,
  recuperer: typeof fetch,
  numero: string,
  maintenant: number,
): Promise<{ demande: string; expireLe: number }> {
  const config = configurationMess(env);
  const reponse = await demanderCode(versMess(env, recuperer), config, numero).catch(traduire);
  const id = crypto.randomUUID();
  const expireLe = Math.min(reponse.expireLe, maintenant + DUREE_CONNEXION);
  await env.DB.prepare("INSERT INTO connexions_telephone (id, numero, demande_mess, expire_le) VALUES (?1, ?2, ?3, ?4)")
    .bind(id, numero, reponse.id, expireLe)
    .run();
  return { demande: id, expireLe };
}

/** Le code juste, le numéro est prouvé : il reste à ouvrir (ou créer) son compte. Rend le numéro. */
export async function confirmerConnexion(env: Bindings, recuperer: typeof fetch, demande: string, code: string, maintenant: number): Promise<string> {
  const config = configurationMess(env);
  const d = await env.DB.prepare("SELECT numero, demande_mess FROM connexions_telephone WHERE id = ?1 AND expire_le > ?2")
    .bind(demande, maintenant)
    .first<{ numero: string; demande_mess: string }>();
  if (!d) throw refus.requete("Cette demande a expiré. Demandez un nouveau code.");
  const r = await verifierCode(versMess(env, recuperer), config, d.demande_mess, code).catch(traduire);
  if (!r.valide) {
    if (r.raison === "incorrect") {
      const reste = r.essaisRestants ?? 0;
      throw refus.requete(`Code incorrect. ${reste > 0 ? `Encore ${reste} essai${reste > 1 ? "s" : ""}.` : "Demandez un nouveau code."}`);
    }
    await env.DB.prepare("DELETE FROM connexions_telephone WHERE id = ?1").bind(demande).run();
    throw refus.requete(RAISONS[r.raison]);
  }
  // Usage unique : la demande disparaît avec la connexion.
  await env.DB.prepare("DELETE FROM connexions_telephone WHERE id = ?1").bind(demande).run();
  return d.numero;
}

export async function retirerTelephone(db: D1Database, utilisateurId: string): Promise<boolean> {
  const u = await db.prepare("SELECT google_sub FROM utilisateurs WHERE id = ?1").bind(utilisateurId).first<{ google_sub: string }>();
  if (u && compteTelephone(u.google_sub)) {
    throw refus.requete("Ce numéro sert à vous connecter : il ne peut pas être retiré. Vous pouvez le remplacer par un autre.");
  }
  const [retrait] = await db.batch([
    db.prepare("UPDATE utilisateurs SET telephone = NULL WHERE id = ?1 AND telephone IS NOT NULL").bind(utilisateurId),
    db.prepare("DELETE FROM verifications_telephone WHERE utilisateur_id = ?1").bind(utilisateurId),
  ]);
  return (retrait?.meta.changes ?? 0) > 0;
}
