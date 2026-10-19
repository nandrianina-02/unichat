// Service worker d'UniChat : l'application s'ouvre même hors connexion
// (l'historique est sur l'appareil), et les notifications arrivent même
// quand elle est fermée (Web Push). L'API n'est jamais mise en cache.

// Déchiffrement des notifications (construit à part : vite.sw.config.ts).
// Sans lui, les notifications gardent leur texte générique.
try {
  importScripts("/sw-dechiffrement.js");
} catch {
  // Fichier absent (serveur de développement) : rien à déchiffrer.
}

const COQUILLE = "unichat-coquille-v1";
const FICHIERS = "unichat-fichiers-v1";
const ESSENTIELS = ["/", "/theme.js", "/icone.svg", "/manifest.webmanifest", "/icones/icone-192.png", "/icones/icone-badge.png"];
/** Fichiers de construction gardés : ils sont versionnés, les anciens finissent par sortir. */
const FICHIERS_MAX = 80;

self.addEventListener("install", (e) => {
  e.waitUntil(
    caches
      .open(COQUILLE)
      .then((c) => c.addAll(ESSENTIELS))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches
      .keys()
      .then((cles) => Promise.all(cles.filter((c) => c !== COQUILLE && c !== FICHIERS).map((c) => caches.delete(c))))
      .then(() => self.clients.claim()),
  );
});

async function garder(cache, requete, reponse) {
  await cache.put(requete, reponse);
  const cles = await cache.keys();
  for (const ancienne of cles.slice(0, Math.max(0, cles.length - FICHIERS_MAX))) await cache.delete(ancienne);
}

self.addEventListener("fetch", (e) => {
  const requete = e.request;
  if (requete.method !== "GET") return;
  const url = new URL(requete.url);
  if (url.origin !== self.location.origin || url.pathname.startsWith("/api/")) return;

  // Fichiers de construction : leur nom change avec leur contenu, le cache suffit.
  if (url.pathname.startsWith("/assets/")) {
    e.respondWith(
      caches.open(FICHIERS).then(async (cache) => {
        const garde = await cache.match(requete);
        if (garde) return garde;
        const reponse = await fetch(requete);
        if (reponse.ok) e.waitUntil(garder(cache, requete, reponse.clone()));
        return reponse;
      }),
    );
    return;
  }

  // Pages : le réseau d'abord (une mise en ligne se voit tout de suite), la
  // dernière version gardée sinon. Toute adresse de l'application retombe
  // sur la page principale, comme le fait le serveur.
  if (requete.mode === "navigate") {
    const statique = url.pathname === "/confidentialite" || url.pathname === "/conditions";
    e.respondWith(
      fetch(requete)
        .then((reponse) => {
          if (reponse.ok) {
            const copie = reponse.clone();
            e.waitUntil(caches.open(COQUILLE).then((c) => c.put(statique ? requete : "/", copie)));
          }
          return reponse;
        })
        .catch(async () => (await caches.match(statique ? requete : "/")) ?? Response.error()),
    );
    return;
  }

  // Le reste (icônes, thème) : ce qui est gardé, rafraîchi en arrière-plan.
  e.respondWith(
    caches.open(COQUILLE).then(async (cache) => {
      const garde = await cache.match(requete);
      const frais = fetch(requete)
        .then((reponse) => {
          if (reponse.ok) e.waitUntil(cache.put(requete, reponse.clone()));
          return reponse;
        })
        .catch(() => garde ?? Response.error());
      return garde ?? frais;
    }),
  );
});

// --- Notifications -------------------------------------------------------------

/** Une fenêtre d'UniChat est sous les yeux : elle affiche elle-même ce qui arrive. */
async function fenetreVisible() {
  const fenetres = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
  return fenetres.some((f) => f.visibilityState === "visible");
}

self.addEventListener("push", (e) => {
  let donnees = {};
  try {
    donnees = e.data ? e.data.json() : {};
  } catch {
    donnees = {};
  }
  e.waitUntil(
    (async () => {
      if (await fenetreVisible()) return;
      const titre = donnees.titre || "UniChat";
      let corps = donnees.corps || "Nouveau message";
      // Message chiffré : déchiffré ici même, sans que le serveur l'ait lu.
      if (donnees.chiffre && typeof self.dechiffrerNotification === "function") {
        const texte = await self.dechiffrerNotification(donnees).catch(() => null);
        if (texte) {
          const groupe = String(donnees.conversation || "").startsWith("g:");
          corps = (groupe && donnees.auteur ? `${donnees.auteur} : ${texte}` : texte).slice(0, 200);
        }
      }
      await self.registration.showNotification(titre, {
        body: corps,
        tag: donnees.conversation || "unichat",
        renotify: true,
        icon: "/icones/icone-192.png",
        badge: "/icones/icone-badge.png",
        data: { conversation: donnees.conversation || null },
      });
    })(),
  );
});

self.addEventListener("notificationclick", (e) => {
  e.notification.close();
  const conversation = e.notification.data && e.notification.data.conversation;
  e.waitUntil(
    (async () => {
      const fenetres = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
      const fenetre = fenetres[0];
      if (fenetre) {
        await fenetre.focus();
        if (conversation) fenetre.postMessage({ type: "ouvrir", conversation });
        return;
      }
      await self.clients.openWindow(conversation ? `/?conversation=${encodeURIComponent(conversation)}` : "/");
    })(),
  );
});

// Abonnement renouvelé par le navigateur : on prévient le serveur.
self.addEventListener("pushsubscriptionchange", (e) => {
  e.waitUntil(
    (async () => {
      const ancien = e.oldSubscription;
      const options = ancien && ancien.options ? ancien.options : null;
      if (!options) return;
      const nouveau = e.newSubscription || (await self.registration.pushManager.subscribe(options));
      await fetch("/api/push", {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(nouveau.toJSON()),
      });
    })(),
  );
});
