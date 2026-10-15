import { KeyRound, Lock, LogOut, Palette } from "lucide-react";
import { Avatar } from "../composants/Avatar";
import { LigneReglage } from "../composants/Lignes";
import { EnTetePanneau } from "../composants/Panneau";
import { useMoi } from "../lib/compte";
import type { Vue } from "./vues";

interface Props {
  onRetour: () => void;
  onOuvrir: (vue: Vue) => void;
  onTheme: () => void;
  onDeconnexion: () => void;
}

export function Parametres({ onRetour, onOuvrir, onTheme, onDeconnexion }: Props) {
  const moi = useMoi();
  return (
    <>
      <EnTetePanneau titre="Paramètres" onRetour={onRetour} />
      <div className="min-h-0 flex-1 overflow-y-auto">
        <button
          type="button"
          onClick={() => onOuvrir("profil")}
          className="animate-fade flex w-full items-center gap-4 px-5 py-4 text-left transition-colors hover:bg-survol"
        >
          <Avatar id={moi.id} photo={moi.photo} nom={moi.nom} taille={82} />
          <span className="min-w-0">
            <span className="block truncate text-[19px] text-texte">{moi.nom}</span>
            <span className="mt-1 block truncate text-[14px] text-texte-2">{moi.infos}</span>
          </span>
        </button>
        <div className="animate-fade stagger-1">
          <LigneReglage icone={KeyRound} titre="Compte" detail="Appareils connectés, activité du compte" onClick={() => onOuvrir("compte")} />
          <LigneReglage
            icone={Lock}
            titre="Confidentialité"
            detail="Photo de profil, infos, recherche par e-mail"
            onClick={() => onOuvrir("confidentialite")}
          />
          <LigneReglage icone={Palette} titre="Thème" detail="Clair, sombre ou selon le système" onClick={onTheme} fleche={false} />
          <LigneReglage icone={LogOut} titre="Se déconnecter" onClick={onDeconnexion} danger fleche={false} />
        </div>
      </div>
    </>
  );
}
