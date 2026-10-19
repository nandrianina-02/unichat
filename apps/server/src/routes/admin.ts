import { Hono, type Context } from "hono";
import { createMiddleware } from "hono/factory";
import {
  PAGE_ADMIN,
  schemaDecision,
  schemaFermetureGroupe,
  schemaSuppressionAdmin,
  schemaSuspension,
  type ActionAdmin,
  type Decision,
  type FicheAdmin,
  type MessageSignale,
  type SignalementAdmin,
  type TableauAdmin,
  type UtilisateurAdmin,
} from "@unichat/shared";
import { estAdmin, fermerGroupe, fermerSessions, leverSuspension, suspendre, tracer, type Trace } from "../lib/admin";
import { Refus, refus } from "../lib/erreurs";
import type { LigneUtilisateur } from "../lib/profils";
import { supprimerCompte } from "../lib/suppression";
import type { AppEnv } from "../types";
import { exigerSession } from "./garde";
import { corpsJson, exigerConnexionRecente } from "./outils";

export const admin = new Hono<AppEnv>();
admin.use("*", exigerSession);
// Pour un compte ordinaire, cet espace n'existe pas : même réponse qu'une adresse inconnue.
admin.use(
  "*",
  createMiddleware<AppEnv>(async (c, next) => {
    if (!estAdmin(c.env, c.get("session").utilisateur_id)) throw new Refus(404, "introuvable", "Adresse inconnue.");
    await next();
  }),
);

const JOUR = 24 * 60 * 60 * 1000;

async function administrateur(c: Context<AppEnv>): Promise<Trace["admin"]> {
  const id = c.get("session").utilisateur_id;
  const ligne = await c.env.DB.prepare("SELECT nom FROM utilisateurs WHERE id = ?1").bind(id).first<{ nom: string }>();
  return { id, nom: ligne?.nom ?? "Administration" };
}

/** Un administrateur n'agit ni sur lui-même ni sur un autre administrateur : chacun gère son compte comme tout le monde. */
async function compteVise(c: Context<AppEnv>): Promise<LigneUtilisateur> {
  const id = c.req.param("id")!;
  const u = await c.env.DB.prepare("SELECT * FROM utilisateurs WHERE id = ?1").bind(id).first<LigneUtilisateur>();
  if (!u) throw refus.introuvable("Ce compte n'existe plus.");
  if (u.id === c.get("session").utilisateur_id || estAdmin(c.env, u.id)) {
    throw refus.interdit("Un compte d'administration ne se gère pas depuis cet espace.");
  }
  return u;
}

// --- Tableau de bord ----------------------------------------------------------------

