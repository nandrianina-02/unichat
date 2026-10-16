import { Download, KeyRound, Lock, LogOut, Palette, Smartphone, Wallpaper } from "lucide-react";
import { Avatar } from "../composants/Avatar";
import { LigneReglage } from "../composants/Lignes";
import { EnTetePanneau } from "../composants/Panneau";
import { useMoi } from "../lib/compte";
import { estAndroid, estApplication, useInstallation } from "../lib/installation";
import type { Vue } from "./vues";

interface Props {
  onRetour: () => void;
  onOuvrir: (vue: Vue) => void;
  onTheme: () => void;
  onFond: () => void;
  onDeconnexion: () => void;
}

export function Parametres({ onRetour, onOuvrir, onTheme, onFond, onDeconnexion }: Props) {
  const moi = useMoi();
  const installation = useInstallation();
  const application = estApplication();
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
            detail="Dernière connexion, confirmations de lecture, contacts bloqués"
            onClick={() => onOuvrir("confidentialite")}
          />
          <LigneReglage icone={Palette} titre="Thème" detail="Clair, sombre ou selon le système" onClick={onTheme} fleche={false} />
          <LigneReglage icone={Wallpaper} titre="Fond des discussions" detail="Teinte et motif, sur cet appareil" onClick={onFond} fleche={false} />
          {!application && (installation.possible || estAndroid()) && (
            <LigneReglage
              icone={estAndroid() ? Smartphone : Download}
              titre="Installer UniChat"
              detail={
                installation.possible
                  ? estAndroid()
                    ? "Sur l'écran d'accueil, avec les notifications"
                    : "Une fenêtre à part, ouverte depuis le bureau"
                  : "Dans Chrome : menu ⋮, puis « Installer l'application »"
              }
              onClick={installation.possible ? () => void installation.installer() : undefined}
              fleche={false}
            />
          )}
          <LigneReglage icone={LogOut} titre="Se déconnecter" onClick={onDeconnexion} danger fleche={false} />
        </div>
        <p className="animate-fade stagger-2 flex flex-wrap gap-x-4 gap-y-1 px-7 py-6 text-[13px] text-texte-3">
          <a href="/confidentialite" target="_blank" rel="noopener" className="hover:text-texte-2 hover:underline">
            Règles de confidentialité
          </a>
          <a href="/conditions" target="_blank" rel="noopener" className="hover:text-texte-2 hover:underline">
            Conditions d'utilisation
          </a>
        </p>
      </div>
    </>
  );
}
