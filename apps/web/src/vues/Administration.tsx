import clsx from "clsx";
import { ArrowLeft, Flag, LayoutDashboard, ScrollText, ShieldCheck, UsersRound, X, type LucideIcon } from "lucide-react";
import { useState } from "react";
import { BoutonIcone } from "../composants/BoutonIcone";
import { api } from "../lib/api";
import { useRetourSysteme } from "../lib/retour";
import { Comptes } from "./admin/Comptes";
import { Journal } from "./admin/Journal";
import { Signalements } from "./admin/Signalements";
import { Tableau } from "./admin/Tableau";
import { Attente, useChargement } from "./admin/outils";

type Onglet = "tableau" | "comptes" | "signalements" | "journal";

const ONGLETS: { id: Onglet; libelle: string; icone: LucideIcon }[] = [
  { id: "tableau", libelle: "Tableau de bord", icone: LayoutDashboard },
  { id: "comptes", libelle: "Comptes", icone: UsersRound },
  { id: "signalements", libelle: "Signalements", icone: Flag },
  { id: "journal", libelle: "Journal", icone: ScrollText },
];

/**
 * Espace d'administration : chiffres du service, comptes, signalements,
 * journal des actions. Le serveur vérifie le droit à chaque requête ; cette
 * vue n'est qu'une façade.
 */
export function Administration({ onFermer }: { onFermer: () => void }) {
  const [onglet, setOnglet] = useState<Onglet>("tableau");
  const [compte, setCompte] = useState<string | null>(null);
  const [version, setVersion] = useState(0);
  const tableau = useChargement(() => api.admin.tableau(), `tableau-${version}`);
  useRetourSysteme(compte !== null, () => setCompte(null));

  const ouvrirCompte = (id: string) => {
    setCompte(id);
    setOnglet("comptes");
  };
  const ouverts = tableau.donnees?.signalementsOuverts ?? 0;

  return (
    <section className="flex h-full w-full flex-col bg-panneau">
      <header className="flex h-[60px] shrink-0 items-center gap-2 bg-entete px-2 md:px-4">
        <BoutonIcone libelle="Retour" onClick={onFermer} className="md:hidden">
          <ArrowLeft size={22} />
        </BoutonIcone>
        <ShieldCheck size={22} className="ml-2 hidden shrink-0 text-primaire md:block" />
        <h1 className="flex-1 pl-1 text-[17px] text-texte md:pl-2">Administration</h1>
        {/* Enveloppé : la classe d'affichage du bouton l'emporterait sur « hidden ». */}
        <span className="hidden md:block">
          <BoutonIcone libelle="Fermer l'administration" onClick={onFermer}>
            <X size={22} />
          </BoutonIcone>
        </span>
      </header>

      <nav role="tablist" aria-label="Sections de l'administration" className="flex shrink-0 overflow-x-auto border-b border-bordure px-2 md:px-6">
        {ONGLETS.map(({ id, libelle, icone: Icone }) => (
          <button
            key={id}
            type="button"
            role="tab"
            aria-selected={onglet === id}
            onClick={() => {
              setOnglet(id);
              if (id === "comptes") setCompte(null);
            }}
            className={clsx(
              "relative flex shrink-0 items-center gap-2 px-3 py-3 text-[14px] transition-colors",
              onglet === id ? "text-primaire-texte" : "text-texte-2 hover:text-texte",
            )}
          >
            <Icone size={17} />
            {libelle}
            {id === "signalements" && ouverts > 0 && (
              <span className="min-w-5 rounded-full bg-danger px-1.5 text-center text-[11.5px] leading-5 font-medium text-sur-primaire">{ouverts}</span>
            )}
            {onglet === id && <span className="animate-fade absolute inset-x-2 bottom-0 h-0.5 rounded-full bg-primaire" />}
          </button>
        ))}
      </nav>

      <div className="min-h-0 flex-1 overflow-y-auto">
        <div key={onglet} className="animate-fade mx-auto w-full max-w-5xl px-4 pt-6 md:px-8">
          {onglet === "tableau" &&
            (tableau.erreur ? (
              <p className="py-6 text-sm text-danger">{tableau.erreur}</p>
            ) : tableau.donnees ? (
              <Tableau t={tableau.donnees} onSignalements={() => setOnglet("signalements")} />
            ) : (
              <Attente />
            ))}
          {onglet === "comptes" && <Comptes ouvert={compte} onOuvrir={setCompte} />}
          {onglet === "signalements" && <Signalements onOuvrirCompte={ouvrirCompte} onTraite={() => setVersion((v) => v + 1)} />}
          {onglet === "journal" && <Journal />}
        </div>
      </div>
    </section>
  );
}
