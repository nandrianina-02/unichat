import { Hono } from "hono";
import { schemaBlocage, schemaSignalement } from "@unichat/shared";
import { annoncerBlocage } from "../lib/blocages";
import { refus } from "../lib/erreurs";
import { bloquesDe, carte } from "../lib/profils";
import type { AppEnv } from "../types";
import { exigerSession } from "./garde";
import { MINUTE, corpsJson, limiter } from "./outils";

const JOUR = 24 * 60 * MINUTE;

export const blocages = new Hono<AppEnv>();
blocages.use("*", exigerSession);

blocages.get("/", async (c) => c.json({ bloques: await bloquesDe(c.env.DB, c.get("session").utilisateur_id) }));

blocages.post("/", async (c) => {
  const { id } = await corpsJson(c, schemaBlocage);
  const moi = c.get("session").utilisateur_id;
  await limiter(c, `blocage:${moi}`, 60, 60 * MINUTE);
  if (id === moi) throw refus.requete("Vous ne pouvez pas vous bloquer vous-même.");
  if (!(await carte(c.env.DB, id, moi))) throw refus.introuvable("Cette personne n'existe pas ou plus.");
  const maintenant = c.get("deps").maintenant();
  await c.env.DB.prepare("INSERT OR IGNORE INTO blocages (bloqueur_id, bloque_id, bloque_le) VALUES (?1, ?2, ?3)")
    .bind(moi, id, maintenant)
    .run();
  await annoncerBlocage(c.env, moi, id, true, maintenant);
  return c.json(await carte(c.env.DB, id, moi), 201);
});

blocages.delete("/:id", async (c) => {
  const moi = c.get("session").utilisateur_id;
  const id = c.req.param("id");
  const { meta } = await c.env.DB.prepare("DELETE FROM blocages WHERE bloqueur_id = ?1 AND bloque_id = ?2").bind(moi, id).run();
  if (meta.changes > 0) await annoncerBlocage(c.env, moi, id, false, c.get("deps").maintenant());
  const resultat = await carte(c.env.DB, id, moi);
  if (!resultat) throw refus.introuvable("Cette personne n'existe pas ou plus.");
  return c.json(resultat);
});

export const signalements = new Hono<AppEnv>();
signalements.use("*", exigerSession);

/**
 * Signalement d'une personne ou d'un groupe, examiné à la main. L'auteur du
 * signalement joint lui-même les derniers messages reçus : le serveur, qui ne
 * garde rien après la remise, n'a pas d'autre moyen de les connaître.
 */
signalements.post("/", async (c) => {
  const s = await corpsJson(c, schemaSignalement);
  const moi = c.get("session").utilisateur_id;
  await limiter(c, `signalement:${moi}`, 20, JOUR);
  const maintenant = c.get("deps").maintenant();

  if (s.type === "personne") {
    if (s.cible === moi) throw refus.requete("Vous ne pouvez pas vous signaler vous-même.");
    if (!(await carte(c.env.DB, s.cible, moi))) throw refus.introuvable("Cette personne n'existe pas ou plus.");
    // On ne joint que des messages de la personne signalée, jamais ceux d'un tiers.
    if (s.messages.some((m) => m.de !== s.cible)) throw refus.requete("Seuls les messages de cette personne peuvent être joints.");
  } else {
    const groupe = await c.env.DB.prepare("SELECT 1 AS ok FROM groupes WHERE id = ?1").bind(s.cible).first();
    if (!groupe) throw refus.introuvable("Ce groupe n'existe plus.");
    if (s.messages.some((m) => m.de === moi)) throw refus.requete("Vos propres messages ne peuvent pas être joints.");
  }

  const requetes = [
    c.env.DB.prepare(
      "INSERT INTO signalements (id, auteur_id, type, cible_id, messages, cree_le) VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
    ).bind(crypto.randomUUID(), moi, s.type, s.cible, JSON.stringify(s.messages), maintenant),
  ];
  const bloquer = s.type === "personne" && s.bloquer;
  if (bloquer) {
    requetes.push(
      c.env.DB.prepare("INSERT OR IGNORE INTO blocages (bloqueur_id, bloque_id, bloque_le) VALUES (?1, ?2, ?3)").bind(moi, s.cible, maintenant),
    );
  }
  await c.env.DB.batch(requetes);
  if (bloquer) await annoncerBlocage(c.env, moi, s.cible, true, maintenant);
  return c.json({ ok: true }, 201);
});
