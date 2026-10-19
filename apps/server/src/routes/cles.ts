import { Hono, type Context } from "hono";
import {
  CLES_UNIQUES,
  HISTORIQUE,
  LIAISON,
  schemaAppareilRelie,
  schemaClesLiaison,
  schemaClesUniques,
  schemaDemandePaquets,
  schemaFinHistorique,
  schemaInscriptionCles,
  schemaListeAppareils,
  schemaMorceauHistorique,
  schemaNouvelleCleSignee,
  schemaNouvelleLiaison,
  schemaRepriseCles,
  schemaReponseLiaison,
  type AppareilsCompte,
  type CleUniqueTransport,
  type EtatCles,
  type EtatHistorique,
  type EtatLiaison,
  type PaquetsCompte,
} from "@unichat/shared";
import { lireCorpsBorne } from "../lib/corps";
import { aleatoire, empreinte } from "../lib/crypto";
import { journaliser } from "../lib/evenements";
import { Refus, refus } from "../lib/erreurs";
import type { LigneSession } from "../lib/sessions";
import type { AppEnv } from "../types";
import { exigerSession } from "./garde";
import { MINUTE, corpsJson, exigerConnexionRecente, limiter } from "./outils";

export const cles = new Hono<AppEnv>();
cles.use("*", exigerSession);

const JOUR = 24 * 60 * MINUTE;

interface LigneIdentite {
  cle_signature: string;
  cle_echange: string;
  preuve: string;
  version: number;
}

interface LigneAppareil {
  utilisateur_id: string;
  numero: number;
  cle_signee_id: number;
  cle_signee: string;
  signature: string;
  cle_signee_le: number;
  vu_le: number;
}

const versIdentite = (l: LigneIdentite) => ({ signature: l.cle_signature, echange: l.cle_echange, preuve: l.preuve, version: l.version });

async function etat(db: D1Database, session: LigneSession): Promise<EtatCles> {
  const [identite, appareil, inscrits] = await Promise.all([
    db.prepare("SELECT cle_signature, cle_echange, preuve, version FROM identites WHERE utilisateur_id = ?1").bind(session.utilisateur_id).first<LigneIdentite>(),
    db
      .prepare(
        `SELECT a.numero, a.cle_signee_id, a.cle_signee_le,
           (SELECT COUNT(*) FROM cles_uniques u WHERE u.utilisateur_id = a.utilisateur_id AND u.numero = a.numero) AS uniques
         FROM appareils_cles a WHERE a.session_id = ?1`,
      )
      .bind(session.id)
      .first<{ numero: number; cle_signee_id: number; cle_signee_le: number; uniques: number }>(),
    db.prepare("SELECT COUNT(*) AS n FROM appareils_cles WHERE utilisateur_id = ?1").bind(session.utilisateur_id).first<{ n: number }>(),
  ]);
  return {
    identite: identite ? versIdentite(identite) : null,
    appareilsInscrits: inscrits?.n ?? 0,
    appareil: appareil ? { numero: appareil.numero, cleSigneeId: appareil.cle_signee_id, cleSigneeLe: appareil.cle_signee_le, clesUniques: appareil.uniques } : null,
  };
}

function appareilDeLaSession(db: D1Database, session: LigneSession) {
  return db.prepare("SELECT * FROM appareils_cles WHERE session_id = ?1").bind(session.id).first<LigneAppareil>();
}

const insererUniques = (db: D1Database, utilisateurId: string, numero: number, liste: CleUniqueTransport[]) =>
  liste.map((c) =>
    db.prepare("INSERT OR IGNORE INTO cles_uniques (utilisateur_id, numero, cle_id, cle) VALUES (?1, ?2, ?3, ?4)").bind(utilisateurId, numero, c.id, c.cle),
  );

