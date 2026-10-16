import { Hono } from "hono";
import { adresseAutorisee, chercherApercu } from "../lib/apercu";
import { refus } from "../lib/erreurs";
import type { AppEnv } from "../types";
import { exigerSession } from "./garde";
import { MINUTE, limiter } from "./outils";

export const apercu = new Hono<AppEnv>();
apercu.use("*", exigerSession);

/**
 * Aperçu d'un lien, demandé par l'application de l'expéditeur pendant qu'il
 * écrit, comme dans WhatsApp. Le résultat part avec le message : les
 * destinataires n'ouvrent rien. Seul le texte est gardé (titre, description,
 * site) ; aucune image extérieure n'est chargée.
 */
apercu.get("/", async (c) => {
  const moi = c.get("session").utilisateur_id;
  await limiter(c, `apercu:${moi}`, 60, 10 * MINUTE);
  const url = adresseAutorisee(c.req.query("url") ?? "");
  if (!url) throw refus.requete("Adresse non prise en charge.");
  const resultat = await chercherApercu(c.get("deps").recuperer, url);
  c.header("Cache-Control", "private, max-age=3600");
  return c.json(resultat);
});
