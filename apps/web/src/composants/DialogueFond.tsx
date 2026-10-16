import clsx from "clsx";
import { Check } from "lucide-react";
import { useState } from "react";
import { FONDS, appliquerFond, fondActuel, type Fond } from "../lib/theme";
import { Case } from "./Case";
import { Dialogue } from "./Dialogue";

const LIBELLES: Record<Fond, string> = {
  defaut: "Par défaut",
  brume: "Brume",
  sable: "Sable",
  sauge: "Sauge",
  lavande: "Lavande",
};

/** Fond des discussions : une teinte discrète (elle suit le thème) et le motif, sur cet appareil. */
export function DialogueFond({ onFermer }: { onFermer: () => void }) {
  const depart = fondActuel();
  const [fond, setFond] = useState<Fond>(depart.fond);
  const [motif, setMotif] = useState(depart.motif);

  return (
    <Dialogue
      titre="Fond des discussions"
      confirmer="OK"
      onFermer={() => {
        // Annuler : on revient au fond d'avant l'aperçu.
        appliquerFond(depart.fond, depart.motif);
        onFermer();
      }}
      onConfirmer={() => {
        appliquerFond(fond, motif);
        onFermer();
      }}
    >
      <div role="radiogroup" aria-label="Teinte" className="mt-1 grid grid-cols-5 gap-3">
        {FONDS.map((f) => (
          <button
            key={f}
            type="button"
            role="radio"
            aria-checked={fond === f}
            aria-label={LIBELLES[f]}
            title={LIBELLES[f]}
            onClick={() => {
              setFond(f);
              appliquerFond(f, motif);
            }}
            className={clsx(
              "relative flex aspect-square items-center justify-center rounded-md ring-2 transition-shadow",
              fond === f ? "ring-primaire" : "ring-bordure hover:ring-texte-3",
            )}
            style={{ background: `var(--fond-${f})` }}
          >
            {fond === f && <Check size={18} className="text-primaire" />}
          </button>
        ))}
      </div>
      <p className="mt-2 text-[13px] text-texte-2">{LIBELLES[fond]}</p>
      <Case
        coche={motif}
        onChange={(m) => {
          setMotif(m);
          appliquerFond(fond, m);
        }}
        className="mt-4 text-[15px] text-texte"
      >
        Afficher le motif
      </Case>
    </Dialogue>
  );
}
