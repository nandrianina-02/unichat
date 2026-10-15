import clsx from "clsx";
import type { ButtonHTMLAttributes, ReactNode } from "react";

interface Props extends ButtonHTMLAttributes<HTMLButtonElement> {
  libelle: string;
  actif?: boolean;
  children: ReactNode;
}

/** Bouton rond à pictogramme, avec libellé accessible et infobulle. */
export function BoutonIcone({ libelle, actif, className, children, ...reste }: Props) {
  return (
    <button
      type="button"
      title={libelle}
      aria-label={libelle}
      className={clsx(
        "inline-flex size-10 shrink-0 items-center justify-center rounded-full text-texte-2 transition-colors",
        "hover:bg-survol disabled:pointer-events-none disabled:opacity-40",
        actif && "bg-survol text-texte",
        className,
      )}
      {...reste}
    >
      {children}
    </button>
  );
}
