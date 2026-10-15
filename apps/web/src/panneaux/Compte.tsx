import { History, Mail, MonitorSmartphone, Trash2 } from "lucide-react";
import { LigneReglage } from "../composants/Lignes";
import { EnTetePanneau } from "../composants/Panneau";
import { useMoi } from "../lib/compte";
import type { Vue } from "./vues";

export function Compte({ onRetour, onOuvrir }: { onRetour: () => void; onOuvrir: (vue: Vue) => void }) {
  const moi = useMoi();
  return (
    <>
      <EnTetePanneau titre="Compte" onRetour={onRetour} />
      <div className="animate-fade min-h-0 flex-1 overflow-y-auto">
        <LigneReglage
          icone={MonitorSmartphone}
          titre="Appareils connectés"
          detail="Voir et déconnecter vos appareils"
          onClick={() => onOuvrir("appareils")}
        />
        <LigneReglage icone={History} titre="Activité du compte" detail="Connexions et changements récents" onClick={() => onOuvrir("activite")} />
        <LigneReglage icone={Mail} titre="Adresse e-mail" detail={`${moi.email} · connexion avec Google`} />
        <LigneReglage icone={Trash2} titre="Supprimer mon compte" danger onClick={() => onOuvrir("supprimer-compte")} />
      </div>
    </>
  );
}
