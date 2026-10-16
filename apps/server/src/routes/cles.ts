import { Hono } from "hono";
import {
  CLES_UNIQUES,
  schemaClesUniques,
  schemaDemandePaquets,
  schemaInscriptionCles,
  schemaNouvelleCleSignee,
  schemaRepriseCles,
  type CleUniqueTransport,
  type EtatCles,
  type PaquetsCompte,
} from "@unichat/shared";
import { empreinte } from "../lib/crypto";
import { Refus, refus } from "../lib/erreurs";
import type { LigneSession } from "../lib/sessions";
import type { AppEnv } from "../types";
import { exigerSession } from "./garde";
import { MINUTE, corpsJson, limiter } from "./outils";

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
  const [identite, appareil] = await Promise.all([
    db.prepare("SELECT cle_signature, cle_echange, preuve, version FROM identites WHERE utilisateur_id = ?1").bind(session.utilisateur_id).first<LigneIdentite>(),
    db
      .prepare(
        `SELECT a.numero, a.cle_signee_id, a.cle_signee_le,
           (SELECT COUNT(*) FROM cles_uniques u WHERE u.utilisateur_id = a.utilisateur_id AND u.numero = a.numero) AS uniques
         FROM appareils_cles a WHERE a.session_id = ?1`,
      )
      .bind(session.id)
      .first<{ numero: number; cle_signee_id: number; cle_signee_le: number; uniques: number }>(),
  ]);
  return {
    identite: identite ? versIdentite(identite) : null,
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

  // Numéro tiré et réservé dans la même transaction que l'inscription.
  const [, numero] = await c.env.DB.batch<{ numero: number }>([
    c.env.DB.prepare("UPDATE identites SET prochain_numero = prochain_numero + 1 WHERE utilisateur_id = ?1").bind(moi),
    c.env.DB.prepare("SELECT prochain_numero - 1 AS numero FROM identites WHERE utilisateur_id = ?1").bind(moi),
  ]);
  const n = numero!.results[0]!.numero;
  await c.env.DB.batch([
    c.env.DB.prepare(
      `INSERT INTO appareils_cles (utilisateur_id, numero, session_id, jeton_hash, cle_signee_id, cle_signee, signature, cle_signee_le, cree_le, vu_le)
       VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?8, ?8)`,
    ).bind(moi, n, session.id, await empreinte(appareil.jeton), appareil.cleSignee.id, appareil.cleSignee.cle, appareil.cleSignee.signature, maintenant),
    ...insererUniques(c.env.DB, moi, n, appareil.clesUniques),
  ]);
  return c.json(await etat(c.env.DB, session), 201);
});

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
