import clsx from "clsx";
import { useState } from "react";
import { appliquerTheme, themeActuel, type Theme } from "../lib/theme";
import { Dialogue } from "./Dialogue";

const CHOIX: { valeur: Theme; libelle: string }[] = [
  { valeur: "clair", libelle: "Clair" },
  { valeur: "sombre", libelle: "Sombre" },
  { valeur: "systeme", libelle: "Par défaut du système" },
];

export function DialogueTheme({ onFermer }: { onFermer: () => void }) {
  const [choix, setChoix] = useState<Theme>(themeActuel);
  return (
    <Dialogue
      titre="Choisir un thème"
      confirmer="OK"
      onFermer={onFermer}
      onConfirmer={() => {
        appliquerTheme(choix);
        onFermer();
      }}
    >
      <div role="radiogroup" aria-label="Thème" className="-mx-1 space-y-1">
        {CHOIX.map(({ valeur, libelle }) => (
          <label key={valeur} className="flex cursor-pointer items-center gap-4 rounded px-1 py-2.5 text-[15px] text-texte">
            <input type="radio" name="theme" checked={choix === valeur} onChange={() => setChoix(valeur)} className="sr-only" />
            <span
              aria-hidden="true"
              className={clsx(
                "flex size-5 items-center justify-center rounded-full border-2",
                choix === valeur ? "border-primaire" : "border-texte-3",
              )}
            >
              {choix === valeur && <span className="size-2.5 rounded-full bg-primaire" />}
            </span>
            {libelle}
          </label>
        ))}
      </div>
    </Dialogue>
  );
}