admin.get("/tableau", async (c) => {
  const maintenant = c.get("deps").maintenant();
  const db = c.env.DB;
  const { results, meta } = await db
    .prepare(
      `SELECT
         (SELECT COUNT(*) FROM utilisateurs) AS comptes,
         (SELECT COUNT(*) FROM utilisateurs WHERE pseudo IS NULL) AS inacheves,
         (SELECT COUNT(*) FROM utilisateurs WHERE cree_le > ?1) AS nouveaux7j,
         (SELECT COUNT(DISTINCT utilisateur_id) FROM sessions WHERE vu_le > ?2) AS actifs24h,
         (SELECT COUNT(DISTINCT utilisateur_id) FROM sessions WHERE vu_le > ?1) AS actifs7j,
         (SELECT COUNT(*) FROM sessions WHERE revoquee_le IS NULL AND expire_le > ?3) AS appareils,
         (SELECT COUNT(*) FROM groupes) AS groupes,
         (SELECT COUNT(*) FROM signalements WHERE traite_le IS NULL) AS signalements_ouverts,
         (SELECT COUNT(*) FROM utilisateurs WHERE suspendu_le IS NOT NULL) AS suspendus,
         (SELECT COUNT(*) FROM abonnements_push) AS abonnements_push,
         (SELECT COUNT(*) FROM identites) AS comptes_chiffres`,
    )
    .bind(maintenant - 7 * JOUR, maintenant - JOUR, maintenant)
    .all<Record<string, number>>();
  const r = results[0]!;
  // Un fichier transféré a plusieurs lignes mais n'est stocké qu'une fois.
  const fichiers = await db
    .prepare(
      `SELECT COUNT(*) AS n, COALESCE(SUM(taille), 0) AS octets FROM (
         SELECT fichier_id, MAX(taille) AS taille FROM medias WHERE fichier_id IS NOT NULL AND expire_le > ?1 GROUP BY fichier_id
       )`,
    )
    .bind(maintenant)
    .first<{ n: number; octets: number }>();
  const premierJour = Math.floor(maintenant / JOUR) * JOUR - 13 * JOUR;
  const { results: parJour } = await db
    .prepare("SELECT (cree_le / 86400000) * 86400000 AS jour, COUNT(*) AS n FROM utilisateurs WHERE cree_le >= ?1 GROUP BY jour")
    .bind(premierJour)
    .all<{ jour: number; n: number }>();
  const tableau: TableauAdmin = {
    comptes: r.comptes!,
    inacheves: r.inacheves!,
    nouveaux7j: r.nouveaux7j!,
    actifs24h: r.actifs24h!,
    actifs7j: r.actifs7j!,
    appareils: r.appareils!,
    groupes: r.groupes!,
    fichiers: fichiers?.n ?? 0,
    octetsFichiers: fichiers?.octets ?? 0,
    signalementsOuverts: r.signalements_ouverts!,
    suspendus: r.suspendus!,
    abonnementsPush: r.abonnements_push!,
    comptesChiffres: r.comptes_chiffres!,
    octetsBase: meta.size_after ?? 0,
    inscriptions: Array.from({ length: 14 }, (_, i) => {
      const jour = premierJour + i * JOUR;
      return { jour, nombre: parJour.find((p) => p.jour === jour)?.n ?? 0 };
    }),
  };
  return c.json(tableau);
});

// --- Comptes ---------------------------------------------------------------------------

const COLONNES_COMPTE = `
  u.id, u.nom, u.pseudo, u.email, u.cree_le, u.suspendu_le,
  (SELECT MAX(s.vu_le) FROM sessions s WHERE s.utilisateur_id = u.id) AS vu_le,
  (SELECT COUNT(*) FROM sessions s WHERE s.utilisateur_id = u.id AND s.revoquee_le IS NULL AND s.expire_le > ?1) AS appareils,
  (SELECT COUNT(*) FROM signalements g WHERE g.type = 'personne' AND g.cible_id = u.id) AS signalements`;

interface LigneCompte {
  id: string;
  nom: string;
  pseudo: string | null;
  email: string;
  cree_le: number;
  suspendu_le: number | null;
  vu_le: number | null;
  appareils: number;
  signalements: number;
}

const versCompte = (c: Context<AppEnv>, l: LigneCompte): UtilisateurAdmin => ({
  id: l.id,
  nom: l.nom,
  pseudo: l.pseudo,
  email: l.email,
  creeLe: l.cree_le,
  vuLe: l.vu_le,
  appareils: l.appareils,
  signalements: l.signalements,
  suspenduLe: l.suspendu_le,
  admin: estAdmin(c.env, l.id),
});

