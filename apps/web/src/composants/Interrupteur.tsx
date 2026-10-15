import clsx from "clsx";

export function Interrupteur({
  actif,
  onChange,
  libelle,
  desactive,
}: {
  actif: boolean;
  onChange: (valeur: boolean) => void;
  libelle: string;
  desactive?: boolean;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={actif}
      aria-label={libelle}
      disabled={desactive}
      onClick={() => onChange(!actif)}
      className={clsx(
        "relative inline-flex h-5 w-9 shrink-0 items-center rounded-full transition-colors disabled:opacity-50",
        actif ? "bg-primaire" : "bg-texte-3",
      )}
    >
      <span
        className={clsx(
          "inline-block size-4 rounded-full bg-panneau shadow transition-transform duration-200",
          actif ? "translate-x-[18px]" : "translate-x-0.5",
        )}
      />
    </button>
  );
}
