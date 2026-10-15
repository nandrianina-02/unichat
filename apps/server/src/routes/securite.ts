import { Hono } from "hono";
import type { EvenementSecurite, TypeEvenement } from "@unichat/shared";
import type { AppEnv } from "../types";
import { exigerSession } from "./garde";

export const securite = new Hono<AppEnv>();
securite.use("*", exigerSession);

interface LigneEvenement {
  id: string;
  type: TypeEvenement;
  session_id: string | null;
  appareil: string | null;
  ville: string | null;
  pays: string | null;
  cree_le: number;
  session_active: number;
}

const versEvenement = (e: LigneEvenement): EvenementSecurite => ({
  id: e.id,
  type: e.type,
  sessionId: e.session_id,
  appareil: e.appareil,
  ville: e.ville,
  pays: e.pays,
  creeLe: e.cree_le,
  sessionActive: e.session_active === 1,
});

const SELECTION = `
  SELECT e.*, (s.id IS NOT NULL AND s.revoquee_le IS NULL AND s.expire_le > ?2) AS session_active
  FROM evenements_securite e LEFT JOIN sessions s ON s.id = e.session_id`;

securite.get("/evenements", async (c) => {
  const { results } = await c.env.DB.prepare(
    `${SELECTION} WHERE e.utilisateur_id = ?1 ORDER BY e.cree_le DESC LIMIT 50`,
  )
    .bind(c.get("session").utilisateur_id, c.get("deps").maintenant())
    .all<LigneEvenement>();
  return c.json({ evenements: results.map(versEvenement) });
});

/**
 * Connexions survenues sur d'autres appareils depuis que celui-ci les a vues
 * (ou depuis son arrivée) : « Nouvelle connexion — ce n'est pas vous ? ».
 */
securite.get("/alertes", async (c) => {
  const session = c.get("session");
  const depuis = Math.max(session.cree_le, session.alertes_vues_le);
  const { results } = await c.env.DB.prepare(
    `${SELECTION}
     WHERE e.utilisateur_id = ?1 AND e.type = 'connexion' AND e.cree_le > ?3 AND e.session_id <> ?4
     ORDER BY e.cree_le DESC LIMIT 5`,
  )
    .bind(session.utilisateur_id, c.get("deps").maintenant(), depuis, session.id)
    .all<LigneEvenement>();
  return c.json({ alertes: results.map(versEvenement) });
});

securite.post("/alertes/vues", async (c) => {
  await c.env.DB.prepare("UPDATE sessions SET alertes_vues_le = ?1 WHERE id = ?2")
    .bind(c.get("deps").maintenant(), c.get("session").id)
    .run();
  return c.body(null, 204);
});