/** Recherche dans le nom, le nom d'utilisateur ou l'adresse ; du plus récent au plus ancien. */
admin.get("/utilisateurs", async (c) => {
  const maintenant = c.get("deps").maintenant();
  const texte = (c.req.query("q") ?? "").trim().toLowerCase().slice(0, 100);
  const filtre = c.req.query("filtre");
  const avant = Number(c.req.query("avant")) || Number.MAX_SAFE_INTEGER;
  const conditions = ["u.cree_le < ?2"];
  if (texte) conditions.push("(lower(u.nom) LIKE ?3 ESCAPE '\\' OR u.pseudo LIKE ?3 ESCAPE '\\' OR lower(u.email) LIKE ?3 ESCAPE '\\')");
  if (filtre === "suspendus") conditions.push("u.suspendu_le IS NOT NULL");
  if (filtre === "signales") conditions.push("EXISTS (SELECT 1 FROM signalements g WHERE g.type = 'personne' AND g.cible_id = u.id AND g.traite_le IS NULL)");
  const valeurs: unknown[] = [maintenant, avant];
  if (texte) valeurs.push(`%${texte.replace(/[\\%_]/g, (x) => `\\${x}`)}%`);
  const { results } = await c.env.DB.prepare(
    `SELECT ${COLONNES_COMPTE} FROM utilisateurs u WHERE ${conditions.join(" AND ")} ORDER BY u.cree_le DESC LIMIT ${PAGE_ADMIN + 1}`,
  )
    .bind(...valeurs)
    .all<LigneCompte>();
  const page = results.slice(0, PAGE_ADMIN);
  return c.json({ utilisateurs: page.map((l) => versCompte(c, l)), suite: results.length > PAGE_ADMIN ? page.at(-1)!.cree_le : null });
});

admin.get("/utilisateurs/:id", async (c) => c.json(await fiche(c, c.req.param("id"))));

async function fiche(c: Context<AppEnv>, id: string): Promise<FicheAdmin> {
  const maintenant = c.get("deps").maintenant();
  const db = c.env.DB;
  const l = await db
    .prepare(`SELECT ${COLONNES_COMPTE}, u.infos, u.motif_suspension FROM utilisateurs u WHERE u.id = ?2`)
    .bind(maintenant, id)
    .first<LigneCompte & { infos: string; motif_suspension: string | null }>();
  if (!l) throw refus.introuvable("Ce compte n'existe plus.");
  const [sessions, groupes, compteurs, recus] = await Promise.all([
    db
      .prepare(
        `SELECT id, plateforme, appareil, ville, pays, cree_le, vu_le FROM sessions
         WHERE utilisateur_id = ?1 AND revoquee_le IS NULL AND expire_le > ?2 ORDER BY vu_le DESC`,
      )
      .bind(id, maintenant)
      .all<{ id: string; plateforme: "web" | "android" | "desktop"; appareil: string; ville: string | null; pays: string | null; cree_le: number; vu_le: number }>(),
    db
      .prepare(
        `SELECT g.id, g.nom, m.role, (SELECT COUNT(*) FROM membres x WHERE x.groupe_id = g.id) AS membres
         FROM membres m JOIN groupes g ON g.id = m.groupe_id WHERE m.utilisateur_id = ?1 ORDER BY g.nom COLLATE NOCASE`,
      )
      .bind(id)
      .all<{ id: string; nom: string; role: "admin" | "membre"; membres: number }>(),
    db
      .prepare(
        `SELECT (SELECT COUNT(*) FROM contacts WHERE proprietaire_id = ?1) AS contacts,
                (SELECT COUNT(*) FROM signalements WHERE auteur_id = ?1) AS faits`,
      )
      .bind(id)
      .first<{ contacts: number; faits: number }>(),
    signalementsOu(c, "s.type = 'personne' AND s.cible_id = ?1 ORDER BY s.cree_le DESC LIMIT 20", [id]),
  ]);
  return {
    ...versCompte(c, l),
    infos: l.infos,
    motifSuspension: l.motif_suspension,
    sessions: sessions.results.map((s) => ({ id: s.id, plateforme: s.plateforme, appareil: s.appareil, ville: s.ville, pays: s.pays, creeLe: s.cree_le, vuLe: s.vu_le })),
    groupes: groupes.results,
    contacts: compteurs?.contacts ?? 0,
    signalementsFaits: compteurs?.faits ?? 0,
    recus,
  };
}

admin.post("/utilisateurs/:id/suspension", async (c) => {
  const { motif } = await corpsJson(c, schemaSuspension);
  const u = await compteVise(c);
  const maintenant = c.get("deps").maintenant();
  if (!(await suspendre(c.env, u.id, motif, maintenant))) throw refus.conflit("Ce compte est déjà suspendu.");
  await tracer(c.env.DB, { admin: await administrateur(c), action: "suspension", cibleType: "utilisateur", cibleId: u.id, cibleNom: u.nom, detail: motif, maintenant }).run();
  return c.json(await fiche(c, u.id));
});