/** État des clés du compte et de cet appareil ; l'appareil qui se présente reste dans l'annuaire. */
cles.get("/", async (c) => {
  const session = c.get("session");
  const maintenant = c.get("deps").maintenant();
  // Une écriture par jour au plus : chaque écriture D1 compte.
  await c.env.DB.prepare("UPDATE appareils_cles SET vu_le = ?1 WHERE session_id = ?2 AND vu_le < ?3").bind(maintenant, session.id, maintenant - JOUR).run();
  return c.json(await etat(c.env.DB, session));
});

/**
 * Premier appareil du compte : il crée l'identité et s'inscrit sous le
 * numéro 1. Si l'identité existe déjà, les autres appareils devront être
 * reliés à celui-ci : le serveur ne peut pas leur donner la clé privée.
 */
cles.post("/identite", async (c) => {
  const corps = await corpsJson(c, schemaInscriptionCles);
  const session = c.get("session");
  const moi = session.utilisateur_id;
  const maintenant = c.get("deps").maintenant();
  await limiter(c, `cles:${moi}`, 20, 60 * MINUTE);
  if (await appareilDeLaSession(c.env.DB, session)) throw refus.conflit("Cet appareil a déjà ses clés.");

  const { identite, appareil } = corps;
  await c.env.DB.prepare(
    `INSERT INTO identites (utilisateur_id, cle_signature, cle_echange, preuve, version, prochain_numero, cree_le)
     VALUES (?1, ?2, ?3, ?4, 1, 1, ?5) ON CONFLICT (utilisateur_id) DO NOTHING`,
  )
    .bind(moi, identite.signature, identite.echange, identite.preuve, maintenant)
    .run();
  const existante = await c.env.DB.prepare(
    `SELECT i.cle_signature, i.cle_echange, (SELECT COUNT(*) FROM appareils_cles a WHERE a.utilisateur_id = i.utilisateur_id) AS appareils
     FROM identites i WHERE i.utilisateur_id = ?1`,
  )
    .bind(moi)
    .first<{ cle_signature: string; cle_echange: string; appareils: number }>();
  // Même identité et encore aucun appareil : c'est une nouvelle tentative du
  // même appareil après une coupure, on la laisse aboutir.
  if (!existante || existante.cle_signature !== identite.signature || existante.cle_echange !== identite.echange || existante.appareils > 0) {
    throw new Refus(409, "identite_existante", "Votre compte a déjà des clés sur un autre appareil : reliez celui-ci depuis cet appareil.");
  }

  await c.env.DB.batch(await inscrireAppareil(c.env.DB, moi, session.id, appareil, maintenant));
  return c.json(await etat(c.env.DB, session), 201);
});

/**
 * Inscription d'un appareil, en une transaction : numéro tiré du compteur du
 * compte, ancienne inscription de la session retirée (navigateur vidé puis
 * relié de nouveau), réserve de clés uniques déposée.
 */
async function inscrireAppareil(
  db: D1Database,
  moi: string,
  sessionId: string,
  appareil: { cleSignee: { id: number; cle: string; signature: string }; clesUniques: CleUniqueTransport[]; jeton: string },
  maintenant: number,
): Promise<D1PreparedStatement[]> {
  return [
    db.prepare("DELETE FROM appareils_cles WHERE session_id = ?1").bind(sessionId),
    db.prepare("UPDATE identites SET prochain_numero = prochain_numero + 1 WHERE utilisateur_id = ?1").bind(moi),
    db
      .prepare(
        `INSERT INTO appareils_cles (utilisateur_id, numero, session_id, jeton_hash, cle_signee_id, cle_signee, signature, cle_signee_le, cree_le, vu_le)
         SELECT ?1, prochain_numero - 1, ?2, ?3, ?4, ?5, ?6, ?7, ?7, ?7 FROM identites WHERE utilisateur_id = ?1`,
      )
      .bind(moi, sessionId, await empreinte(appareil.jeton), appareil.cleSignee.id, appareil.cleSignee.cle, appareil.cleSignee.signature, maintenant),
    db
      .prepare(
        `INSERT OR IGNORE INTO cles_uniques (utilisateur_id, numero, cle_id, cle)
         SELECT ?1, a.numero, json_extract(j.value, '$.id'), json_extract(j.value, '$.cle')
         FROM appareils_cles a, json_each(?3) j WHERE a.session_id = ?2`,
      )
      .bind(moi, sessionId, JSON.stringify(appareil.clesUniques)),
  ];
}

