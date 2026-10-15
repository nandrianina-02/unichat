import clsx from "clsx";
import { ChevronRight, type LucideIcon } from "lucide-react";
import type { CarteProfil } from "@unichat/shared";
import type { ReactNode } from "react";
import { Avatar } from "./Avatar";

/** Ligne de réglage : pictogramme, titre, précision. */
export function LigneReglage({
  icone: Icone,
  titre,
  detail,
  onClick,
  danger,
  fleche = true,
  droite,
}: {
  icone: LucideIcon;
  titre: string;
  detail?: ReactNode;
  onClick?: () => void;
  danger?: boolean;
  fleche?: boolean;
  droite?: ReactNode;
}) {
  // Le filet de séparation court jusqu'au bord droit, sous la flèche comprise.
  const contenu = (
    <>
      <Icone size={22} className={clsx("shrink-0", danger ? "text-danger" : "text-texte-2")} />
      <span className="flex min-w-0 flex-1 items-center gap-3 border-b border-bordure py-4 pr-5">
        <span className="min-w-0 flex-1">
          <span className={clsx("block text-[16px]", danger ? "text-danger" : "text-texte")}>{titre}</span>
          {detail && <span className="mt-0.5 block truncate text-[14px] text-texte-2">{detail}</span>}
        </span>
        {droite}
        {onClick && fleche && !droite && <ChevronRight size={18} className="shrink-0 text-texte-3" />}
      </span>
    </>
  );
  if (!onClick) return <div className="flex items-center gap-6 pl-7">{contenu}</div>;
  return (
    <button type="button" onClick={onClick} className="flex w-full items-center gap-6 pl-7 text-left transition-colors hover:bg-survol">
      {contenu}
    </button>
  );
}

/** Ligne d'une personne, comme une ligne de la liste des discussions. */
export function LignePersonne({
  carte,
  onClick,
  selection,
  droite,
  className,
}: {
  carte: CarteProfil;
  onClick?: () => void;
  selection?: boolean;
  droite?: ReactNode;
  className?: string;
}) {
  const detail = carte.infos ?? (carte.pseudo ? `@${carte.pseudo}` : "");
  return (
    <div
      role={onClick ? "button" : undefined}
      tabIndex={onClick ? 0 : undefined}
      onClick={onClick}
      onKeyDown={(e) => onClick && (e.key === "Enter" || e.key === " ") && (e.preventDefault(), onClick())}
      className={clsx(
        "flex items-center gap-4 pl-4 transition-colors",
        onClick && "cursor-pointer hover:bg-survol",
        selection && "bg-selection hover:bg-selection",
        className,
      )}
    >
      <Avatar id={carte.id} photo={carte.photo} nom={carte.nom} taille={49} />
      <div className="flex min-w-0 flex-1 items-center gap-3 border-b border-bordure py-3.5 pr-4">
        <div className="min-w-0 flex-1">
          <p className="truncate text-[17px] text-texte">
            {carte.nom}
            {carte.estSoi && <span className="text-texte-2"> (vous)</span>}
          </p>
          {detail && <p className="mt-0.5 truncate text-[14px] text-texte-2">{detail}</p>}
        </div>
        {droite}
      </div>
    </div>
  );
}

export function TitreSection({ children }: { children: ReactNode }) {
  return <h3 className="px-7 pt-6 pb-3 text-[15px] text-primaire">{children}</h3>;
}

/** Signale aux listes ouvertes que les contacts ont changé. */
export const EVENEMENT_CONTACTS = "unichat:contacts";
export function contactsModifies(): void {
  window.dispatchEvent(new Event(EVENEMENT_CONTACTS));
}