admin.delete("/utilisateurs/:id/suspension", async (c) => {
  const u = await compteVise(c);
  const maintenant = c.get("deps").maintenant();
  if (!(await leverSuspension(c.env, u.id, maintenant))) throw refus.conflit("Ce compte n'est pas suspendu.");
  await tracer(c.env.DB, { admin: await administrateur(c), action: "suspension_levee", cibleType: "utilisateur", cibleId: u.id, cibleNom: u.nom, maintenant }).run();
  return c.json(await fiche(c, u.id));
});

/** Tous ses appareils déconnectés (compte qu'on croit volé) : ils devront repasser par Google. */
admin.post("/utilisateurs/:id/deconnexion", async (c) => {
  const u = await compteVise(c);
  const maintenant = c.get("deps").maintenant();
  const nombre = await fermerSessions(c.env, u.id, "revoquee", maintenant);
  await tracer(c.env.DB, {
    admin: await administrateur(c),
    action: "deconnexion",
    cibleType: "utilisateur",
    cibleId: u.id,
    cibleNom: u.nom,
    detail: `${nombre} appareil${nombre > 1 ? "s" : ""}`,
    maintenant,
  }).run();
  return c.json(await fiche(c, u.id));
});

admin.delete("/utilisateurs/:id", async (c) => {
  const { confirmation } = await corpsJson(c, schemaSuppressionAdmin);
  exigerConnexionRecente(c);
  const u = await compteVise(c);
  // Recopier le nom d'utilisateur (ou l'adresse, inscription inachevée) : pas de suppression par erreur.
  if (confirmation !== (u.pseudo ?? u.email)) throw refus.requete("La confirmation ne correspond pas à ce compte.");
  const maintenant = c.get("deps").maintenant();
  const trace = tracer(c.env.DB, {
    admin: await administrateur(c),
    action: "suppression_compte",
    cibleType: "utilisateur",
    cibleId: u.id,
    cibleNom: u.pseudo ? `${u.nom} (@${u.pseudo})` : u.nom,
    maintenant,
  });
  await supprimerCompte(c.env, u.id);
  await trace.run();
  return c.body(null, 204);
});

// --- Groupes ---------------------------------------------------------------------------

admin.post("/groupes/:id/fermeture", async (c) => {
  const { motif } = await corpsJson(c, schemaFermetureGroupe);
  exigerConnexionRecente(c);
  const groupe = await c.env.DB.prepare("SELECT id, nom FROM groupes WHERE id = ?1").bind(c.req.param("id")).first<{ id: string; nom: string }>();
  if (!groupe) throw refus.introuvable("Ce groupe n'existe plus.");
  const maintenant = c.get("deps").maintenant();
  const qui = await administrateur(c);
  await fermerGroupe(c.env, groupe.id, maintenant);
  await c.env.DB.batch([
    traiterSurLaCible(c.env.DB, groupe.id, "groupe_ferme", qui.id, maintenant),
    tracer(c.env.DB, { admin: qui, action: "fermeture_groupe", cibleType: "groupe", cibleId: groupe.id, cibleNom: groupe.nom, detail: motif, maintenant }),
  ]);
  return c.body(null, 204);
});

// --- Signalements --------------------------------------------------------------------

interface LigneSignalement {
  id: string;
  type: "personne" | "groupe";
  auteur_id: string;
  auteur_nom: string | null;
  auteur_pseudo: string | null;
  cible_id: string;
  cible_nom: string | null;
  cible_pseudo: string | null;
  cible_suspendu: number | null;
  cible_membres: number;
  messages: string;
  cree_le: number;
  traite_le: number | null;
  decision: Decision | null;
  traite_par_nom: string | null;
  sur_la_cible: number;
}

