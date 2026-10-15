import { getCookie } from "hono/cookie";
import { createMiddleware } from "hono/factory";
import { Refus, refus } from "../lib/erreurs";
import { verifierSession } from "../lib/sessions";
import type { AppEnv } from "../types";
import { COOKIE_SESSION, effacerCookie, poserCookieSession } from "./outils";

const LECTURE = new Set(["GET", "HEAD", "OPTIONS"]);

/**
 * Exige une session valide. Web : cookie ; Android et desktop : en-tête
 * Authorization. Le jeton renouvelé repart par le même canal.
 */
export const exigerSession = createMiddleware<AppEnv>(async (c, next) => {
  const porteur = /^Bearer\s+(\S+)$/i.exec(c.req.header("Authorization") ?? "")?.[1];
  const jeton = porteur ?? getCookie(c, COOKIE_SESSION, "host");
  if (!jeton) throw refus.nonConnecte();

  // Un cookie part avec toute requête vers le site, même lancée depuis une
  // autre page : celles qui modifient quelque chose doivent venir d'UniChat.
  if (!porteur && !LECTURE.has(c.req.method) && c.req.header("Origin") !== new URL(c.req.url).origin) {
    throw refus.interdit("Requête refusée : elle ne vient pas d'UniChat.");
  }

  const resultat = await verifierSession(c.env.DB, jeton, c.get("deps").maintenant());
  if (resultat.etat !== "valide") {
    if (!porteur) effacerCookie(c, COOKIE_SESSION);
    if (resultat.etat === "revoquee" && resultat.motif === "reutilisation") {
      throw new Refus(
        401,
        "session_compromise",
        "Session fermée par sécurité : une ancienne clé de connexion a été réutilisée. Reconnectez-vous.",
      );
    }
    throw refus.nonConnecte();
  }

  if (resultat.nouveauJeton) {
    if (porteur) c.header("X-UniChat-Jeton", resultat.nouveauJeton);
    else poserCookieSession(c, resultat.nouveauJeton);
  }
  c.set("session", resultat.session);
  await next();
});