/** Même navigateur, nouvelle session (reconnexion) : l'appareil reprend sa place avec son jeton. */
cles.post("/reprendre", async (c) => {
  const { numero, jeton } = await corpsJson(c, schemaRepriseCles);
  const session = c.get("session");
  await limiter(c, `cles:${session.utilisateur_id}`, 20, 60 * MINUTE);
  const ligne = await c.env.DB.prepare("SELECT jeton_hash FROM appareils_cles WHERE utilisateur_id = ?1 AND numero = ?2")
    .bind(session.utilisateur_id, numero)
    .first<{ jeton_hash: string }>();
  if (!ligne || ligne.jeton_hash !== (await empreinte(jeton))) {
    throw new Refus(404, "appareil_inconnu", "Cet appareil n'est plus inscrit : reliez-le à nouveau.");
  }
  const maintenant = c.get("deps").maintenant();
  await c.env.DB.batch([
    // Une session ne porte qu'un appareil.
    c.env.DB.prepare("UPDATE appareils_cles SET session_id = NULL WHERE session_id = ?1").bind(session.id),
    c.env.DB.prepare("UPDATE appareils_cles SET session_id = ?1, vu_le = ?2 WHERE utilisateur_id = ?3 AND numero = ?4").bind(session.id, maintenant, session.utilisateur_id, numero),
  ]);
  return c.json(await etat(c.env.DB, session));
});

/** Réserve de clés uniques de cet appareil, refaite quand elle baisse. */
cles.post("/uniques", async (c) => {
  const { cles: nouvelles } = await corpsJson(c, schemaClesUniques);
  const session = c.get("session");
  await limiter(c, `cles:${session.utilisateur_id}`, 20, 60 * MINUTE);
  const appareil = await appareilDeLaSession(c.env.DB, session);
  if (!appareil) throw new Refus(404, "appareil_inconnu", "Cet appareil n'a pas encore ses clés.");
  const { n } = (await c.env.DB.prepare("SELECT COUNT(*) AS n FROM cles_uniques WHERE utilisateur_id = ?1 AND numero = ?2")
    .bind(appareil.utilisateur_id, appareil.numero)
    .first<{ n: number }>())!;
  const place = Math.max(0, CLES_UNIQUES.maximum - n);
  if (place > 0) await c.env.DB.batch(insererUniques(c.env.DB, appareil.utilisateur_id, appareil.numero, nouvelles.slice(0, place)));
  return c.json(await etat(c.env.DB, session));
});

/** Nouvelle clé signée (chaque mois). L'application garde l'ancienne pour les sessions en cours d'ouverture. */
cles.put("/signee", async (c) => {
  const { cleSignee } = await corpsJson(c, schemaNouvelleCleSignee);
  const session = c.get("session");
  await limiter(c, `cles:${session.utilisateur_id}`, 20, 60 * MINUTE);
  const resultat = await c.env.DB.prepare(
    "UPDATE appareils_cles SET cle_signee_id = ?1, cle_signee = ?2, signature = ?3, cle_signee_le = ?4 WHERE session_id = ?5",
  )
    .bind(cleSignee.id, cleSignee.cle, cleSignee.signature, c.get("deps").maintenant(), session.id)
    .run();
  if (resultat.meta.changes === 0) throw new Refus(404, "appareil_inconnu", "Cet appareil n'a pas encore ses clés.");
  return c.json(await etat(c.env.DB, session));
});

