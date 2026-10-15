import { Hono } from "hono";
import { secureHeaders } from "hono/secure-headers";
import { Refus } from "./lib/erreurs";
import { contacts, personnes, recherche } from "./routes/annuaire";
import { appareils } from "./routes/appareils";
import { auth } from "./routes/auth";
import { groupes } from "./routes/groupes";
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

  app.notFound((c) => c.json({ erreur: "introuvable", message: "Adresse inconnue." }, 404));
  app.onError((erreur, c) => {
    if (erreur instanceof Refus) return c.json({ erreur: erreur.code, message: erreur.message }, erreur.statut);
    console.error("erreur non prévue", erreur);
    return c.json({ erreur: "interne", message: "Une erreur est survenue. Réessayez dans un instant." }, 500);
  });
  return app;
}
