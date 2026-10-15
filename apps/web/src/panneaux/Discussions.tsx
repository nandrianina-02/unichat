import type { CarteProfil, EvenementSecurite } from "@unichat/shared";
import { EllipsisVertical, LogOut, MessageSquarePlus, Search, Settings, ShieldAlert, UserPlus, X } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { BoutonIcone } from "../composants/BoutonIcone";
import { EVENEMENT_CONTACTS, LignePersonne, TitreSection } from "../composants/Lignes";
import { api } from "../lib/api";
import { useCompte } from "../lib/compte";
import { lieu, quand } from "../lib/format";

interface Props {
  fiche: string | null;
  onFiche: (id: string) => void;
  onNouvelle: () => void;
  onParametres: () => void;
  onDeconnexion: () => void;
}

/** Colonne de gauche : en-tête, recherche, alertes de sécurité, discussions. */
export function Discussions({ fiche, onFiche, onNouvelle, onParametres, onDeconnexion }: Props) {
  const { sessionPerdue } = useCompte();
  const [contacts, setContacts] = useState<CarteProfil[] | null>(null);
  const [recherche, setRecherche] = useState("");
  const [menu, setMenu] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const charger = () =>
      api
        .contacts()
        .then((r) => setContacts(r.contacts))
        .catch((e) => sessionPerdue(e));
    charger();
    window.addEventListener(EVENEMENT_CONTACTS, charger);
    return () => window.removeEventListener(EVENEMENT_CONTACTS, charger);
  }, [sessionPerdue]);

  useEffect(() => {
    if (!menu) return;
    const fermer = (e: MouseEvent) => !menuRef.current?.contains(e.target as Node) && setMenu(false);
    document.addEventListener("mousedown", fermer);
    return () => document.removeEventListener("mousedown", fermer);
  }, [menu]);

  const trouves = useMemo(() => {
    const texte = recherche.trim().toLowerCase();
    if (!texte || !contacts) return [];
    return contacts.filter((c) => c.nom.toLowerCase().includes(texte) || c.pseudo?.includes(texte.replace(/^@/, "")));
  }, [recherche, contacts]);

  return (
    <div className="flex h-full flex-col">
      <header className="flex h-[60px] shrink-0 items-center justify-between pl-5 pr-3">
        <h1 className="text-[22px] font-bold text-texte">Discussions</h1>
        <div className="flex items-center gap-1">
          <BoutonIcone libelle="Nouvelle discussion" onClick={onNouvelle}>
            <MessageSquarePlus size={22} />
          </BoutonIcone>
          <div ref={menuRef} className="relative">
            <BoutonIcone libelle="Menu" actif={menu} onClick={() => setMenu((m) => !m)} aria-haspopup="menu" aria-expanded={menu}>
              <EllipsisVertical size={22} />
            </BoutonIcone>
            {menu && (
              <div role="menu" className="animate-pop absolute right-0 top-11 z-30 w-56 rounded-lg bg-panneau py-2 shadow-xl ring-1 ring-bordure">
                {[
                  { icone: UserPlus, libelle: "Nouveau contact", action: onNouvelle },
                  { icone: Settings, libelle: "Paramètres", action: onParametres },
                  { icone: LogOut, libelle: "Se déconnecter", action: onDeconnexion },
                ].map(({ icone: Icone, libelle, action }) => (
                  <button
                    key={libelle}
                    role="menuitem"
                    type="button"
                    onClick={() => {
                      setMenu(false);
                      action();
                    }}
                    className="flex w-full items-center gap-3 px-5 py-2.5 text-left text-sm text-texte hover:bg-survol"
                  >
                    <Icone size={18} className="text-texte-2" /> {libelle}
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>
      </header>

      <div className="px-3 pb-2">
        <label className="flex h-10 items-center gap-3 rounded-lg bg-champ px-3 focus-within:ring-2 focus-within:ring-primaire/40">
          <Search size={18} className="shrink-0 text-texte-2" />
          <input
            value={recherche}
            onChange={(e) => setRecherche(e.target.value)}
            placeholder="Rechercher un contact"
            className="min-w-0 flex-1 bg-transparent text-[15px] text-texte outline-none placeholder:text-texte-2"
          />
          {recherche && (
            <button type="button" onClick={() => setRecherche("")} aria-label="Effacer la recherche" className="text-texte-2 hover:text-texte">
              <X size={18} />
            </button>
          )}
        </label>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto">
        <AlerteConnexion />
        {recherche.trim() ? (
          trouves.length > 0 ? (
            <>
              <TitreSection>Contacts</TitreSection>
              {trouves.map((c) => (
                <LignePersonne key={c.id} carte={c} selection={fiche === c.id} onClick={() => onFiche(c.id)} />
              ))}
            </>
          ) : (
            <p className="animate-fade px-7 py-10 text-center text-sm text-texte-2">
              Aucun contact ne correspond à « {recherche.trim()} ».
            </p>
          )
        ) : (
          <div className="animate-rise flex flex-col items-center px-10 py-14 text-center">
            <span className="flex size-16 items-center justify-center rounded-full bg-primaire-doux text-primaire">
              <MessageSquarePlus size={28} />
            </span>
            <p className="mt-5 text-[17px] text-texte">Aucune discussion pour l'instant</p>
            <p className="mt-2 text-sm leading-relaxed text-texte-2">
              {contacts && contacts.length > 0
                ? `Vous avez ${contacts.length} contact${contacts.length > 1 ? "s" : ""}. Retrouvez-les avec la recherche ci-dessus.`
                : "Ajoutez un contact avec son nom d'utilisateur ou son adresse e-mail pour commencer."}
            </p>
            <button
              type="button"
              onClick={onNouvelle}
              className="mt-6 inline-flex items-center gap-2 rounded-full bg-primaire px-5 py-2.5 text-sm font-medium text-sur-primaire transition-colors hover:bg-primaire-fort"
            >
              <UserPlus size={18} /> Ajouter un contact
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

/** « Nouvelle connexion à votre compte » : affichée sur les autres appareils jusqu'à ce qu'on la traite. */
function AlerteConnexion() {
  const { sessionPerdue } = useCompte();
  const [alerte, setAlerte] = useState<EvenementSecurite | null>(null);
  const [resultat, setResultat] = useState<string | null>(null);

  useEffect(() => {
    const verifier = () =>
      api
        .alertes()
        .then((r) => setAlerte(r.alertes[0] ?? null))
        .catch((e) => sessionPerdue(e));
    verifier();
    // Revenir sur l'onglet suffit à voir une connexion survenue entre-temps.
    window.addEventListener("focus", verifier);
    return () => window.removeEventListener("focus", verifier);
  }, [sessionPerdue]);

  if (!alerte) return resultat ? <p className="animate-fade mx-3 mb-2 rounded-lg bg-entete px-4 py-3 text-sm text-texte-2">{resultat}</p> : null;

  async function traiter(deconnecter: boolean) {
    try {
      if (deconnecter && alerte?.sessionId) await api.deconnecterAppareil(alerte.sessionId);
      await api.alertesVues();
      setAlerte(null);
      setResultat(deconnecter ? "L'appareil a été déconnecté." : null);
    } catch (e) {
      if (!sessionPerdue(e)) setResultat("L'action n'a pas abouti. Réessayez depuis Paramètres, Compte.");
    }
  }

  const ou = lieu(alerte.ville, alerte.pays);
  return (
    <div role="status" className="animate-rise mx-3 mb-2 flex gap-4 rounded-lg bg-primaire-doux px-4 py-4">
      <span className="flex size-11 shrink-0 items-center justify-center rounded-full bg-primaire text-sur-primaire">
        <ShieldAlert size={22} />
      </span>
      <div className="min-w-0 flex-1">
        <p className="text-[15px] font-medium text-texte">Nouvelle connexion à votre compte</p>
        <p className="mt-0.5 text-sm text-texte-2">
          {alerte.appareil ?? "Appareil inconnu"}
          {ou && ` · ${ou}`} · {quand(alerte.creeLe)}
        </p>
        <div className="mt-3 flex flex-wrap gap-x-5 gap-y-2 text-sm font-medium">
          <button type="button" onClick={() => void traiter(false)} className="text-primaire-texte hover:underline">
            C'est moi
          </button>
          {alerte.sessionActive && (
            <button type="button" onClick={() => void traiter(true)} className="text-danger hover:underline">
              Ce n'est pas moi : déconnecter
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