/**
 * Appareils inscrits de quelques comptes : l'application sait pour qui
 * chiffrer, sans consommer de clé unique pour les sessions déjà ouvertes.
 * Un compte sans clés n'apparaît pas.
 */
cles.post("/appareils", async (c) => {
  const { comptes } = await corpsJson(c, schemaListeAppareils);
  await limiter(c, `appareils:${c.get("session").utilisateur_id}`, 600, 60 * MINUTE);
  const { results } = await c.env.DB.prepare(
    `SELECT i.utilisateur_id AS id, i.cle_signature, i.cle_echange, i.preuve, i.version,
       (SELECT json_group_array(a.numero) FROM appareils_cles a WHERE a.utilisateur_id = i.utilisateur_id) AS numeros
     FROM identites i WHERE i.utilisateur_id IN (SELECT value FROM json_each(?1))`,
  )
    .bind(JSON.stringify(comptes))
    .all<LigneIdentite & { id: string; numeros: string }>();
  const liste: AppareilsCompte[] = results.map((r) => ({
    id: r.id,
    identite: versIdentite(r),
    appareils: (JSON.parse(r.numeros) as number[]).sort((x, y) => x - y),
  }));
  return c.json({ comptes: liste });
});

/**
 * Paquets de clés pour écrire à des comptes (et à mes autres appareils) :
 * identité, clé signée de chaque appareil et une clé unique, remise une
 * seule fois. Un compte sans clés n'apparaît pas dans la réponse.
 */
cles.post("/paquets", async (c) => {
  const { comptes } = await corpsJson(c, schemaDemandePaquets);
  const session = c.get("session");
  // Chaque demande consomme des clés uniques : on borne de quoi vider une réserve.
  await limiter(c, `paquets:${session.utilisateur_id}`, 120, 60 * MINUTE);
  const db = c.env.DB;
  const resultat: PaquetsCompte[] = [];
  for (const compte of comptes) {
    const identite = await db.prepare("SELECT cle_signature, cle_echange, preuve, version FROM identites WHERE utilisateur_id = ?1").bind(compte.id).first<LigneIdentite>();
    if (!identite) continue;
    const { results } = await db.prepare("SELECT * FROM appareils_cles WHERE utilisateur_id = ?1 ORDER BY numero").bind(compte.id).all<LigneAppareil>();
    const voulus = compte.appareils ? results.filter((a) => compte.appareils!.includes(a.numero)) : results;
    if (voulus.length === 0) {
      resultat.push({ id: compte.id, identite: versIdentite(identite), appareils: [] });
      continue;
    }
    const remises = await db.batch<{ cle_id: number; cle: string }>(
      voulus.map((a) =>
        db
          .prepare(
            `DELETE FROM cles_uniques WHERE rowid = (
               SELECT rowid FROM cles_uniques WHERE utilisateur_id = ?1 AND numero = ?2 ORDER BY cle_id LIMIT 1
             ) RETURNING cle_id, cle`,
          )
          .bind(compte.id, a.numero),
      ),
    );
    resultat.push({
      id: compte.id,
      identite: versIdentite(identite),
      appareils: voulus.map((a, i) => {
        const unique = remises[i]?.results[0];
        return {
          numero: a.numero,
          cleSignee: { id: a.cle_signee_id, cle: a.cle_signee, signature: a.signature },
          ...(unique ? { cleUnique: { id: unique.cle_id, cle: unique.cle } } : {}),
        };
      }),
    });
  }
  return c.json({ comptes: resultat });
});

// --- Liaison d'un appareil ------------------------------------------------------------

interface LigneLiaison {
  canal: string;
  utilisateur_id: string;
  createur_session: string;
  createur_role: "donneur" | "receveur";
  reponse_session: string | null;
  reponse_cle: string | null;
  reponse_preuve: string | null;
  cles: string | null;
  utilise_le: number | null;
  expire_le: number;
  historique_cle: string | null;
  historique_morceaux: number | null;
}

