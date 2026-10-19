import type { ActionAdmin, ActionAdministration } from "@unichat/shared";
import clsx from "clsx";
import { Ban, Check, LogOut, ShieldCheck, Trash2, UsersRound, type LucideIcon } from "lucide-react";
import { useEffect, useState } from "react";
import { api } from "../../lib/api";
import { Attente, dateHeure, useChargement } from "./outils";

const ACTIONS: Record<ActionAdministration, { icone: LucideIcon; verbe: string }> = {
  suspension: { icone: Ban, verbe: "a suspendu" },
  suspension_levee: { icone: ShieldCheck, verbe: "a levé la suspension de" },
  deconnexion: { icone: LogOut, verbe: "a déconnecté les appareils de" },
  suppression_compte: { icone: Trash2, verbe: "a supprimé le compte de" },
  fermeture_groupe: { icone: UsersRound, verbe: "a fermé le groupe" },
  signalement_classe: { icone: Check, verbe: "a classé sans suite un signalement" },
};

/** Ce que l'administration a fait, et pourquoi : la modération reste vérifiable. */
export function Journal() {
  const { donnees, erreur } = useChargement(() => api.admin.journal(), "journal");
  const [suite, setSuite] = useState<ActionAdmin[]>([]);
  const [curseur, setCurseur] = useState<number | null>(null);
  useEffect(() => setCurseur(donnees?.suite ?? null), [donnees]);

  async function plus() {
    if (curseur === null) return;
    const r = await api.admin.journal(curseur);
    setSuite((s) => [...s, ...r.actions]);
    setCurseur(r.suite);
  }

  if (erreur) return <p className="py-6 text-sm text-danger">{erreur}</p>;
  if (!donnees) return <Attente />;
  const actions = [...donnees.actions, ...suite];
  if (actions.length === 0) return <p className="animate-fade py-12 text-center text-sm text-texte-2">Aucune action pour l'instant.</p>;

  return (
    <div className="pb-10">
      <ol className="border-t border-bordure">
        {actions.map((a, i) => {
          const { icone: Icone, verbe } = ACTIONS[a.action] ?? { icone: Check, verbe: a.action };
          return (
            <li key={a.id} className={clsx("flex gap-4 border-b border-bordure px-2 py-3.5", i < 6 && `animate-fade stagger-${i + 1}`)}>
              <Icone size={18} className={clsx("mt-0.5 shrink-0", a.action === "suspension" || a.action === "suppression_compte" || a.action === "fermeture_groupe" ? "text-danger" : "text-texte-2")} />
              <div className="min-w-0 flex-1">
                <p className="text-[14.5px] text-texte">
                  {a.adminNom} {verbe}
                  {a.cibleNom && ` ${a.action === "fermeture_groupe" ? `« ${a.cibleNom} »` : a.cibleNom}`}
                </p>
                {a.detail && <p className="mt-0.5 text-[13.5px] text-texte-2">{a.detail}</p>}
              </div>
              <time className="shrink-0 text-[12.5px] text-texte-3">{dateHeure(a.creeLe)}</time>
            </li>
          );
        })}
      </ol>
      {curseur !== null && (
        <div className="py-5 text-center">
          <button type="button" onClick={() => void plus()} className="rounded-full bg-entete px-5 py-2 text-sm text-texte-2 transition-colors hover:text-texte">
            Afficher plus
          </button>
        </div>
      )}
    </div>
  );
}
