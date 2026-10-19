import { useSyncExternalStore } from "react";

/**
 * Nouvelle version en ligne. Installée sur un téléphone, l'application reste
 * des heures en mémoire : sans ce contrôle, une correction déployée ne
 * l'atteint qu'au prochain lancement complet, et l'on croit le défaut encore
 * là. La construction publie le nom de son script d'entrée (version.json,
 * jamais mis en cache par le service worker) ; l'application le compare au
 * sien en revenant au premier plan, et propose de recharger. Jamais de
 * rechargement d'office : un brouillon ou un envoi en cours serait perdu.
 */

/** Pas plus d'une vérification toutes les 5 minutes, même en passant sans cesse d'une application à l'autre. */
const INTERVALLE = 5 * 60_000;

let disponible = false;
const abonnes = new Set<() => void>();

const scriptCharge = () => document.querySelector<HTMLScriptElement>('script[type="module"][src^="/assets/"]')?.getAttribute("src") ?? null;

async function scriptEnLigne(): Promise<string | null> {
  const reponse = await fetch("/version.json", { cache: "no-store" });
  if (!reponse.ok) return null;
  const { script } = (await reponse.json()) as { script?: unknown };
  return typeof script === "string" ? script : null;
}

export function surveillerVersion(): void {
  const charge = scriptCharge();
  // En développement, Vite recharge lui-même la page.
  if (!import.meta.env.PROD || !charge) return;
  let derniere = 0;
  const verifier = () => {
    if (disponible || document.hidden || Date.now() - derniere < INTERVALLE) return;
    derniere = Date.now();
    void scriptEnLigne().then(
      (enLigne) => {
        if (!enLigne || enLigne === charge) return;
        disponible = true;
        abonnes.forEach((f) => f());
      },
      () => undefined,
    );
  };
  document.addEventListener("visibilitychange", verifier);
  window.addEventListener("online", verifier);
  setInterval(verifier, INTERVALLE);
}

export function useNouvelleVersion(): boolean {
  return useSyncExternalStore(
    (rappel) => {
      abonnes.add(rappel);
      return () => abonnes.delete(rappel);
    },
    () => disponible,
  );
}
