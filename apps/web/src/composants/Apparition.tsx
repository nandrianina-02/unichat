import clsx from "clsx";
import { createContext, useContext, useEffect, useRef, useState, type HTMLAttributes, type ReactNode } from "react";

/** La plus longue des animations de sortie (styles.css) : l'élément part ensuite pour de bon. */
export const DUREE_SORTIE = 230;

const Sortie = createContext(false);

/** Vrai pendant l'animation de sortie : le composant se dessine en train de partir. */
export const useSortie = () => useContext(Sortie);

const estPresent = (contenu: ReactNode) => contenu !== null && contenu !== undefined && typeof contenu !== "boolean" && contenu !== "";

/**
 * Garde son contenu à l'écran le temps de son animation de sortie, au lieu
 * de le retirer d'un coup (boîte de dialogue, menu, barre, discussion). On
 * l'utilise autour d'un affichage conditionnel :
 *
 *   <Apparition>{ouvert && <Dialogue … />}</Apparition>
 *
 * Le contenu lit useSortie() pour choisir son animation, ou passe par Anime.
 */
export function Apparition({ children }: { children: ReactNode }) {
  const present = estPresent(children);
  const dernier = useRef<ReactNode>(null);
  const [, redessiner] = useState(0);
  if (present) dernier.current = children;

  useEffect(() => {
    if (present || dernier.current === null) return;
    const minuterie = setTimeout(() => {
      dernier.current = null;
      redessiner((n) => n + 1);
    }, DUREE_SORTIE);
    return () => clearTimeout(minuterie);
  }, [present]);

  const contenu = present ? children : dernier.current;
  if (contenu === null) return null;
  return <Sortie.Provider value={!present}>{contenu}</Sortie.Provider>;
}

/**
 * Vrai tant que `ouvert`, puis encore le temps d'une sortie : ce qui entoure
 * un élément qui se referme (sa place au premier plan, le plein écran sur
 * téléphone) doit tenir jusqu'à la fin de l'animation.
 */
export function useEncoreVisible(ouvert: boolean): boolean {
  const [visible, setVisible] = useState(ouvert);
  if (ouvert && !visible) setVisible(true);
  useEffect(() => {
    if (ouvert) return;
    const minuterie = setTimeout(() => setVisible(false), DUREE_SORTIE);
    return () => clearTimeout(minuterie);
  }, [ouvert]);
  return ouvert || visible;
}

/**
 * Un bloc qui entre et sort avec les briques d'animation : « monte » (barres,
 * panneaux), « fondu » (avis, bandeaux), « surgit » (menus ancrés).
 * Pendant la sortie, il ne réagit plus aux clics.
 */
export function Anime({
  effet = "monte",
  className,
  ...reste
}: { effet?: "monte" | "fondu" | "surgit" } & HTMLAttributes<HTMLDivElement>) {
  const sortie = useSortie();
  const classes = {
    monte: ["animate-rise", "animate-sink"],
    fondu: ["animate-fade", "animate-fade-out"],
    surgit: ["animate-pop", "animate-pop-out"],
  }[effet];
  return <div {...reste} className={clsx(sortie ? `${classes[1]} pointer-events-none` : classes[0], className)} />;
}
