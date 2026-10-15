import type { EvenementSecurite, TypeEvenement } from "@unichat/shared";
import clsx from "clsx";
import { AtSign, LoaderCircle, LogIn, LogOut, ShieldAlert, ShieldX, type LucideIcon } from "lucide-react";
import { useEffect, useState } from "react";
import { EnTetePanneau } from "../composants/Panneau";
import { api } from "../lib/api";
import { useCompte } from "../lib/compte";
import { lieu, quand } from "../lib/format";

const DESCRIPTIONS: Record<TypeEvenement, { icone: LucideIcon; titre: string; alerte?: boolean }> = {
  connexion: { icone: LogIn, titre: "Connexion" },
  deconnexion: { icone: LogOut, titre: "Déconnexion" },
  session_revoquee: { icone: ShieldX, titre: "Appareil déconnecté à distance" },
  reutilisation_jeton: { icone: ShieldAlert, titre: "Session fermée par sécurité", alerte: true },
  pseudo_modifie: { icone: AtSign, titre: "Nom d'utilisateur modifié" },
};

export function Activite({ onRetour }: { onRetour: () => void }) {
  const { sessionPerdue } = useCompte();
  const [evenements, setEvenements] = useState<EvenementSecurite[] | null>(null);
  const [erreur, setErreur] = useState(false);

  useEffect(() => {
    api
      .evenements()
      .then((r) => setEvenements(r.evenements))
      .catch((e) => !sessionPerdue(e) && setErreur(true));
  }, [sessionPerdue]);

  return (
    <>
      <EnTetePanneau titre="Activité du compte" onRetour={onRetour} />
      <div className="min-h-0 flex-1 overflow-y-auto">
        <p className="px-7 pb-4 text-sm leading-relaxed text-texte-2">
          Les connexions et changements importants des six derniers mois. Une session fermée par sécurité signifie qu'une
          ancienne clé de connexion a été réutilisée : changez le mot de passe de votre compte Google si vous ne l'expliquez pas.
        </p>
        {erreur && <p className="px-7 text-sm text-danger">L'activité n'a pas pu être chargée.</p>}
        {evenements === null && !erreur && (
          <p className="flex items-center gap-3 px-7 py-3 text-sm text-texte-2">
            <LoaderCircle size={18} className="animate-spin" /> Chargement…
          </p>
        )}
        {evenements?.map((e, i) => {
          const { icone: Icone, titre, alerte } = DESCRIPTIONS[e.type];
          const ou = lieu(e.ville, e.pays);
          return (
            <div key={e.id} className={clsx("flex items-start gap-5 pl-7 pr-5", i < 6 && `animate-fade stagger-${i + 1}`)}>
              <span
                className={clsx(
                  "mt-3 flex size-10 shrink-0 items-center justify-center rounded-full",
                  alerte ? "bg-danger-doux text-danger" : "bg-entete text-texte-2",
                )}
              >
                <Icone size={20} />
              </span>
              <div className="min-w-0 flex-1 border-b border-bordure py-3.5">
                <p className={clsx("text-[15px]", alerte ? "text-danger" : "text-texte")}>{titre}</p>
                <p className="mt-0.5 text-[13px] text-texte-2">{[e.appareil, ou].filter(Boolean).join(" · ")}</p>
                <p className="text-[13px] text-texte-3">{quand(e.creeLe)}</p>
              </div>
            </div>
          );
        })}
      </div>
    </>
  );
}
