import clsx from "clsx";
import { Check, LoaderCircle, Pencil } from "lucide-react";
import { useEffect, useRef, useState } from "react";

interface Props {
  libelle: string;
  valeur: string;
  /** Texte affiché quand la valeur est vide (« Ajouter une description »). */
  invite?: string;
  maximum: number;
  prefixe?: string;
  aide?: string;
  /** Renvoie un message d'erreur, ou null si l'enregistrement a réussi. */
  enregistrer: (valeur: string) => Promise<string | null>;
  valider?: (valeur: string) => string | null;
}

/** Champ affiché en lecture, qui passe en édition au clic sur le crayon. */
export function ChampModifiable({ libelle, valeur, invite, maximum, prefixe, aide, enregistrer, valider }: Props) {
  const [edition, setEdition] = useState(false);
  const [texte, setTexte] = useState(valeur);
  const [erreur, setErreur] = useState<string | null>(null);
  const [enCours, setEnCours] = useState(false);
  const champ = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!edition) setTexte(valeur);
  }, [valeur, edition]);
  useEffect(() => {
    if (edition) champ.current?.focus();
  }, [edition]);

  async function valider_() {
    const propre = texte.trim();
    if (propre === valeur) {
      setEdition(false);
      return;
    }
    const probleme = valider?.(propre) ?? null;
    if (probleme) {
      setErreur(probleme);
      return;
    }
    setEnCours(true);
    const resultat = await enregistrer(propre);
    setEnCours(false);
    if (resultat) setErreur(resultat);
    else {
      setErreur(null);
      setEdition(false);
    }
  }

  return (
    <div className="px-8 py-4">
      <p className="text-sm text-primaire">{libelle}</p>
      {edition ? (
        <div className="mt-3">
          <div className={clsx("flex items-center gap-2 border-b-2 pb-1", erreur ? "border-danger" : "border-primaire")}>
            {prefixe && <span className="text-texte-2">{prefixe}</span>}
            <input
              ref={champ}
              value={texte}
              maxLength={maximum}
              onChange={(e) => {
                setTexte(e.target.value);
                setErreur(null);
              }}
              onKeyDown={(e) => {
                if (e.key === "Enter") void valider_();
                if (e.key === "Escape") {
                  setTexte(valeur);
                  setErreur(null);
                  setEdition(false);
                }
              }}
              className="min-w-0 flex-1 bg-transparent py-1 text-[15px] text-texte outline-none"
            />
            <span className="text-xs tabular-nums text-texte-3">{maximum - texte.length}</span>
            <button
              type="button"
              onClick={() => void valider_()}
              disabled={enCours}
              aria-label="Enregistrer"
              title="Enregistrer"
              className="inline-flex size-8 items-center justify-center rounded-full text-texte-2 hover:bg-survol"
            >
              {enCours ? <LoaderCircle size={18} className="animate-spin" /> : <Check size={20} />}
            </button>
          </div>
          {erreur && <p className="animate-fade mt-2 text-xs text-danger">{erreur}</p>}
        </div>
      ) : (
        <div className="mt-3 flex items-center gap-3">
          <p className="min-w-0 flex-1 break-words text-[15px] text-texte">
            {valeur ? (
              <>
                {prefixe && <span className="text-texte-2">{prefixe}</span>}
                {valeur}
              </>
            ) : (
              <span className="text-texte-3">{invite ?? ""}</span>
            )}
          </p>
          <button
            type="button"
            onClick={() => setEdition(true)}
            aria-label={`Modifier : ${libelle}`}
            title="Modifier"
            className="inline-flex size-8 items-center justify-center rounded-full text-texte-2 hover:bg-survol"
          >
            <Pencil size={18} />
          </button>
        </div>
      )}
      {aide && !edition && <p className="mt-4 text-[13px] leading-relaxed text-texte-3">{aide}</p>}
    </div>
  );
}
