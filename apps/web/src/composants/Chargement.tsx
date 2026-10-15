import { Logo } from "./Logo";

/**
 * Écran de chargement d'UniChat. Même rendu que celui d'index.html, affiché
 * avant le JavaScript : le passage de l'un à l'autre ne se voit pas.
 */
export function Chargement() {
  return (
    <div className="fixed inset-0 flex items-center justify-center bg-fond">
      <div className="flex w-72 flex-col items-center">
        <Logo plein={false} className="size-16" />
        <div className="mt-12 h-1 w-full overflow-hidden rounded-full bg-bordure">
          <div className="barre-chargement h-full rounded-full bg-primaire" />
        </div>
        <p className="mt-6 text-[17px] text-texte">UniChat</p>
      </div>
    </div>
  );
}