async function signalementsOu(c: Context<AppEnv>, ou: string, valeurs: unknown[]): Promise<SignalementAdmin[]> {
  const db = c.env.DB;
  const { results } = await db
    .prepare(
      `SELECT s.id, s.type, s.auteur_id, s.cible_id, s.messages, s.cree_le, s.traite_le, s.decision,
         a.nom AS auteur_nom, a.pseudo AS auteur_pseudo,
         CASE s.type WHEN 'personne' THEN (SELECT nom FROM utilisateurs WHERE id = s.cible_id)
                     ELSE (SELECT nom FROM groupes WHERE id = s.cible_id) END AS cible_nom,
         (SELECT pseudo FROM utilisateurs WHERE id = s.cible_id) AS cible_pseudo,
         (SELECT suspendu_le FROM utilisateurs WHERE id = s.cible_id) AS cible_suspendu,
         (SELECT COUNT(*) FROM membres WHERE groupe_id = s.cible_id) AS cible_membres,
         (SELECT COUNT(*) FROM signalements o WHERE o.cible_id = s.cible_id AND o.traite_le IS NULL) AS sur_la_cible,
         (SELECT nom FROM utilisateurs WHERE id = s.traite_par) AS traite_par_nom
       FROM signalements s LEFT JOIN utilisateurs a ON a.id = s.auteur_id
       WHERE ${ou}`,
    )
    .bind(...valeurs)
    .all<LigneSignalement>();

  const messages = new Map(results.map((l) => [l.id, lireMessages(l.messages)]));
  const ids = [...new Set([...messages.values()].flat().map((m) => m.de))];
  const noms = ids.length
    ? (await db.prepare("SELECT id, nom FROM utilisateurs WHERE id IN (SELECT value FROM json_each(?1))").bind(JSON.stringify(ids)).all<{ id: string; nom: string }>()).results
    : [];
  const auteurs = Object.fromEntries(noms.map((n) => [n.id, n.nom]));

  return results.map((l) => {
    const joints = messages.get(l.id) ?? [];
    return {
      id: l.id,
      type: l.type,
      creeLe: l.cree_le,
      auteur: l.auteur_nom === null ? null : { id: l.auteur_id, nom: l.auteur_nom, pseudo: l.auteur_pseudo },
      cible:
        l.type === "personne"
          ? { id: l.cible_id, nom: l.cible_nom ?? "Compte supprimé", pseudo: l.cible_pseudo, suspenduLe: l.cible_suspendu, admin: estAdmin(c.env, l.cible_id), existe: l.cible_nom !== null }
          : { id: l.cible_id, nom: l.cible_nom ?? "Groupe fermé", membres: l.cible_membres, existe: l.cible_nom !== null },
      messages: joints,
      auteurs: Object.fromEntries(joints.map((m) => [m.de, auteurs[m.de] ?? "Compte supprimé"])),
      surLaCible: l.sur_la_cible,
      traiteLe: l.traite_le,
      decision: l.decision,
      traitePar: l.traite_par_nom,
    };
  });
}

function lireMessages(json: string): MessageSignale[] {
  try {
    const brut = JSON.parse(json) as unknown;
    return Array.isArray(brut) ? (brut as MessageSignale[]) : [];
  } catch {
    return [];
  }
}

/** Ouverts : les plus anciens d'abord, comme une file. Traités : les plus récents d'abord. */
admin.get("/signalements", async (c) => {
  const traites = c.req.query("etat") === "traites";
  const liste = traites
    ? await signalementsOu(c, "s.traite_le IS NOT NULL ORDER BY s.traite_le DESC LIMIT ?1", [PAGE_ADMIN])
    : await signalementsOu(c, "s.traite_le IS NULL ORDER BY s.cree_le LIMIT ?1", [2 * PAGE_ADMIN]);
  return c.json({ signalements: liste });
});

/** Les autres signalements encore ouverts sur la même cible suivent la même décision. */
const traiterSurLaCible = (db: D1Database, cibleId: string, decision: Decision, par: string, maintenant: number) =>
  db.prepare("UPDATE signalements SET traite_le = ?1, decision = ?2, traite_par = ?3 WHERE cible_id = ?4 AND traite_le IS NULL").bind(maintenant, decision, par, cibleId);

