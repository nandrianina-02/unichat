import { lireRecherche, type CarteProfil } from "@unichat/shared";
import { Check, Link, LoaderCircle, Search, UserCheck, UserPlus, UsersRound, X } from "lucide-react";
import { useEffect, useState } from "react";
import { EVENEMENT_CONTACTS, LignePersonne, TitreSection, contactsModifies } from "../composants/Lignes";
import { EnTetePanneau } from "../composants/Panneau";
import { ErreurApi, api } from "../lib/api";
import { useCompte, useMoi } from "../lib/compte";
import { useMessagerie } from "../lib/messagerie-react";
import { lienContact, oublierInvitation } from "../lib/invitation";

type Resultat =
  | { etat: "vide" }
  | { etat: "indice" }
  | { etat: "recherche" }
  | { etat: "trouve"; carte: CarteProfil }
  | { etat: "aucun" }
  | { etat: "erreur"; message: string };

interface Props {
  onRetour: () => void;
  /** Ouvre la discussion avec cette personne. */
  onOuvrir: (id: string) => void;
  /** Nom d'utilisateur reçu par un lien de contact. */
  invitation: string | null;
  onNouveauGroupe: () => void;
}

export function NouvelleDiscussion({ onRetour, onOuvrir, invitation, onNouveauGroupe }: Props) {
  const moi = useMoi();
  const { messagerie } = useMessagerie();
  const ouvrir = (carte: CarteProfil) => {
    messagerie.retenirPersonne(carte);
    onOuvrir(carte.id);
  };
  const { sessionPerdue } = useCompte();
  const [texte, setTexte] = useState(invitation ? `@${invitation}` : "");
  const [resultat, setResultat] = useState<Resultat>({ etat: "vide" });
  const [contacts, setContacts] = useState<CarteProfil[] | null>(null);
  const [ajout, setAjout] = useState(false);
  const [copie, setCopie] = useState(false);

  useEffect(() => {
    if (invitation) oublierInvitation();
  }, [invitation]);

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

  // Recherche exacte, lancée seulement quand la saisie a la forme d'une
  // adresse ou d'un nom d'utilisateur complet.
  useEffect(() => {
    if (!texte.trim()) {
      setResultat({ etat: "vide" });
      return;
    }
    if (!lireRecherche(texte)) {
      setResultat({ etat: "indice" });
      return;
    }
    setResultat({ etat: "recherche" });
    const controle = new AbortController();
    const minuterie = setTimeout(() => {
      api
        .rechercher(texte, controle.signal)
        .then((r) => setResultat(r.resultats[0] ? { etat: "trouve", carte: r.resultats[0] } : { etat: "aucun" }))
        .catch((e) => {
          if (controle.signal.aborted || sessionPerdue(e)) return;
          setResultat({ etat: "erreur", message: e instanceof ErreurApi ? e.message : "Recherche impossible." });
        });
    }, 400);
    return () => {
      clearTimeout(minuterie);
      controle.abort();
    };
  }, [texte, sessionPerdue]);

  async function ajouter(carte: CarteProfil) {
    setAjout(true);
    try {
      const nouvelle = await api.ajouterContact(carte.id);
      setResultat({ etat: "trouve", carte: nouvelle });
      contactsModifies();
    } catch (e) {
      if (!sessionPerdue(e)) setResultat({ etat: "erreur", message: e instanceof ErreurApi ? e.message : "Ajout impossible." });
    } finally {
      setAjout(false);
    }
  }

  async function copierLien() {
    if (!moi.pseudo) return;
    try {
      await navigator.clipboard.writeText(lienContact(moi.pseudo));
      setCopie(true);
      setTimeout(() => setCopie(false), 2000);
    } catch {
      // Presse-papiers refusé : le lien reste lisible et sélectionnable.
    }
  }

  return (
    <>
      <EnTetePanneau titre="Nouvelle discussion" onRetour={onRetour} />
      <div className="px-3 pb-3">
        <label className="flex h-10 items-center gap-3 rounded-lg bg-champ px-3 focus-within:ring-2 focus-within:ring-primaire/40">
          <Search size={18} className="shrink-0 text-texte-2" />
          <input
            autoFocus
            value={texte}
            onChange={(e) => setTexte(e.target.value)}
            placeholder="Nom d'utilisateur ou adresse e-mail"
            autoCapitalize="none"
            spellCheck={false}
            className="min-w-0 flex-1 bg-transparent text-[15px] text-texte outline-none placeholder:text-texte-2"
          />
          {texte && (
            <button type="button" onClick={() => setTexte("")} aria-label="Effacer" className="text-texte-2 hover:text-texte">
              <X size={18} />
            </button>
          )}
        </label>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto">
        {resultat.etat === "indice" && (
          <p className="animate-fade px-7 py-4 text-sm leading-relaxed text-texte-2">
            Saisissez un nom d'utilisateur complet (par exemple @ana.rakoto) ou une adresse e-mail entière. Pour protéger
            chacun, UniChat ne propose pas de résultats partiels.
          </p>
        )}
        {resultat.etat === "recherche" && (
          <p className="flex items-center gap-3 px-7 py-5 text-sm text-texte-2">
            <LoaderCircle size={18} className="animate-spin" /> Recherche…
          </p>
        )}
        {resultat.etat === "aucun" && (
          <p className="animate-fade px-7 py-5 text-sm text-texte-2">
            Personne sur UniChat n'a ce nom d'utilisateur, ou cette personne ne souhaite pas être trouvée par son adresse
            e-mail.
          </p>
        )}
        {resultat.etat === "erreur" && <p className="animate-fade px-7 py-5 text-sm text-danger">{resultat.message}</p>}
        {resultat.etat === "trouve" && (
          <div className="animate-rise">
            <TitreSection>Résultat</TitreSection>
            <LignePersonne
              carte={resultat.carte}
              onClick={() => ouvrir(resultat.carte)}
              droite={
                resultat.carte.estSoi ? null : resultat.carte.estContact ? (
                  <span className="flex items-center gap-1.5 text-sm text-texte-2">
                    <UserCheck size={18} /> Contact
                  </span>
                ) : (
                  <button
                    type="button"
                    disabled={ajout}
                    onClick={(e) => {
                      e.stopPropagation();
                      void ajouter(resultat.carte);
                    }}
                    className="inline-flex items-center gap-1.5 rounded-full bg-primaire px-4 py-1.5 text-sm font-medium text-sur-primaire hover:bg-primaire-fort disabled:opacity-60"
                  >
                    {ajout ? <LoaderCircle size={16} className="animate-spin" /> : <UserPlus size={16} />} Ajouter
                  </button>
                )
              }
            />
          </div>
        )}

        <button type="button" onClick={onNouveauGroupe} className="flex w-full items-center gap-4 pl-4 pr-4 text-left hover:bg-survol">
          <span className="flex size-[49px] shrink-0 items-center justify-center rounded-full bg-primaire text-sur-primaire">
            <UsersRound size={22} />
          </span>
          <span className="min-w-0 flex-1 border-b border-bordure py-3.5">
            <span className="block text-[17px] text-texte">Nouveau groupe</span>
            <span className="mt-0.5 block truncate text-[14px] text-texte-2">Jusqu'à 40 personnes de vos contacts</span>
          </span>
        </button>

        {moi.pseudo && (
          <button type="button" onClick={() => void copierLien()} className="flex w-full items-center gap-4 pl-4 pr-4 text-left hover:bg-survol">
            <span className="flex size-[49px] shrink-0 items-center justify-center rounded-full bg-primaire text-sur-primaire">
              {copie ? <Check size={22} /> : <Link size={22} />}
            </span>
            <span className="min-w-0 flex-1 border-b border-bordure py-3.5">
              <span className="block text-[17px] text-texte">{copie ? "Lien copié" : "Partager mon lien de contact"}</span>
              <span className="mt-0.5 block truncate text-[14px] text-texte-2">{lienContact(moi.pseudo)}</span>
            </span>
          </button>
        )}

        <TitreSection>Contacts sur UniChat</TitreSection>
        {contacts === null ? (
          <p className="flex items-center gap-3 px-7 py-3 text-sm text-texte-2">
            <LoaderCircle size={18} className="animate-spin" /> Chargement…
          </p>
        ) : contacts.length === 0 ? (
          <p className="px-7 py-3 text-sm text-texte-2">Vous n'avez pas encore de contact.</p>
        ) : (
          contacts.map((c, i) => (
            <LignePersonne key={c.id} carte={c} onClick={() => ouvrir(c)} className={i < 6 ? `animate-fade stagger-${i + 1}` : undefined} />
          ))
        )}
      </div>
    </>
  );
}
