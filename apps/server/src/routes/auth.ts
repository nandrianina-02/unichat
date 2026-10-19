import { Hono } from "hono";
import { getCookie } from "hono/cookie";
import { trouverOuCreerCompte } from "../lib/comptes";
import { fermerConnexions } from "../lib/connexions";
import { aleatoire, defiPkce, empreinte } from "../lib/crypto";
import { autoriser } from "../lib/limites";
import { nomAppareil } from "../lib/appareil";
import {
  ErreurAdresseNonVerifiee,
  echangerCode,
  urlAutorisation,
  verifierJetonIdentite,
  type ConfigGoogle,
} from "../lib/google";
import { creerSession, revoquer } from "../lib/sessions";
import type { AppEnv } from "../types";
import { exigerSession } from "./garde";
import { COOKIE_ETAT, COOKIE_SESSION, MINUTE, effacerCookie, ip, lieu, poserCookie, poserCookieSession } from "./outils";

const DUREE_ETAT = 10 * MINUTE;

export const auth = new Hono<AppEnv>();

function configuration(env: AppEnv["Bindings"]): ConfigGoogle | null {
  if (!env.GOOGLE_CLIENT_ID || !env.GOOGLE_CLIENT_SECRET) return null;
  return { clientId: env.GOOGLE_CLIENT_ID, clientSecret: env.GOOGLE_CLIENT_SECRET };
}

function redirection(url: string): string {
  return `${new URL(url).origin}/api/auth/google/rappel`;
}

// Ces deux routes sont ouvertes par une navigation, pas par un appel de
// l'application : les erreurs reviennent donc à la page d'accueil, avec un
// code que l'interface traduit.

auth.get("/google", async (c) => {
  const maintenant = c.get("deps").maintenant();
  const config = configuration(c.env);
  if (!config) return c.redirect("/?erreur=configuration", 302);
  const limite = await autoriser(c.env.DB, `connexion:${ip(c)}`, 20, 10 * MINUTE, maintenant);
  if (!limite.ok) return c.redirect("/?erreur=trop_de_demandes", 302);

  const etat = aleatoire(32);
  const verificateur = aleatoire(32);
  const nonce = aleatoire(16);
  await c.env.DB.prepare(
    "INSERT INTO etats_oauth (etat_hash, verificateur, nonce, plateforme, cree_le) VALUES (?1, ?2, ?3, 'web', ?4)",
  )
    .bind(await empreinte(etat), verificateur, nonce, maintenant)
    .run();

  // Le `state` est aussi lié à ce navigateur : une adresse de retour forgée
  // par un tiers (avec son propre code) ne pourra pas ouvrir sa session ici.
  poserCookie(c, COOKIE_ETAT, etat, DUREE_ETAT);
  return c.redirect(
    urlAutorisation(config, { redirection: redirection(c.req.url), etat, nonce, defi: await defiPkce(verificateur) }),
    302,
  );
});

auth.get("/google/rappel", async (c) => {
  const { recuperer, maintenant: horloge } = c.get("deps");
  const maintenant = horloge();
  const echec = (code: string) => {
    effacerCookie(c, COOKIE_ETAT);
    return c.redirect(`/?erreur=${code}`, 302);
  };

  const config = configuration(c.env);
  if (!config) return echec("configuration");
  const limite = await autoriser(c.env.DB, `rappel:${ip(c)}`, 30, 10 * MINUTE, maintenant);
  if (!limite.ok) return echec("trop_de_demandes");
  if (c.req.query("error")) return echec("connexion_annulee");

  const etat = c.req.query("state");
  const code = c.req.query("code");
  const etatNavigateur = getCookie(c, COOKIE_ETAT, "host");
  if (!etat || !code || !etatNavigateur || etatNavigateur !== etat) return echec("etat_invalide");

  // Usage unique : la ligne est supprimée dès la lecture.
  const attente = await c.env.DB.prepare(
    "DELETE FROM etats_oauth WHERE etat_hash = ?1 RETURNING verificateur, nonce, cree_le",
  )
    .bind(await empreinte(etat))
    .first<{ verificateur: string; nonce: string; cree_le: number }>();
  if (!attente || maintenant - attente.cree_le > DUREE_ETAT) return echec("etat_invalide");

  let identite;
  try {
    const jetonIdentite = await echangerCode(recuperer, config, {
      code,
      redirection: redirection(c.req.url),
      verificateur: attente.verificateur,
    });
    identite = await verifierJetonIdentite(recuperer, config, jetonIdentite, attente.nonce, maintenant);
  } catch (erreur) {
    console.warn("connexion Google refusée :", erreur instanceof Error ? erreur.message : String(erreur));
    return echec(erreur instanceof ErreurAdresseNonVerifiee ? "email_non_verifie" : "google");
  }

  const utilisateurId = await trouverOuCreerCompte(c.env.DB, recuperer, identite, maintenant);
  const suspension = await c.env.DB.prepare("SELECT suspendu_le FROM utilisateurs WHERE id = ?1").bind(utilisateurId).first<{ suspendu_le: number | null }>();
  if (suspension?.suspendu_le) return echec("compte_suspendu");
  const { jeton } = await creerSession(
    c.env.DB,
    { utilisateurId, plateforme: "web", appareil: nomAppareil(c.req.header("User-Agent")), ...lieu(c) },
    maintenant,
  );
  effacerCookie(c, COOKIE_ETAT);
  poserCookieSession(c, jeton);
  return c.redirect("/", 302);
});

auth.post("/deconnexion", exigerSession, async (c) => {
  const session = c.get("session");
  await revoquer(c.env.DB, session, "deconnexion", c.get("deps").maintenant());
  await fermerConnexions(c.env, session.utilisateur_id, [session.id]);
  effacerCookie(c, COOKIE_SESSION);
  return c.body(null, 204);
});