const roleOppose = (r: "donneur" | "receveur") => (r === "donneur" ? "receveur" : "donneur");
const INCONNUE = "Ce code ne correspond à aucune liaison de votre compte.";

/**
 * Liaison de cet utilisateur, encore valable. Le code d'un autre compte
 * répond comme un code inconnu : un QR code présenté par un tiers ne mène
 * nulle part.
 */
async function liaisonDuCompte(c: Context<AppEnv>, canal: string, delaiSupplementaire = 0): Promise<LigneLiaison> {
  const l = await c.env.DB.prepare("SELECT * FROM liaisons WHERE canal = ?1 AND utilisateur_id = ?2")
    .bind(canal, c.get("session").utilisateur_id)
    .first<LigneLiaison>();
  if (!l) throw new Refus(404, "liaison_inconnue", INCONNUE);
  if (c.get("deps").maintenant() > l.expire_le + delaiSupplementaire) throw new Refus(410, "liaison_expiree", "Ce code a expiré. Affichez-en un nouveau.");
  return l;
}

async function etatLiaison(db: D1Database, l: LigneLiaison, sessionId: string): Promise<EtatLiaison> {
  const autreSession = sessionId === l.createur_session ? l.reponse_session : l.createur_session;
  const autre = autreSession ? await db.prepare("SELECT appareil FROM sessions WHERE id = ?1").bind(autreSession).first<{ appareil: string }>() : null;
  return {
    etat: l.utilise_le ? "termine" : l.cles ? "cles" : l.reponse_session ? "repondu" : "attente",
    role: sessionId === l.createur_session ? l.createur_role : roleOppose(l.createur_role),
    expireLe: l.expire_le,
    ...(l.reponse_cle && l.reponse_preuve ? { reponse: { cle: l.reponse_cle, preuve: l.reponse_preuve } } : {}),
    ...(l.cles ? { cles: l.cles } : {}),
    ...(autre ? { autre: autre.appareil } : {}),
  };
}

/** Seul un appareil inscrit peut donner l'identité : un appareil non relié n'a rien à transmettre. */
async function exigerAppareilInscrit(c: Context<AppEnv>): Promise<void> {
  if (!(await appareilDeLaSession(c.env.DB, c.get("session")))) {
    throw new Refus(409, "appareil_non_relie", "Cet appareil n'a pas les clés du compte : il ne peut pas les transmettre.");
  }
}

/** Un appareil affiche un code : on ouvre un canal de cinq minutes. */
cles.post("/liaisons", async (c) => {
  const { role } = await corpsJson(c, schemaNouvelleLiaison);
  const session = c.get("session");
  await limiter(c, `liaison:${session.utilisateur_id}`, 30, 60 * MINUTE);
  if (role === "donneur") await exigerAppareilInscrit(c);
  else {
    const identite = await c.env.DB.prepare("SELECT 1 AS ok FROM identites WHERE utilisateur_id = ?1").bind(session.utilisateur_id).first();
    if (!identite) throw refus.conflit("Votre compte n'a pas encore de clés : cet appareil peut les créer lui-même.");
  }
  const maintenant = c.get("deps").maintenant();
  const canal = aleatoire(16);
  await c.env.DB.prepare(
    "INSERT INTO liaisons (canal, utilisateur_id, createur_session, createur_role, cree_le, expire_le) VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
  )
    .bind(canal, session.utilisateur_id, session.id, role, maintenant, maintenant + LIAISON.duree)
    .run();
  return c.json({ canal, expireLe: maintenant + LIAISON.duree }, 201);
});

cles.get("/liaisons/:canal", async (c) => {
  const l = await liaisonDuCompte(c, c.req.param("canal"), LIAISON.inscription);
  const session = c.get("session");
  if (session.id !== l.createur_session && session.id !== l.reponse_session) throw new Refus(404, "liaison_inconnue", INCONNUE);
  return c.json(await etatLiaison(c.env.DB, l, session.id));
});

