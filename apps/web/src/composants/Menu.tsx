import clsx from "clsx";
import type { LucideIcon } from "lucide-react";
import { useEffect, useRef, type ReactNode, type RefObject } from "react";
import { useSortie } from "./Apparition";

export type ElementMenu = { icone: LucideIcon; libelle: string; action: () => void; danger?: boolean } | "separateur";

/** Menu ancré à son bouton : pictogramme et libellé, groupes séparés par un filet. */
export function Menu({
  elements,
  onChoix,
  className,
  entete,
}: {
  elements: ElementMenu[];
  onChoix: () => void;
  className?: string;
  entete?: ReactNode;
}) {
  const sortie = useSortie();
  return (
    <div role="menu" className={clsx(sortie ? "animate-pop-out pointer-events-none" : "animate-pop", "absolute z-30 w-64 rounded-lg bg-panneau py-2 shadow-xl ring-1 ring-bordure", className)}>
      {entete && <div className="border-b border-bordure px-2.5 pb-2">{entete}</div>}
      {elements.map((element, i) =>
        element === "separateur" ? (
          <div key={`separateur-${i}`} role="separator" className="my-1.5 border-t border-bordure" />
        ) : (
          <button
            key={element.libelle}
            role="menuitem"
            type="button"
            onClick={() => {
              onChoix();
              element.action();
            }}
            className={clsx(
              "flex w-full items-center gap-3 px-5 py-2.5 text-left text-sm hover:bg-survol",
              element.danger ? "text-danger" : "text-texte",
            )}
          >
            <element.icone size={18} className={element.danger ? "text-danger" : "text-texte-2"} /> {element.libelle}
          </button>
        ),
      )}
    </div>
  );
}

/** Le menu ouvert, quel qu'il soit : en ouvrir un autre le referme. Un seul à la fois. */
let fermerOuvert: (() => void) | null = null;

/**
 * Ferme un menu au toucher ou au clic à l'extérieur, et sur Échap. « pointerdown »
 * plutôt que « mousedown » : un appui long au doigt n'émet pas de mousedown, et
 * le menu d'un message restait ouvert sous celui du suivant.
 */
export function useFermetureExterieure(ouvert: boolean, ref: RefObject<HTMLElement | null>, fermer: () => void) {
  const rappel = useRef(fermer);
  useEffect(() => {
    rappel.current = fermer;
  });
  useEffect(() => {
    if (!ouvert) return;
    const celuiCi = () => rappel.current();
    fermerOuvert?.();
    fermerOuvert = celuiCi;
    const surAppui = (e: PointerEvent) => !ref.current?.contains(e.target as Node) && rappel.current();
    const surTouche = (e: KeyboardEvent) => e.key === "Escape" && rappel.current();
    document.addEventListener("pointerdown", surAppui);
    document.addEventListener("keydown", surTouche);
    return () => {
      if (fermerOuvert === celuiCi) fermerOuvert = null;
      document.removeEventListener("pointerdown", surAppui);
      document.removeEventListener("keydown", surTouche);
    };
  }, [ouvert, ref]);
}
