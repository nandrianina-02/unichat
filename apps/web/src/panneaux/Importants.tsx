import { estGroupe, idGroupe } from "@unichat/shared";
import { LoaderCircle, Star } from "lucide-react";
import { useEffect, useState } from "react";
import { EnTetePanneau } from "../composants/Panneau";
import { dateListe, resumeMessage } from "../lib/format";
import { useMessagerie } from "../lib/messagerie-react";
import type { MessageLocal } from "../lib/stockage";

/** « Messages importants » : ceux marqués d'une étoile, toutes discussions confondues, du plus récent au plus ancien. */
export function Importants({ onRetour, onOuvrir }: { onRetour: () => void; onOuvrir: (conversation: string, message: string) => void }) {
  const { messagerie, etat } = useMessagerie();
  const [liste, setListe] = useState<MessageLocal[] | null>(null);

  // Relu à chaque changement d'une discussion : une étoile retirée ailleurs disparaît d'ici.
  useEffect(() => {
    void messagerie.importants().then(setListe);
  }, [messagerie, etat.versions]);

  const lieu = (m: MessageLocal) =>
    estGroupe(m.conversation) ? (etat.groupes[idGroupe(m.conversation)]?.nom ?? "Groupe") : messagerie.nom(m.de === messagerie.moi ? m.a : m.de);

  return (
    <>
      <EnTetePanneau titre="Messages importants" onRetour={onRetour} />
      <div className="animate-fade min-h-0 flex-1 overflow-y-auto">
        {liste === null && (
          <p className="flex justify-center py-10 text-texte-2">
            <LoaderCircle size={20} className="animate-spin" />
          </p>
        )}
        {liste?.length === 0 && (
          <div className="animate-rise flex flex-col items-center px-10 py-14 text-center">
            <span className="flex size-16 items-center justify-center rounded-full bg-primaire-doux text-primaire">
              <Star size={28} />
            </span>
            <p className="mt-5 text-[16px] text-texte">Aucun message important</p>
            <p className="mt-2 text-sm leading-relaxed text-texte-2">
              Marquez un message d'une étoile depuis son menu pour le retrouver ici.
            </p>
          </div>
        )}
        {liste?.map((m, i) => (
          <button
            key={m.id}
            type="button"
            onClick={() => onOuvrir(m.conversation, m.id)}
            className={`flex w-full flex-col gap-1 border-b border-bordure px-7 py-3.5 text-left transition-colors hover:bg-survol ${i < 6 ? `animate-fade stagger-${i + 1}` : ""}`}
          >
            <span className="flex items-baseline justify-between gap-3 text-[12.5px] text-texte-2">
              <span className="truncate">
                {messagerie.nom(m.de, m.conversation)}
                {(estGroupe(m.conversation) || m.de === messagerie.moi) && ` · ${lieu(m)}`}
              </span>
              <span className="shrink-0">{dateListe(m.le)}</span>
            </span>
            <span className="flex items-start gap-2 text-[14.5px] text-texte">
              <Star size={14} className="mt-1 shrink-0 fill-current text-texte-3" aria-hidden="true" />
              <span className="line-clamp-3">{resumeMessage(m)}</span>
            </span>
          </button>
        ))}
      </div>
    </>
  );
}