/**
 * L'appareil qui a lu le code répond : sa clé éphémère et la preuve qu'il a
 * vu l'écran. S'il est le donneur, l'identité scellée part avec.
 */
cles.post("/liaisons/:canal/reponse", async (c) => {
  const { cle, preuve, cles: scellees } = await corpsJson(c, schemaReponseLiaison);
  const l = await liaisonDuCompte(c, c.req.param("canal"));
  const session = c.get("session");
  if (session.id === l.createur_session) throw refus.requete("Lisez ce code avec votre autre appareil.");
  if (l.reponse_session) throw refus.conflit("Ce code a déjà été lu par un autre appareil. Affichez-en un nouveau.");
  const role = roleOppose(l.createur_role);
  if (role === "donneur") {
    await exigerAppareilInscrit(c);
    if (!scellees) throw refus.requete("Les clés à transmettre manquent.");
  } else if (scellees) throw refus.requete("Cet appareil n'a pas de clés à transmettre.");
  const { meta } = await c.env.DB.prepare(
    `UPDATE liaisons SET reponse_session = ?1, reponse_cle = ?2, reponse_preuve = ?3, cles = ?4
     WHERE canal = ?5 AND reponse_session IS NULL`,
  )
    .bind(session.id, cle, preuve, scellees ?? null, l.canal)
    .run();
  if (meta.changes === 0) throw refus.conflit("Ce code a déjà été lu par un autre appareil. Affichez-en un nouveau.");
  return c.json(await etatLiaison(c.env.DB, { ...l, reponse_session: session.id, reponse_cle: cle, reponse_preuve: preuve, cles: scellees ?? null }, session.id));
});

/** Le donneur affichait le code : une fois la réponse vérifiée, il dépose l'identité scellée pour le receveur. */
cles.post("/liaisons/:canal/cles", async (c) => {
  const { cles: scellees } = await corpsJson(c, schemaClesLiaison);
  const l = await liaisonDuCompte(c, c.req.param("canal"));
  const session = c.get("session");
  if (session.id !== l.createur_session || l.createur_role !== "donneur") throw refus.interdit("Seul l'appareil qui a affiché ce code transmet les clés.");
  if (!l.reponse_session) throw refus.conflit("Aucun appareil n'a encore lu ce code.");
  await exigerAppareilInscrit(c);
  await c.env.DB.prepare("UPDATE liaisons SET cles = ?1 WHERE canal = ?2 AND cles IS NULL").bind(scellees, l.canal).run();
  return c.json(await etatLiaison(c.env.DB, { ...l, cles: l.cles ?? scellees }, session.id));
});

/**
 * Appareil relié : il a reçu l'identité et s'inscrit, au nom de cette
 * liaison seulement. Sans elle, un appareil (même connecté au compte, même
 * avec une ancienne copie des clés) ne peut pas s'ajouter à l'annuaire.
 */
cles.post("/appareil", async (c) => {
  const { canal, appareil } = await corpsJson(c, schemaAppareilRelie);
  const l = await liaisonDuCompte(c, canal, LIAISON.inscription);
  const session = c.get("session");
  const receveur = l.createur_role === "receveur" ? l.createur_session : l.reponse_session;
  if (session.id !== receveur) throw refus.interdit("Cette liaison concerne un autre appareil.");
  if (!l.cles) throw refus.conflit("Les clés n'ont pas encore été transmises.");
  if (l.utilise_le) throw refus.conflit("Cette liaison a déjà servi.");
  const maintenant = c.get("deps").maintenant();
  await c.env.DB.batch([
    c.env.DB.prepare("UPDATE liaisons SET utilise_le = ?1 WHERE canal = ?2").bind(maintenant, l.canal),
    ...(await inscrireAppareil(c.env.DB, session.utilisateur_id, session.id, appareil, maintenant)),
    journaliser(c.env.DB, {
      utilisateurId: session.utilisateur_id,
      type: "appareil_relie",
      sessionId: session.id,
      appareil: session.appareil,
      ville: session.ville,
      pays: session.pays,
      maintenant,
    }),
  ]);
  return c.json(await etat(c.env.DB, session), 201);
});

