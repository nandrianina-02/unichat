import clsx from "clsx";
import { useEffect, useRef, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { useRetourSysteme } from "../lib/retour";
import { useSortie } from "./Apparition";

interface Props {
  titre: string;
  children?: ReactNode;
  confirmer: string;
  /** false : une seule action (boîte d'information). */
  annuler?: string | false;
  danger?: boolean;
  enCours?: boolean;
  onConfirmer: () => void;
  onFermer: () => void;
}

/** Boîte de confirmation : titre, explication, deux actions alignées à droite. */
export function Dialogue({ titre, children, confirmer, annuler = "Annuler", danger, enCours, onConfirmer, onFermer }: Props) {
  const boutonRef = useRef<HTMLButtonElement>(null);
  // Pendant sa sortie, la couche a déjà rendu son entrée d'historique.
  const sortie = useSortie();
  useRetourSysteme(!sortie, onFermer);

  useEffect(() => {
    if (sortie) return;
    boutonRef.current?.focus();
    const echap = (e: KeyboardEvent) => e.key === "Escape" && onFermer();
    window.addEventListener("keydown", echap);
    return () => window.removeEventListener("keydown", echap);
  }, [onFermer, sortie]);

  // Rendu à la racine de la page : ouverte depuis une ligne de la liste, la
  // boîte resterait sinon prisonnière de la colonne et passerait sous la discussion.
  return createPortal(
    <div className={clsx(sortie ? "animate-fade-out pointer-events-none" : "animate-fade", "fixed inset-0 z-50 flex items-center justify-center bg-voile p-4")} onMouseDown={onFermer}>
      <div
        role="alertdialog"
        aria-modal="true"
        aria-label={titre}
        className={clsx(sortie ? "animate-sink" : "animate-rise", "w-full max-w-md rounded-lg bg-panneau p-6 shadow-xl")}
        onMouseDown={(e) => e.stopPropagation()}
      >
        <h2 className="text-[17px] text-texte">{titre}</h2>
        {children && <div className="mt-3 text-sm leading-relaxed text-texte-2">{children}</div>}
        <div className="mt-7 flex justify-end gap-2">
          {annuler !== false && (
            <button
              type="button"
              onClick={onFermer}
              className="rounded-full px-5 py-2 text-sm font-medium text-primaire transition-colors hover:bg-primaire-doux"
            >
              {annuler}
            </button>
          )}
          <button
            ref={boutonRef}
            type="button"
            disabled={enCours}
            onClick={onConfirmer}
            className={clsx(
              "rounded-full px-5 py-2 text-sm font-medium text-sur-primaire transition-colors disabled:opacity-60",
              danger ? "bg-danger hover:opacity-90" : "bg-primaire hover:bg-primaire-fort",
            )}
          >
            {confirmer}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
