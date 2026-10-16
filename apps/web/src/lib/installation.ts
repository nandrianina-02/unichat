import { useEffect, useState } from "react";

/** L'application Android, publiée avec chaque version sur GitHub (gratuit, sans Play Store). */
export const LIEN_ANDROID = "https://github.com/nandrianina-02/unichat/releases/latest/download/UniChat.apk";

interface InvitationInstallation extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
}

// Chrome propose l'installation par un événement émis tôt : on le garde pour
// le bouton « Installer », qui peut s'afficher bien plus tard.
let invitation: InvitationInstallation | null = null;
const auditeurs = new Set<() => void>();
if (typeof window !== "undefined") {
  window.addEventListener("beforeinstallprompt", (e) => {
    e.preventDefault();
    invitation = e as InvitationInstallation;
    for (const a of auditeurs) a();
  });
  window.addEventListener("appinstalled", () => {
    invitation = null;
    for (const a of auditeurs) a();
  });
}

/** Déjà ouverte comme application (installée sur l'ordinateur, ou application Android). */
export const estApplication = () =>
  typeof window !== "undefined" && (window.matchMedia("(display-mode: standalone)").matches || document.referrer.startsWith("android-app://"));

export const estAndroid = () => typeof navigator !== "undefined" && /Android/i.test(navigator.userAgent);

export function useInstallation(): { possible: boolean; installer: () => Promise<void> } {
  const [, rafraichir] = useState(0);
  useEffect(() => {
    const a = () => rafraichir((n) => n + 1);
    auditeurs.add(a);
    return () => {
      auditeurs.delete(a);
    };
  }, []);
  return {
    possible: invitation !== null,
    installer: async () => {
      const i = invitation;
      if (!i) return;
      await i.prompt();
      await i.userChoice;
      invitation = null;
      rafraichir((n) => n + 1);
    },
  };
}
