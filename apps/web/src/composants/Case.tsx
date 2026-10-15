import clsx from "clsx";
import { Check } from "lucide-react";
import type { ReactNode } from "react";

/** Ligne cochable : la case, puis le contenu ; toute la ligne réagit au clic. */
export function Case({
  coche,
  onChange,
  children,
  className,
}: {
  coche: boolean;
  onChange: (valeur: boolean) => void;
  children: ReactNode;
  className?: string;
}) {
  return (
    <label className={clsx("flex cursor-pointer items-center gap-4 transition-colors", className)}>
      <input type="checkbox" checked={coche} onChange={(e) => onChange(e.target.checked)} className="peer sr-only" />
      <span
        aria-hidden="true"
        className={clsx(
          "flex size-5 shrink-0 items-center justify-center rounded-[4px] border-2 transition-colors peer-focus-visible:ring-2 peer-focus-visible:ring-primaire",
          coche ? "border-primaire bg-primaire" : "border-texte-3",
        )}
      >
        {coche && <Check size={14} strokeWidth={3} className="text-sur-primaire" />}
      </span>
      {children}
    </label>
  );
}
