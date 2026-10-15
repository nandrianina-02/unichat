import type { Context } from "hono";
import { getCookie } from "hono/cookie";
import { verifierSession } from "../lib/sessions";
import type { AppEnv } from "../types";
import { COOKIE_SESSION } from "./outils";

/**
 * Ouverture de la connexion temps réel, confiée à la boîte de l'utilisateur.
 *
 * Le navigateur joint le cookie de session à une connexion WebSocket ouverte
 * depuis n'importe quel site : l'origine doit donc être celle d'UniChat
 * (protection contre le détournement de connexion entre sites).
 */
export async function ouvrirTempsReel(c: Context<AppEnv>): Promise<Response> {
  if (c.req.header("Upgrade")?.toLowerCase() !== "websocket") {
    return c.json({ erreur: "websocket_attendu", message: "Connexion WebSocket attendue." }, 426);
  }
  const porteur = /^Bearer\s+(\S+)$/i.exec(c.req.header("Authorization") ?? "")?.[1];
  const jeton = porteur ?? getCookie(c, COOKIE_SESSION, "host");
  if (!jeton) return c.json({ erreur: "non_connecte", message: "Connectez-vous pour continuer." }, 401);
  if (!porteur && c.req.header("Origin") !== new URL(c.req.url).origin) {
    return c.json({ erreur: "interdit", message: "Connexion refusée : elle ne vient pas d'UniChat." }, 403);
  }

  const resultat = await verifierSession(c.env.DB, jeton, c.get("deps").maintenant(), { renouveler: false });
  if (resultat.etat !== "valide") return c.json({ erreur: "non_connecte", message: "Session fermée." }, 401);

  const s = resultat.session;
  const boite = c.env.BOITE.get(c.env.BOITE.idFromName(s.utilisateur_id));
  return boite.fetch(
    new Request(c.req.url, {
      headers: {
        Upgrade: "websocket",
        "X-UniChat-Session": s.id,
        "X-UniChat-Utilisateur": s.utilisateur_id,
        "X-UniChat-Expire": String(s.expire_le),
      },
    }),
  );
}
