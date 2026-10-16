import { useRef, type MouseEvent, type PointerEvent } from "react";

const DELAI = 450;
const TOLERANCE = 10;

/**
 * Appui long au doigt, comme dans WhatsApp sur téléphone : il ouvre le menu
 * d'un message ou d'une discussion, là où l'ordinateur montre un bouton au
 * survol. Le clic droit fait de même à la souris. `declenche` dit si le
 * relâchement qui suit doit être ignoré (pas d'ouverture de la discussion).
 */
export function useAppuiLong(surAppui: () => void, actif = true) {
  const minuterie = useRef<ReturnType<typeof setTimeout> | null>(null);
  const depart = useRef<{ x: number; y: number } | null>(null);
  const declenche = useRef(false);

  function annuler() {
    if (minuterie.current) clearTimeout(minuterie.current);
    minuterie.current = null;
  }

  function declencher() {
    if (declenche.current) return;
    declenche.current = true;
    annuler();
    navigator.vibrate?.(12);
    surAppui();
  }

  return {
    declenche,
    gestionnaires: {
      onPointerDown: (e: PointerEvent) => {
        if (!actif || e.pointerType === "mouse") return;
        declenche.current = false;
        depart.current = { x: e.clientX, y: e.clientY };
        annuler();
        minuterie.current = setTimeout(declencher, DELAI);
      },
      onPointerMove: (e: PointerEvent) => {
        const d = depart.current;
        // Le doigt qui bouge fait défiler ou glisser : ce n'est pas un appui long.
        if (d && Math.hypot(e.clientX - d.x, e.clientY - d.y) > TOLERANCE) annuler();
      },
      onPointerUp: annuler,
      onPointerCancel: annuler,
      onContextMenu: (e: MouseEvent) => {
        if (!actif) return;
        // Android émet aussi « contextmenu » à l'appui long : une seule ouverture.
        e.preventDefault();
        declencher();
      },
    },
  };
}

/**
 * Écran tactile, sans survol (téléphone, tablette). On n'y donne pas le
 * focus au champ de saisie de soi-même : cela ouvrirait le clavier sans que
 * la personne l'ait demandé.
 */
export const estTactile = () => typeof window !== "undefined" && window.matchMedia("(hover: none)").matches;
