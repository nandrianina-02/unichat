import clsx from "clsx";
import { ArrowLeft } from "lucide-react";
import { useCallback, useRef, useState, type ReactNode } from "react";

/**
 * Panneau latéral (paramètres, nouvelle discussion…) : il recouvre la liste
 * des discussions en glissant depuis la gauche, et repart de même au retour.
 */
export function EnTetePanneau({ titre, onRetour }: { titre: string; onRetour: () => void }) {
  return (
    <header className="flex h-[60px] shrink-0 items-center gap-6 px-4">
      <button
        type="button"
        onClick={onRetour}
        aria-label="Retour"
        title="Retour"
        className="-ml-2 inline-flex size-10 items-center justify-center rounded-full text-texte transition-colors hover:bg-survol"
      >
        <ArrowLeft size={22} />
      </button>
      <h2 className="text-[19px] font-medium text-texte">{titre}</h2>
    </header>
  );
}

interface Element<V> {
  cle: number;
  vue: V;
  fermeture: boolean;
}

/** Pile de panneaux : on en ouvre un par-dessus l'autre, le retour ferme le dernier. */
export function usePile<V>() {
  const [pile, setPile] = useState<Element<V>[]>([]);
  const compteur = useRef(0);

  const ouvrir = useCallback((vue: V) => {
    compteur.current += 1;
    const cle = compteur.current;
    setPile((p) => [...p, { cle, vue, fermeture: false }]);
  }, []);

  const retour = useCallback(() => {
    setPile((p) => {
      const i = p.findLastIndex((e) => !e.fermeture);
      return i < 0 ? p : p.map((e, j) => (j === i ? { ...e, fermeture: true } : e));
    });
  }, []);

  const toutFermer = useCallback(() => setPile((p) => p.map((e) => ({ ...e, fermeture: true }))), []);

  const retirer = useCallback((cle: number) => setPile((p) => p.filter((e) => e.cle !== cle)), []);

  return { pile, ouvrir, retour, toutFermer, retirer };
}

export function CouchePanneau({
  fermeture,
  niveau,
  onFini,
  children,
}: {
  fermeture: boolean;
  niveau: number;
  onFini: () => void;
  children: ReactNode;
}) {
  return (
    <div
      className={clsx("absolute inset-0 flex flex-col bg-panneau", fermeture ? "panneau-sortie" : "panneau-entree")}
      style={{ zIndex: 10 + niveau }}
      onAnimationEnd={(e) => {
        // Les animations des éléments intérieurs remontent aussi jusqu'ici.
        if (e.target === e.currentTarget && fermeture) onFini();
      }}
    >
      {children}
    </div>
  );
}