// --- Historique transmis à l'appareil relié (lot 8) ---------------------------------

const donneurDe = (l: LigneLiaison) => (l.createur_role === "donneur" ? l.createur_session : l.reponse_session);
const receveurDe = (l: LigneLiaison) => (l.createur_role === "receveur" ? l.createur_session : l.reponse_session);

/**
 * Liaison terminée dont cette session est le donneur (dépôt) ou le receveur
 * (reprise). L'historique reste moins d'une heure : le nettoyage efface la
 * liaison, et ses morceaux avec elle.
 */
async function liaisonHistorique(c: Context<AppEnv>, role: "donneur" | "receveur"): Promise<LigneLiaison> {
  const l = await liaisonDuCompte(c, c.req.param("canal") ?? "", HISTORIQUE.duree);
  if (!l.utilise_le) throw refus.conflit("La liaison n'est pas terminée.");
  if (c.get("session").id !== (role === "donneur" ? donneurDe(l) : receveurDe(l))) {
    throw refus.interdit(role === "donneur" ? "Seul l'appareil qui a transmis les clés dépose l'historique." : "Cet historique est destiné à un autre appareil.");
  }
  return l;
}

function indiceMorceau(c: Context<AppEnv>): number {
  const indice = Number(c.req.param("indice"));
  if (!Number.isInteger(indice) || indice < 0 || indice >= HISTORIQUE.morceauxMax) throw refus.requete("Morceau d'historique inconnu.");
  return indice;
}

/** Un morceau de l'archive, en base64 : le serveur ne fait que le ranger, il ne peut pas le lire. */
cles.put("/liaisons/:canal/historique/:indice", async (c) => {
  const l = await liaisonHistorique(c, "donneur");
  const indice = indiceMorceau(c);
  if (l.historique_morceaux !== null) throw refus.conflit("L'historique a déjà été déposé.");
  await limiter(c, `historique:${l.utilisateur_id}`, 4 * HISTORIQUE.morceauxMax, 60 * MINUTE);
  const corps = await lireCorpsBorne(c.req.raw, Math.ceil((HISTORIQUE.morceau * 4) / 3));
  if (!corps) throw new Refus(413, "trop_gros", "Morceau d'historique trop gros.");
  const lu = schemaMorceauHistorique.safeParse(new TextDecoder().decode(corps));
  if (!lu.success) throw refus.requete(lu.error.issues[0]?.message ?? "Morceau d'historique invalide.");
  await c.env.DB.prepare("INSERT OR REPLACE INTO morceaux_historique (canal, indice, donnees) VALUES (?1, ?2, ?3)").bind(l.canal, indice, lu.data).run();
  return c.body(null, 204);
});

/** Fin du dépôt : la clé scellée, et le nombre de morceaux (0 : rien à transmettre). */
cles.post("/liaisons/:canal/historique", async (c) => {
  const { morceaux, cle } = await corpsJson(c, schemaFinHistorique);
  const l = await liaisonHistorique(c, "donneur");
  if (l.historique_morceaux !== null) throw refus.conflit("L'historique a déjà été déposé.");
  const presents = await c.env.DB.prepare("SELECT COUNT(*) AS n FROM morceaux_historique WHERE canal = ?1 AND indice < ?2")
    .bind(l.canal, morceaux)
    .first<{ n: number }>();
  if ((presents?.n ?? 0) !== morceaux) throw refus.conflit("Des morceaux de l'historique manquent. Recommencez l'envoi.");
  await c.env.DB.prepare("UPDATE liaisons SET historique_morceaux = ?1, historique_cle = ?2 WHERE canal = ?3")
    .bind(morceaux, cle ?? null, l.canal)
    .run();
  return c.body(null, 204);
});

