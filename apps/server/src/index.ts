import { creerApp } from "./app";
import { nettoyer } from "./lib/nettoyage";
import type { Bindings } from "./types";

export { Boite } from "./temps-reel/boite";

const app = creerApp();

export default {
  fetch: app.fetch,
  async scheduled(_controleur, env, ctx) {
    ctx.waitUntil(nettoyer(env, Date.now(), (entree, init) => fetch(entree, init)));
  },
} satisfies ExportedHandler<Bindings>;
