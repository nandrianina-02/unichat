import clsx from "clsx";
import { X } from "lucide-react";
import { useEffect, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { useRetourSysteme } from "../lib/retour";
import { useSortie } from "./Apparition";
import { BoutonIcone } from "./BoutonIcone";

/**
 * Fenêtre au-dessus de l'application : titre, bouton de fermeture, contenu
 * libre. Rendue à la racine de la page, fermée par Échap ou par Retour, et
 * animée à l'ouverture comme à la fermeture (à placer dans une Apparition).
 */
export function Fenetre({ titre, onFermer, children }: { titre: string; onFermer: () => void; children: ReactNode }) {
  // Pendant sa sortie, la couche a déjà rendu son entrée d'historique.
  const sortie = useSortie();
  useRetourSysteme(!sortie, onFermer);
  useEffect(() => {
    if (sortie) return;
    const echap = (e: KeyboardEvent) => e.key === "Escape" && onFermer();
    window.addEventListener("keydown", echap);
    return () => window.removeEventListener("keydown", echap);
  }, [onFermer, sortie]);
  return createPortal(
    <div className={clsx(sortie ? "animate-fade-out pointer-events-none" : "animate-fade", "fixed inset-0 z-50 flex items-center justify-center bg-voile p-4")} onMouseDown={onFermer}>
      <div
        role="dialog"
        aria-modal="true"
        aria-label={titre}
        className={clsx(sortie ? "animate-sink" : "animate-rise", "w-full max-w-md rounded-lg bg-panneau shadow-xl")}
        onMouseDown={(e) => e.stopPropagation()}
      >
        <header className="flex items-center gap-3 px-3 pt-3">
          <BoutonIcone libelle="Fermer" onClick={onFermer}>
            <X size={22} />
          </BoutonIcone>
          <h2 className="text-[17px] text-texte">{titre}</h2>
        </header>
        <div className="px-6 pt-2 pb-6">{children}</div>
      </div>
    </div>,
    document.body,
  );
}