cles.get("/liaisons/:canal/historique", async (c) => {
  const l = await liaisonHistorique(c, "receveur");
  const deposes = await c.env.DB.prepare("SELECT COUNT(*) AS n FROM morceaux_historique WHERE canal = ?1").bind(l.canal).first<{ n: number }>();
  const etat: EtatHistorique = {
    etat: l.historique_morceaux === null ? "attente" : "pret",
    deposes: deposes?.n ?? 0,
    ...(l.historique_morceaux !== null ? { morceaux: l.historique_morceaux } : {}),
    ...(l.historique_cle ? { cle: l.historique_cle } : {}),
  };
  return c.json(etat);
});

cles.get("/liaisons/:canal/historique/:indice", async (c) => {
  const l = await liaisonHistorique(c, "receveur");
  const indice = indiceMorceau(c);
  const morceau = await c.env.DB.prepare("SELECT donnees FROM morceaux_historique WHERE canal = ?1 AND indice = ?2")
    .bind(l.canal, indice)
    .first<{ donnees: string }>();
  if (!morceau) throw new Refus(404, "morceau_inconnu", "Ce morceau de l'historique n'existe pas ou plus.");
  return c.text(morceau.donnees);
});

/** Historique repris : il quitte le serveur aussitôt. */
cles.delete("/liaisons/:canal/historique", async (c) => {
  const l = await liaisonHistorique(c, "receveur");
  await c.env.DB.batch([
    c.env.DB.prepare("DELETE FROM morceaux_historique WHERE canal = ?1").bind(l.canal),
    c.env.DB.prepare("UPDATE liaisons SET historique_cle = NULL WHERE canal = ?1").bind(l.canal),
  ]);
  return c.body(null, 204);
});

/**
 * Plus aucun appareil pour transmettre l'identité (perdu, effacé) : on en
 * crée une nouvelle. Les autres appareils devront être reliés à celui-ci.
 */
cles.post("/reinitialisation", async (c) => {
  const { identite, appareil } = await corpsJson(c, schemaInscriptionCles);
  exigerConnexionRecente(c);
  const session = c.get("session");
  const moi = session.utilisateur_id;
  await limiter(c, `cles:${moi}`, 20, 60 * MINUTE);
  const maintenant = c.get("deps").maintenant();
  await c.env.DB.batch([
    c.env.DB.prepare("DELETE FROM morceaux_historique WHERE canal IN (SELECT canal FROM liaisons WHERE utilisateur_id = ?1)").bind(moi),
    c.env.DB.prepare("DELETE FROM liaisons WHERE utilisateur_id = ?1").bind(moi),
    c.env.DB.prepare("DELETE FROM appareils_cles WHERE utilisateur_id = ?1").bind(moi),
    c.env.DB.prepare(
      `INSERT INTO identites (utilisateur_id, cle_signature, cle_echange, preuve, version, prochain_numero, cree_le)
       VALUES (?1, ?2, ?3, ?4, 1, 1, ?5)
       ON CONFLICT (utilisateur_id) DO UPDATE SET cle_signature = excluded.cle_signature, cle_echange = excluded.cle_echange,
         preuve = excluded.preuve, version = identites.version + 1, cree_le = excluded.cree_le`,
    ).bind(moi, identite.signature, identite.echange, identite.preuve, maintenant),
    ...(await inscrireAppareil(c.env.DB, moi, session.id, appareil, maintenant)),
    journaliser(c.env.DB, {
      utilisateurId: moi,
      type: "cles_reinitialisees",
      sessionId: session.id,
      appareil: session.appareil,
      ville: session.ville,
      pays: session.pays,
      maintenant,
    }),
  ]);
  return c.json(await etat(c.env.DB, session), 201);
});
