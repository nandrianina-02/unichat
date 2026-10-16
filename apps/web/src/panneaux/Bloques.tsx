import type { CarteProfil } from "@unichat/shared";
import { Ban, LoaderCircle } from "lucide-react";
import { useEffect, useState } from "react";
import { LignePersonne } from "../composants/Lignes";
import { EnTetePanneau } from "../composants/Panneau";
import { ErreurApi, api } from "../lib/api";
import { useCompte } from "../lib/compte";
import { useMessagerie } from "../lib/messagerie-react";

/** Paramètres, Confidentialité, Contacts bloqués : la liste, et le déblocage d'un geste. */
export function Bloques({ onRetour }: { onRetour: () => void }) {
  const { sessionPerdue } = useCompte();
  const { messagerie } = useMessagerie();
  const [bloques, setBloques] = useState<CarteProfil[] | null>(null);
  const [enCours, setEnCours] = useState<string | null>(null);
  const [erreur, setErreur] = useState<string | null>(null);

  useEffect(() => {
    api
      .bloques()
      .then((r) => setBloques(r.bloques))
      .catch((e) => !sessionPerdue(e) && setErreur(e instanceof ErreurApi ? e.message : "Liste indisponible."));
  }, [sessionPerdue]);

  async function debloquer(carte: CarteProfil) {
    setEnCours(carte.id);
    setErreur(null);
    try {
      await messagerie.bloquer(carte.id, false);
      setBloques((liste) => liste?.filter((c) => c.id !== carte.id) ?? null);
    } catch (e) {
      if (!sessionPerdue(e)) setErreur(e instanceof ErreurApi ? e.message : "Le déblocage a échoué.");
    } finally {
      setEnCours(null);
    }
  }

  return (
    <>
      <EnTetePanneau titre="Contacts bloqués" onRetour={onRetour} />
      <div className="animate-fade min-h-0 flex-1 overflow-y-auto">
        {erreur && <p className="px-7 py-3 text-sm text-danger">{erreur}</p>}
        {bloques === null && !erreur && (
          <p className="flex justify-center py-10 text-texte-2">
            <LoaderCircle size={20} className="animate-spin" />
          </p>
        )}
        {bloques?.length === 0 && (
          <div className="animate-rise flex flex-col items-center px-10 py-14 text-center">
            <span className="flex size-16 items-center justify-center rounded-full bg-primaire-doux text-primaire">
              <Ban size={28} />
            </span>
            <p className="mt-5 text-[16px] text-texte">Aucun contact bloqué</p>
          </div>
        )}
        {bloques?.map((c, i) => (
          <LignePersonne
            key={c.id}
            carte={c}
            className={i < 6 ? `animate-fade stagger-${i + 1}` : undefined}
            droite={
              <button
                type="button"
                disabled={enCours === c.id}
                onClick={() => void debloquer(c)}
                className="inline-flex items-center gap-2 rounded-full px-3 py-1.5 text-sm font-medium text-primaire-texte transition-colors hover:bg-primaire-doux disabled:opacity-60"
              >
                {enCours === c.id && <LoaderCircle size={15} className="animate-spin" />} Débloquer
              </button>
            }
          />
        ))}
        <p className="px-7 py-5 text-[13px] leading-relaxed text-texte-3">
          Les contacts bloqués ne peuvent plus vous envoyer de messages, ni voir votre présence, votre photo ou vos infos.
          Ils n'en sont pas avertis. Pour bloquer quelqu'un, ouvrez sa discussion ou ses infos.
        </p>
      </div>
    </>
  );
}