admin.post("/signalements/:id/decision", async (c) => {
  const { decision, motif } = await corpsJson(c, schemaDecision);
  const db = c.env.DB;
  const s = await db.prepare("SELECT id, type, cible_id, traite_le FROM signalements WHERE id = ?1").bind(c.req.param("id")).first<{
    id: string;
    type: "personne" | "groupe";
    cible_id: string;
    traite_le: number | null;
  }>();
  if (!s) throw refus.introuvable("Ce signalement n'existe plus.");
  if (s.traite_le) throw refus.conflit("Ce signalement a déjà été traité.");
  const maintenant = c.get("deps").maintenant();
  const qui = await administrateur(c);

  if (decision === "classe") {
    await db.batch([
      db.prepare("UPDATE signalements SET traite_le = ?1, decision = 'classe', traite_par = ?2 WHERE id = ?3").bind(maintenant, qui.id, s.id),
      tracer(db, { admin: qui, action: "signalement_classe", cibleType: "signalement", cibleId: s.id, cibleNom: null, maintenant }),
    ]);
    return c.body(null, 204);
  }

  if (decision === "suspendu") {
    if (s.type !== "personne") throw refus.requete("Seul un compte peut être suspendu.");
    const u = await db.prepare("SELECT id, nom, suspendu_le FROM utilisateurs WHERE id = ?1").bind(s.cible_id).first<{ id: string; nom: string; suspendu_le: number | null }>();
    if (!u) throw refus.introuvable("Ce compte n'existe plus.");
    if (estAdmin(c.env, u.id)) throw refus.interdit("Un compte d'administration ne se gère pas depuis cet espace.");
    if (!u.suspendu_le) await suspendre(c.env, u.id, motif!, maintenant);
    await db.batch([
      traiterSurLaCible(db, u.id, "suspendu", qui.id, maintenant),
      tracer(db, { admin: qui, action: "suspension", cibleType: "utilisateur", cibleId: u.id, cibleNom: u.nom, detail: motif, maintenant }),
    ]);
    return c.body(null, 204);
  }

  if (s.type !== "groupe") throw refus.requete("Seul un groupe peut être fermé.");
  exigerConnexionRecente(c);
  const groupe = await db.prepare("SELECT id, nom FROM groupes WHERE id = ?1").bind(s.cible_id).first<{ id: string; nom: string }>();
  if (groupe) await fermerGroupe(c.env, groupe.id, maintenant);
  await db.batch([
    traiterSurLaCible(db, s.cible_id, "groupe_ferme", qui.id, maintenant),
    tracer(db, { admin: qui, action: "fermeture_groupe", cibleType: "groupe", cibleId: s.cible_id, cibleNom: groupe?.nom ?? null, detail: motif, maintenant }),
  ]);
  return c.body(null, 204);
});

// --- Journal ---------------------------------------------------------------------------

admin.get("/journal", async (c) => {
  const avant = Number(c.req.query("avant")) || Number.MAX_SAFE_INTEGER;
  const { results } = await c.env.DB.prepare(
    `SELECT id, admin_nom, action, cible_type, cible_id, cible_nom, detail, cree_le FROM actions_admin
     WHERE cree_le < ?1 ORDER BY cree_le DESC LIMIT ${PAGE_ADMIN + 1}`,
  )
    .bind(avant)
    .all<{ id: string; admin_nom: string; action: ActionAdmin["action"]; cible_type: ActionAdmin["cibleType"]; cible_id: string; cible_nom: string | null; detail: string | null; cree_le: number }>();
  const page = results.slice(0, PAGE_ADMIN);
  return c.json({
    actions: page.map(
      (a): ActionAdmin => ({
        id: a.id,
        adminNom: a.admin_nom,
        action: a.action,
        cibleType: a.cible_type,
        cibleId: a.cible_id,
        cibleNom: a.cible_nom,
        detail: a.detail,
        creeLe: a.cree_le,
      }),
    ),
    suite: results.length > PAGE_ADMIN ? page.at(-1)!.cree_le : null,
  });
});
