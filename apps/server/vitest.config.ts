import { cloudflareTest, readD1Migrations } from "@cloudflare/vitest-plugin";
import { defineConfig } from "vitest/config";

// Les tests tournent dans le moteur des Workers (workerd), avec une base D1
// locale à laquelle on applique les vraies migrations.
export default defineConfig(async () => {
  const migrations = await readD1Migrations("./migrations");
  // Clé VAPID propre aux tests, recréée à chaque lancement : rien de secret.
  const paire = (await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, ["sign", "verify"])) as CryptoKeyPair;
  const vapid = JSON.stringify(await crypto.subtle.exportKey("jwk", paire.privateKey));
  return {
    plugins: [
      cloudflareTest({
        wrangler: { configPath: "./wrangler.jsonc" },
        miniflare: {
          bindings: { TEST_MIGRATIONS: migrations, VAPID_PRIVEE: vapid },
          // Requêtes sortantes des boîtes (notifications) : un faux service de
          // notification. Un abonnement « disparu » répond 410, comme une
          // application désinstallée ; tout le reste est refusé.
          outboundService: (requete: Request) => {
            const url = new URL(requete.url);
            if (url.hostname === "fcm.googleapis.com") return new Response(null, { status: url.pathname.includes("disparu") ? 410 : 201 });
            return new Response("hors ligne", { status: 502 });
          },
        },
      }),
    ],
    test: {
      setupFiles: ["./test/preparation.ts"],
    },
  };
});
