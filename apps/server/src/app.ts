import { Hono } from "hono";
import { secureHeaders } from "hono/secure-headers";
import { Refus } from "./lib/erreurs";
import { contacts, personnes, recherche } from "./routes/annuaire";
import { apercu } from "./routes/apercu";
import { appareils } from "./routes/appareils";
import { auth } from "./routes/auth";
import { groupes } from "./routes/groupes";
import { invitations } from "./routes/invitations";
import { medias } from "./routes/medias";
import { push } from "./routes/push";
import { blocages, signalements } from "./routes/moderation";
import { moi } from "./routes/moi";
import { securite } from "./routes/securite";
import { ouvrirTempsReel } from "./routes/temps-reel";
import type { AppEnv, Dependances } from "./types";

export function creerApp(remplacements: Partial<Dependances> = {}) {
  const deps: Dependances = {
    // Enveloppé : appelée comme méthode d'un objet, `fetch` perdrait son
    // contexte et le moteur des Workers la refuserait.
    recuperer: remplacements.recuperer ?? ((entree, init) => fetch(entree, init)),
    maintenant: remplacements.maintenant ?? (() => Date.now()),
  };

  const app = new Hono<AppEnv>();
  app.use("*", async (c, next) => {
    c.set("deps", deps);
    await next();
  });
  // Avant les en-têtes de sécurité : la réponse 101 de la connexion temps
  // réel doit repartir telle quelle, avec son WebSocket.
  app.get("/api/temps-reel", ouvrirTempsReel);
  // Les fichiers de l'application web ont leurs propres en-têtes (_headers) ;
  // ceux-ci couvrent les réponses de l'API.
  app.use("/api/*", secureHeaders({ referrerPolicy: "strict-origin-when-cross-origin" }));

  app.route("/api/auth", auth);
  app.route("/api/moi", moi);
  app.route("/api/sessions", appareils);
  app.route("/api/securite", securite);
  app.route("/api/recherche", recherche);
  app.route("/api/personnes", personnes);
  app.route("/api/contacts", contacts);
  app.route("/api/groupes", groupes);
  app.route("/api/medias", medias);
  app.route("/api/blocages", blocages);
  app.route("/api/signalements", signalements);
  app.route("/api/apercu", apercu);
  app.route("/api/invitations", invitations);
  app.route("/api/push", push);

  // Lien entre le site et l'application Android : sans lui, elle s'ouvrirait
  // avec une barre d'adresse, comme un simple onglet.
  app.get("/.well-known/assetlinks.json", (c) => {
    const empreintes = (c.env.ANDROID_EMPREINTES ?? "").split(",").map((e) => e.trim()).filter(Boolean);
    if (!c.env.ANDROID_PAQUET || empreintes.length === 0) return c.json([]);
    c.header("Cache-Control", "public, max-age=3600");
    return c.json([
      {
        relation: ["delegate_permission/common.handle_all_urls"],
        target: { namespace: "android_app", package_name: c.env.ANDROID_PAQUET, sha256_cert_fingerprints: empreintes },
      },
    ]);
  });

  app.notFound((c) => c.json({ erreur: "introuvable", message: "Adresse inconnue." }, 404));
  app.onError((erreur, c) => {
    if (erreur instanceof Refus) return c.json({ erreur: erreur.code, message: erreur.message }, erreur.statut);
    console.error("erreur non prévue", erreur);
    return c.json({ erreur: "interne", message: "Une erreur est survenue. Réessayez dans un instant." }, 500);
  });
  return app;
}
