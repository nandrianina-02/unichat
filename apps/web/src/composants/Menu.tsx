import clsx from "clsx";
import type { LucideIcon } from "lucide-react";
import { useEffect, type ReactNode, type RefObject } from "react";

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
  return (
    <div role="menu" className={clsx("animate-pop absolute z-30 w-64 rounded-lg bg-panneau py-2 shadow-xl ring-1 ring-bordure", className)}>
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

/** Ferme un menu au clic à l'extérieur ou sur Échap. */
export function useFermetureExterieure(ouvert: boolean, ref: RefObject<HTMLElement | null>, fermer: () => void) {
  useEffect(() => {
    if (!ouvert) return;
    const surClic = (e: MouseEvent) => !ref.current?.contains(e.target as Node) && fermer();
    const surTouche = (e: KeyboardEvent) => e.key === "Escape" && fermer();
    document.addEventListener("mousedown", surClic);
    document.addEventListener("keydown", surTouche);
    return () => {
      document.removeEventListener("mousedown", surClic);
      document.removeEventListener("keydown", surTouche);
    };
  }, [ouvert, ref, fermer]);
}
