import { useEffect, useRef } from "react";

/**
 * Bouton Retour d'Android (et du navigateur) : chaque couche ouverte —
 * discussion, panneau, boîte de dialogue — ajoute une entrée à l'historique,
 * et Retour referme la plus récente au lieu de quitter l'application, comme
 * dans WhatsApp. Une couche fermée autrement (croix, Échap) retire son entrée.
 */
interface Couche {
  fermer: () => void;
}

const pile: Couche[] = [];
/** Retours lancés par nous-mêmes : leur « popstate » ne doit rien refermer. */
let ignorer = 0;
let aDefaire = 0;

if (typeof window !== "undefined") {
  window.addEventListener("popstate", () => {
    if (ignorer > 0) {
      ignorer -= 1;
      return;
    }
    pile.pop()?.fermer();
  });
}

/** Plusieurs couches fermées d'un coup : un seul retour dans l'historique, de plusieurs pas. */
function defaire(): void {
  aDefaire += 1;
  if (aDefaire > 1) return;
  queueMicrotask(() => {
    const pas = aDefaire;
    aDefaire = 0;
    ignorer += 1;
    history.go(-pas);
  });
}

export function useRetourSysteme(ouvert: boolean, fermer: () => void): void {
  const rappel = useRef(fermer);
  useEffect(() => {
    rappel.current = fermer;
  });
  useEffect(() => {
    if (!ouvert) return;
    const couche: Couche = { fermer: () => rappel.current() };
    pile.push(couche);
    history.pushState({ unichat: pile.length }, "");
    return () => {
      const i = pile.indexOf(couche);
      // Déjà retirée : c'est Retour qui l'a refermée.
      if (i < 0) return;
      pile.splice(i, 1);
      defaire();
    };
  }, [ouvert]);
}
