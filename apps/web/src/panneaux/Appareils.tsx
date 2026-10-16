import type { AppareilConnecte } from "@unichat/shared";
import clsx from "clsx";
import { Globe, Laptop, LoaderCircle, LogOut, MonitorSmartphone, Smartphone } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { Dialogue } from "../composants/Dialogue";
import { Apparition } from "../composants/Apparition";
import { TitreSection } from "../composants/Lignes";
import { EnTetePanneau } from "../composants/Panneau";
import { ErreurApi, api } from "../lib/api";
import { useCompte } from "../lib/compte";
import { lieu, quand } from "../lib/format";

const ICONES = { web: Globe, android: Smartphone, desktop: Laptop } as const;
const ACTIF = 5 * 60 * 1000;

export function Appareils({ onRetour }: { onRetour: () => void }) {
  const { sessionPerdue, deconnecter } = useCompte();
  const [appareils, setAppareils] = useState<AppareilConnecte[] | null>(null);
  const [erreur, setErreur] = useState<string | null>(null);
  const [cible, setCible] = useState<AppareilConnecte | "autres" | null>(null);
  const [enCours, setEnCours] = useState(false);

  const charger = useCallback(() => {
    api
      .appareils()
      .then((r) => setAppareils(r.appareils))
      .catch((e) => !sessionPerdue(e) && setErreur(e instanceof ErreurApi ? e.message : "Liste indisponible."));
  }, [sessionPerdue]);
  useEffect(charger, [charger]);

  async function confirmer() {
    if (!cible) return;
    setEnCours(true);
    try {
      if (cible === "autres") await api.deconnecterAutres();
      else if (cible.actuel) {
        await deconnecter();
        return;
      } else await api.deconnecterAppareil(cible.id);
      setCible(null);
      charger();
    } catch (e) {
      if (!sessionPerdue(e)) setErreur(e instanceof ErreurApi ? e.message : "La déconnexion a échoué.");
      setCible(null);
    } finally {
      setEnCours(false);
    }
  }

  const autres = appareils?.filter((a) => !a.actuel).length ?? 0;

  return (
    <>
      <EnTetePanneau titre="Appareils connectés" onRetour={onRetour} />
      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="animate-fade flex flex-col items-center px-10 pt-4 pb-6 text-center">
          <span className="flex size-20 items-center justify-center rounded-full bg-primaire-doux text-primaire">
            <MonitorSmartphone size={36} />
          </span>
          <p className="mt-4 text-sm leading-relaxed text-texte-2">
            UniChat fonctionne sur plusieurs appareils à la fois. Déconnectez ceux que vous ne reconnaissez pas : ils devront
            repasser par Google.
          </p>
        </div>

        {erreur && <p className="px-7 pb-3 text-sm text-danger">{erreur}</p>}
        <TitreSection>Appareils actifs</TitreSection>
        {appareils === null && !erreur && (
          <p className="flex items-center gap-3 px-7 py-3 text-sm text-texte-2">
            <LoaderCircle size={18} className="animate-spin" /> Chargement…
          </p>
        )}
        {appareils?.map((a, i) => {
          const Icone = ICONES[a.plateforme];
          const ou = lieu(a.ville, a.pays);
          const actif = a.actuel || Date.now() - a.vuLe < ACTIF;
          return (
            <button
              key={a.id}
              type="button"
              onClick={() => setCible(a)}
              className={clsx("flex w-full items-center gap-5 pl-7 pr-5 text-left transition-colors hover:bg-survol", i < 6 && `animate-fade stagger-${i + 1}`)}
            >
              <span className="flex size-11 shrink-0 items-center justify-center rounded-full bg-entete text-texte-2">
                <Icone size={22} />
              </span>
              <span className="min-w-0 flex-1 border-b border-bordure py-3.5">
                <span className="block text-[16px] text-texte">{a.appareil}</span>
                <span className={clsx("mt-0.5 block text-[13px]", a.actuel ? "text-primaire" : "text-texte-2")}>
                  {a.actuel ? "Cet appareil" : actif ? "Actif maintenant" : `Dernière activité ${quand(a.vuLe)}`}
                </span>
                {ou && <span className="block text-[13px] text-texte-3">{ou}</span>}
              </span>
            </button>
          );
        })}

        {autres > 0 && (
          <div className="px-7 py-6">
            <button
              type="button"
              onClick={() => setCible("autres")}
              className="inline-flex items-center gap-2 rounded-full border border-danger px-5 py-2 text-sm font-medium text-danger transition-colors hover:bg-danger-doux"
            >
              <LogOut size={16} /> Déconnecter tous les autres appareils
            </button>
          </div>
        )}
      </div>

      <Apparition>
        {cible && (
          <Dialogue
            titre={cible === "autres" ? `Déconnecter ${autres} appareil${autres > 1 ? "s" : ""} ?` : cible.actuel ? "Se déconnecter de cet appareil ?" : "Déconnecter cet appareil ?"}
            confirmer="Déconnecter"
            danger
            enCours={enCours}
            onConfirmer={() => void confirmer()}
            onFermer={() => setCible(null)}
          >
            {cible === "autres"
              ? "Tous vos autres appareils seront déconnectés. Cet appareil reste connecté."
              : `${cible.appareil}${lieu(cible.ville, cible.pays) ? `, ${lieu(cible.ville, cible.pays)}` : ""}. Il devra se reconnecter avec Google.`}
          </Dialogue>
        )}
      </Apparition>
    </>
  );
}
