import { Hono } from "hono";
import type { AppareilConnecte } from "@unichat/shared";
import { fermerConnexions } from "../lib/connexions";
import { refus } from "../lib/erreurs";
import { revoquer, sessionsActives, type LigneSession } from "../lib/sessions";
import type { AppEnv } from "../types";
import { exigerSession } from "./garde";
import { COOKIE_SESSION, effacerCookie } from "./outils";

export const appareils = new Hono<AppEnv>();
appareils.use("*", exigerSession);

function versAppareil(s: LigneSession, actuelle: string): AppareilConnecte {
  return {
    id: s.id,
    plateforme: s.plateforme,
    appareil: s.appareil,
    ville: s.ville,
    pays: s.pays,
    creeLe: s.cree_le,
    vuLe: s.vu_le,
    actuel: s.id === actuelle,
  };
}

appareils.get("/", async (c) => {
  const session = c.get("session");
  const liste = await sessionsActives(c.env.DB, session.utilisateur_id, c.get("deps").maintenant());
  return c.json({ appareils: liste.map((s) => versAppareil(s, session.id)) });
});

appareils.delete("/:id", async (c) => {
  const session = c.get("session");
  const cible = await c.env.DB.prepare(
    "SELECT * FROM sessions WHERE id = ?1 AND utilisateur_id = ?2 AND revoquee_le IS NULL",
  )
    .bind(c.req.param("id"), session.utilisateur_id)
    .first<LigneSession>();
  if (!cible) throw refus.introuvable("Cet appareil n'est plus connecté.");
  const estActuelle = cible.id === session.id;
  await revoquer(c.env.DB, cible, estActuelle ? "deconnexion" : "revoquee", c.get("deps").maintenant());
  await fermerConnexions(c.env, session.utilisateur_id, [cible.id]);
  if (estActuelle) effacerCookie(c, COOKIE_SESSION);
  return c.body(null, 204);
});

appareils.post("/deconnecter-autres", async (c) => {
  const session = c.get("session");
  const maintenant = c.get("deps").maintenant();
  const autres = (await sessionsActives(c.env.DB, session.utilisateur_id, maintenant)).filter((s) => s.id !== session.id);
  for (const s of autres) await revoquer(c.env.DB, s, "revoquee", maintenant);
  await fermerConnexions(
    c.env,
    session.utilisateur_id,
    autres.map((s) => s.id),
  );
  return c.json({ nombre: autres.length });
});
