import { Hono } from "hono";
import { schemaAbonnementPush } from "@unichat/shared";
import { Refus, refus } from "../lib/erreurs";
import { clePubliqueVapid, serviceAutorise } from "../lib/push";
import type { AppEnv, Bindings } from "../types";
import { exigerSession } from "./garde";
import { MINUTE, corpsJson, limiter } from "./outils";

export const push = new Hono<AppEnv>();
push.use("*", exigerSession);

/** Clé VAPID lue depuis le secret ; mal formée, les notifications sont simplement indisponibles. */
export function vapid(env: Bindings) {
  if (!env.VAPID_PRIVEE) return null;
  try {
    const jwk = JSON.parse(env.VAPID_PRIVEE) as JsonWebKey & { x: string; y: string; d: string };
    if (!jwk.x || !jwk.y || !jwk.d) return null;
    return { jwk, contact: env.VAPID_CONTACT ?? "mailto:contact@unichat.invalid" };
  } catch {
    return null;
  }
}

/** Clé publique à donner au navigateur pour s'abonner. */
push.get("/cle", (c) => {
  const cles = vapid(c.env);
  if (!cles) throw new Refus(503, "notifications_indisponibles", "Les notifications ne sont pas encore configurées sur ce serveur.");
  return c.json({ cle: clePubliqueVapid(cles.jwk) });
});

/** Abonnement de cet appareil ; un même abonnement repris par une autre session lui revient. */
push.post("/", async (c) => {
  const a = await corpsJson(c, schemaAbonnementPush);
  const session = c.get("session");
  await limiter(c, `push:${session.utilisateur_id}`, 30, 60 * MINUTE);
  if (!serviceAutorise(a.endpoint)) throw refus.requete("Service de notification non pris en charge.");
  await c.env.DB.prepare(
    `INSERT INTO abonnements_push (endpoint, session_id, utilisateur_id, p256dh, auth, cree_le)
     VALUES (?1, ?2, ?3, ?4, ?5, ?6)
     ON CONFLICT (endpoint) DO UPDATE SET session_id = excluded.session_id, utilisateur_id = excluded.utilisateur_id,
       p256dh = excluded.p256dh, auth = excluded.auth, cree_le = excluded.cree_le`,
  )
    .bind(a.endpoint, session.id, session.utilisateur_id, a.keys.p256dh, a.keys.auth, c.get("deps").maintenant())
    .run();
  return c.json({ ok: true }, 201);
});

push.delete("/", async (c) => {
  const { endpoint } = await corpsJson(c, schemaAbonnementPush.pick({ endpoint: true }));
  await c.env.DB.prepare("DELETE FROM abonnements_push WHERE endpoint = ?1 AND utilisateur_id = ?2")
    .bind(endpoint, c.get("session").utilisateur_id)
    .run();
  return c.body(null, 204);
});
