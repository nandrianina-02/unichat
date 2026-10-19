/**
 * Notifications du système. Avec le service worker (application installée,
 * Android), elles passent par lui : Chrome pour Android n'accepte que cette
 * voie, et le clic ramène à la bonne discussion même si la page a été fermée.
 */
export async function montrerNotification(
  titre: string,
  options: { corps: string; conversation: string },
  surClic: (conversation: string) => void,
): Promise<void> {
  const enregistrement = "serviceWorker" in navigator ? await navigator.serviceWorker.getRegistration() : undefined;
  if (enregistrement) {
    await enregistrement.showNotification(titre, {
      body: options.corps,
      tag: options.conversation,
      icon: "/icones/icone-192.png",
      badge: "/icones/icone-badge.png",
      data: { conversation: options.conversation },
      // renotify n'est pas dans les types du DOM, mais Chrome le lit : une nouvelle notification de la même discussion sonne.
      ...({ renotify: true } as object),
    });
    return;
  }
  const notification = new Notification(titre, { body: options.corps, tag: options.conversation, icon: "/icones/icone-192.png" });
  notification.onclick = () => {
    window.focus();
    surClic(options.conversation);
    notification.close();
  };
}

/** Enregistre le service worker (version construite seulement : en développement, Vite sert les fichiers lui-même). */
export function enregistrerServiceWorker(): void {
  if (!import.meta.env.PROD || !("serviceWorker" in navigator)) return;
  window.addEventListener("load", () => {
    // Sans le cache HTTP : le script de déchiffrement qu'il charge se met à jour avec lui.
    void navigator.serviceWorker.register("/sw.js", { updateViaCache: "none" }).catch(() => {
      // Navigation privée ou stockage refusé : l'application marche sans.
    });
  });
}

const CLE_PUSH = "unichat.push";

/** Les notifications passent par Web Push sur cet appareil : la page n'en montre plus elle-même. */
export function pushActif(): boolean {
  try {
    return localStorage.getItem(CLE_PUSH) === "1";
  } catch {
    return false;
  }
}

function retenirPush(actif: boolean): void {
  try {
    if (actif) localStorage.setItem(CLE_PUSH, "1");
    else localStorage.removeItem(CLE_PUSH);
  } catch {
    // Stockage refusé : la page continuera de notifier elle-même.
  }
}

function versOctets(base64url: string): Uint8Array<ArrayBuffer> {
  const binaire = atob(base64url.replace(/-/g, "+").replace(/_/g, "/") + "===".slice((base64url.length + 3) % 4));
  return Uint8Array.from(binaire, (c) => c.charCodeAt(0));
}

/**
 * Abonne cet appareil aux notifications, une fois la permission accordée :
 * elles arrivent alors même UniChat fermé (Android compris). Sans service
 * worker ou sans clé côté serveur, la page continue de notifier elle-même.
 */
export async function activerPush(): Promise<void> {
  if (!("serviceWorker" in navigator) || !("PushManager" in window) || Notification.permission !== "granted") return;
  try {
    const enregistrement = await navigator.serviceWorker.ready;
    const reponse = await fetch("/api/push/cle", { credentials: "same-origin" });
    if (!reponse.ok) return;
    const cle = versOctets(((await reponse.json()) as { cle: string }).cle);
    let abonnement = await enregistrement.pushManager.getSubscription();
    // Abonnement fait avec une autre clé (clé du serveur renouvelée) : il ne recevrait plus rien.
    const actuelle = abonnement?.options.applicationServerKey;
    if (abonnement && actuelle && !new Uint8Array(actuelle).every((o, i) => o === cle[i])) {
      await abonnement.unsubscribe();
      abonnement = null;
    }
    abonnement ??= await enregistrement.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: cle });
    const envoi = await fetch("/api/push", {
      method: "POST",
      credentials: "same-origin",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(abonnement.toJSON()),
    });
    retenirPush(envoi.ok);
  } catch {
    retenirPush(false);
  }
}

/** Déconnexion : cet appareil ne recevra plus rien pour ce compte. */
export async function desactiverPush(): Promise<void> {
  retenirPush(false);
  try {
    const enregistrement = await navigator.serviceWorker?.getRegistration();
    const abonnement = await enregistrement?.pushManager.getSubscription();
    if (!abonnement) return;
    await fetch("/api/push", {
      method: "DELETE",
      credentials: "same-origin",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ endpoint: abonnement.endpoint }),
    }).catch(() => {});
    await abonnement.unsubscribe();
  } catch {
    // Rien à défaire.
  }
}
