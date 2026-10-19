import { autreParticipant, conversationDirecte, conversationGroupe, estGroupe, idGroupe } from "@unichat/shared";
import clsx from "clsx";
import { MessageSquareText, Settings } from "lucide-react";
import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { Apparition, useEncoreVisible, useSortie } from "../composants/Apparition";
import { Avatar } from "../composants/Avatar";
import { BoutonIcone } from "../composants/BoutonIcone";
import { Dialogue } from "../composants/Dialogue";
import { DialogueTheme } from "../composants/DialogueTheme";
import { CouchePanneau, usePile } from "../composants/Panneau";
import { useCompte, useMoi } from "../lib/compte";
import { invitationEnAttente } from "../lib/invitation";
import { useMessagerie } from "../lib/messagerie-react";
import { Activite } from "../panneaux/Activite";
import { Appareils } from "../panneaux/Appareils";
import { Compte } from "../panneaux/Compte";
import { Bloques } from "../panneaux/Bloques";
import { ChoixAjoutGroupes, ChoixVisibilite, ChoixVu, Confidentialite } from "../panneaux/Confidentialite";
import { DialogueRejoindre } from "../composants/LienGroupe";
import { invitationGroupeEnAttente, oublierInvitationGroupe } from "../lib/invitation";
import { useRetourSysteme } from "../lib/retour";
import { Discussions } from "../panneaux/Discussions";
import { NouveauGroupe } from "../panneaux/NouveauGroupe";
import { NouvelleDiscussion } from "../panneaux/NouvelleDiscussion";
import { Parametres } from "../panneaux/Parametres";
import { Profil } from "../panneaux/Profil";
import { SupprimerCompte } from "../panneaux/SupprimerCompte";
import type { Vue } from "../panneaux/vues";
import { Accueil } from "../vues/Accueil";
import { Administration } from "../vues/Administration";
import { Discussion } from "../vues/Discussion";
import { FicheContact } from "../vues/FicheContact";
import { InfosGroupe } from "../vues/InfosGroupe";
import { RechercheMessages } from "../vues/RechercheMessages";
import { Galerie } from "../vues/Galerie";
import { DialogueFond } from "../composants/DialogueFond";
import { Importants } from "../panneaux/Importants";

/** Ce qu'affiche la zone principale. */
type Principal =
  | { type: "accueil" }
  | {
      type: "discussion";
      conversation: string;
      /** Panneau à côté de la discussion : infos, ou recherche dans les messages. */
      cote: "infos" | "recherche" | "galerie" | null;
      /** Message à montrer en ouvrant la discussion. */
      cible?: string;
    }
  /** Espace d'administration (comptes désignés par le serveur). */
  | { type: "admin" };

const ACCUEIL: Principal = { type: "accueil" };

/**
 * L'application connectée, organisée comme les messageries de bureau : une
 * barre d'icônes, la colonne des discussions (où s'empilent les panneaux),
 * et la zone principale.
 */
export function Application() {
  const moi = useMoi();
  const { deconnecter } = useCompte();
  const { messagerie } = useMessagerie();
  const { pile, ouvrir, retour, toutFermer, retirer } = usePile<Vue>();
  const [principal, setPrincipal] = useState<Principal>(ACCUEIL);
  const [theme, setTheme] = useState(false);
  const [fond, setFond] = useState(false);
  const [deconnexion, setDeconnexion] = useState(false);
  const [invitation] = useState(invitationEnAttente);
  const [invitationGroupe, setInvitationGroupe] = useState(invitationGroupeEnAttente);

  const ouvrirDiscussion = useCallback(
    (conversation: string, cible?: string) => setPrincipal({ type: "discussion", conversation, cote: null, ...(cible ? { cible } : {}) }),
    [],
  );
  const ouvrirPersonne = useCallback(
    (id: string) => ouvrirDiscussion(conversationDirecte(moi.id, id)),
    [moi.id, ouvrirDiscussion],
  );

  // Un clic sur une notification ramène à la discussion concernée : directement,
  // par le service worker si la page était ouverte, ou par l'adresse sinon.
  useEffect(() => {
    messagerie.surOuverture = ouvrirDiscussion;
    const surMessage = (e: MessageEvent<{ type?: string; conversation?: string }>) => {
      if (e.data?.type === "ouvrir" && e.data.conversation) ouvrirDiscussion(e.data.conversation);
    };
    navigator.serviceWorker?.addEventListener("message", surMessage);
    return () => {
      messagerie.surOuverture = null;
      navigator.serviceWorker?.removeEventListener("message", surMessage);
    };
  }, [messagerie, ouvrirDiscussion]);
  useEffect(() => {
    const parametres = new URLSearchParams(location.search);
    const conversation = parametres.get("conversation");
    if (!conversation && !parametres.has("source")) return;
    history.replaceState(null, "", "/");
    if (conversation && /^(d|g):[0-9a-f:-]+$/i.test(conversation)) ouvrirDiscussion(conversation);
  }, [ouvrirDiscussion]);

  // Le plein écran du téléphone tient jusqu'à ce que la vue ait fini de partir.
  const pleinEcran = useEncoreVisible(principal.type !== "accueil");

  // Retour (Android, navigateur) : referme le panneau d'à côté, puis la discussion (ou l'administration).
  useRetourSysteme(principal.type !== "accueil", () => setPrincipal(ACCUEIL));
  useRetourSysteme(principal.type === "discussion" && principal.cote !== null, () =>
    setPrincipal((p) => (p.type === "discussion" ? { ...p, cote: null } : p)),
  );

  // Lien de contact reçu avant la connexion : on ouvre directement la recherche
  // (une seule fois, même si React rejoue l'effet en développement).
  const invitationTraitee = useRef(false);
  useEffect(() => {
    if (!invitation || invitationTraitee.current) return;
    invitationTraitee.current = true;
    ouvrir("nouvelle");
  }, [invitation, ouvrir]);

  const base = pile.find((e) => !e.fermeture)?.vue ?? null;
  const onglet = base === null || base === "nouvelle" ? "discussions" : base === "profil" ? "profil" : "parametres";

  const allerA = useCallback(
    (vue: Vue | null) => {
      if (vue !== null && base === vue && pile.filter((e) => !e.fermeture).length === 1) return;
      toutFermer();
      if (vue) ouvrir(vue);
    },
    [base, pile, toutFermer, ouvrir],
  );

  function rendre(vue: Vue) {
    switch (vue) {
      case "nouvelle":
        return (
          <NouvelleDiscussion
            onRetour={retour}
            onOuvrir={(id) => {
              toutFermer();
              ouvrirPersonne(id);
            }}
            invitation={invitation}
            onNouveauGroupe={() => ouvrir("nouveau-groupe")}
          />
        );
      case "nouveau-groupe":
        return (
          <NouveauGroupe
            onRetour={retour}
            onCree={(groupe) => {
              messagerie.retenirGroupe(groupe);
              toutFermer();
              ouvrirDiscussion(conversationGroupe(groupe.id));
            }}
          />
        );
      case "parametres":
        return (
          <Parametres
            onRetour={retour}
            onOuvrir={ouvrir}
            onTheme={() => setTheme(true)}
            onFond={() => setFond(true)}
            onDeconnexion={() => setDeconnexion(true)}
            onAdministration={moi.admin ? () => setPrincipal({ type: "admin" }) : undefined}
          />
        );
      case "profil":
        return <Profil onRetour={retour} />;
      case "compte":
        return <Compte onRetour={retour} onOuvrir={ouvrir} />;
      case "appareils":
        return <Appareils onRetour={retour} />;
      case "activite":
        return <Activite onRetour={retour} />;
      case "confidentialite":
        return <Confidentialite onRetour={retour} onOuvrir={ouvrir} />;
      case "visibilite-photo":
        return <ChoixVisibilite champ="photo" onRetour={retour} />;
      case "visibilite-infos":
        return <ChoixVisibilite champ="infos" onRetour={retour} />;
      case "supprimer-compte":
        return <SupprimerCompte onRetour={retour} />;
      case "bloques":
        return <Bloques onRetour={retour} />;
      case "visibilite-vu":
        return <ChoixVu onRetour={retour} />;
      case "ajout-groupes":
        return <ChoixAjoutGroupes onRetour={retour} />;
      case "importants":
        return <Importants onRetour={retour} onOuvrir={(conversation, message) => ouvrirDiscussion(conversation, message)} />;
    }
  }

  const selection = principal.type === "discussion" ? principal.conversation : null;

  return (
    <div className="animate-fade flex h-full overflow-hidden bg-fond">
      <nav aria-label="Navigation" className="hidden w-16 shrink-0 flex-col items-center justify-between border-r border-bordure bg-entete py-3 md:flex">
        <BoutonIcone libelle="Discussions" actif={onglet === "discussions"} onClick={() => allerA(null)}>
          <MessageSquareText size={22} />
        </BoutonIcone>
        <div className="flex flex-col items-center gap-3">
          <BoutonIcone libelle="Paramètres" actif={onglet === "parametres"} onClick={() => allerA("parametres")}>
            <Settings size={22} />
          </BoutonIcone>
          <button
            type="button"
            onClick={() => allerA("profil")}
            title="Profil"
            aria-label="Profil"
            className={clsx("rounded-full p-0.5 transition-shadow", onglet === "profil" && "ring-2 ring-primaire")}
          >
            <Avatar id={moi.id} photo={moi.photo} nom={moi.nom} taille={30} />
          </button>
        </div>
      </nav>

      <aside className="relative flex w-full shrink-0 flex-col overflow-hidden border-bordure bg-panneau md:w-[380px] md:border-r lg:w-[30%] lg:min-w-[340px] lg:max-w-[460px]">
        <Discussions
          selection={selection}
          onOuvrir={ouvrirDiscussion}
          onOuvrirPersonne={ouvrirPersonne}
          onNouvelle={() => allerA("nouvelle")}
          onParametres={() => allerA("parametres")}
          onImportants={() => allerA("importants")}
          onDeconnexion={() => setDeconnexion(true)}
        />
        {pile.map((e, i) => (
          <CouchePanneau key={e.cle} fermeture={e.fermeture} niveau={i} onFini={() => retirer(e.cle)} onRetour={retour}>
            {rendre(e.vue)}
          </CouchePanneau>
        ))}
      </aside>

      {/* Sur téléphone, la discussion ou la fiche recouvre tout l'écran. */}
      <main
        className={clsx(
          "min-w-0",
          !pleinEcran
            ? "relative hidden flex-1 md:flex"
            : // Un seul positionnement par taille d'écran : « relative » et « fixed »
              // ensemble s'annulent selon l'ordre des règles CSS.
              "fixed inset-0 z-40 flex md:relative md:inset-auto md:z-auto md:flex-1",
          // Discussion en train de partir sur téléphone : la liste reçoit déjà les doigts.
          principal.type === "accueil" && "pointer-events-none md:pointer-events-auto",
        )}
      >
        {principal.type === "accueil" && (
          // Sur téléphone, c'est la liste qui doit apparaître sous la discussion qui s'en va.
          <div className="hidden min-w-0 flex-1 md:flex">
            <Accueil onAjouter={() => allerA("nouvelle")} />
          </div>
        )}
        <Apparition>
          {principal.type === "discussion" && (
            <VuePrincipale key={principal.conversation}>
              <Discussion
                key={`${principal.conversation}|${principal.cible ?? ""}`}
                conversation={principal.conversation}
                cible={principal.cible}
                onInfos={() => setPrincipal({ ...principal, cote: "infos" })}
                onRechercher={() => setPrincipal({ ...principal, cote: "recherche" })}
                onFermer={() => setPrincipal(ACCUEIL)}
                onEcrireA={ouvrirPersonne}
              />
              <Apparition>
                {principal.cote && (
                  <PanneauCote cote={principal.cote}>
                    {principal.cote === "galerie" ? (
                      <Galerie
                        key={`galerie-${principal.conversation}`}
                        conversation={principal.conversation}
                        onFermer={() => setPrincipal({ ...principal, cote: "infos" })}
                      />
                    ) : principal.cote === "recherche" ? (
                      <RechercheMessages
                        key={`recherche-${principal.conversation}`}
                        conversation={principal.conversation}
                        onFermer={() => setPrincipal({ ...principal, cote: null })}
                      />
                    ) : estGroupe(principal.conversation) ? (
                      <InfosGroupe
                        key={`infos-${principal.conversation}`}
                        groupeId={idGroupe(principal.conversation)}
                        onFermer={() => setPrincipal({ ...principal, cote: null })}
                        onMessage={ouvrirPersonne}
                        onGalerie={() => setPrincipal({ ...principal, cote: "galerie" })}
                      />
                    ) : (
                      <FicheContact
                        key={`infos-${principal.conversation}`}
                        id={autreParticipant(principal.conversation, moi.id)}
                        onFermer={() => setPrincipal({ ...principal, cote: null })}
                        onGalerie={() => setPrincipal({ ...principal, cote: "galerie" })}
                      />
                    )}
                  </PanneauCote>
                )}
              </Apparition>
            </VuePrincipale>
          )}
        </Apparition>
        <Apparition>
          {principal.type === "admin" && moi.admin && (
            <VuePrincipale key="admin">
              <Administration onFermer={() => setPrincipal(ACCUEIL)} />
            </VuePrincipale>
          )}
        </Apparition>
      </main>

      <Apparition>{theme && <DialogueTheme onFermer={() => setTheme(false)} />}</Apparition>
      <Apparition>{fond && <DialogueFond onFermer={() => setFond(false)} />}</Apparition>
      <Apparition>
        {invitationGroupe && (
          <DialogueRejoindre
            code={invitationGroupe}
            onFermer={() => {
              oublierInvitationGroupe();
              setInvitationGroupe(null);
            }}
            onRejoint={(groupe) => {
              oublierInvitationGroupe();
              setInvitationGroupe(null);
              messagerie.retenirGroupe(groupe);
              ouvrirDiscussion(conversationGroupe(groupe.id));
            }}
          />
        )}
      </Apparition>
      <Apparition>
        {deconnexion && (
          <Dialogue
            titre="Se déconnecter ?"
            confirmer="Se déconnecter"
            danger
            onConfirmer={() => void deconnecter()}
            onFermer={() => setDeconnexion(false)}
          >
            Cet appareil sera déconnecté. Ses messages restent enregistrés dans ce navigateur pour votre prochaine connexion.
          </Dialogue>
        )}
      </Apparition>
    </div>
  );
}

/**
 * Discussion ou administration : elle arrive de la droite sur téléphone,
 * comme un écran qu'on empile, et en fondu sur ordinateur où sa place est
 * déjà là. En partant, elle se pose au-dessus de l'accueil le temps de
 * s'effacer.
 */
function VuePrincipale({ children }: { children: ReactNode }) {
  const sortie = useSortie();
  return (
    <div className={clsx("flex min-w-0 flex-1", sortie ? "discussion-sortie pointer-events-none absolute inset-0 z-10" : "discussion-entree relative")}>
      {children}
    </div>
  );
}

/** Infos, recherche ou médias, à côté de la discussion (par-dessus sur téléphone). */
function PanneauCote({ cote, children }: { cote: string; children: ReactNode }) {
  const sortie = useSortie();
  // Des infos aux médias, le panneau reste ouvert : seul son contenu glisse.
  const [premier] = useState(cote);
  const [change, setChange] = useState(false);
  if (cote !== premier && !change) setChange(true);
  return (
    <aside
      className={clsx(
        "absolute inset-0 z-10 flex lg:static lg:w-[400px] lg:shrink-0 lg:border-l lg:border-bordure",
        sortie ? "cote-sortie pointer-events-none" : "cote-entree",
      )}
    >
      <div key={cote} className={clsx("flex min-w-0 flex-1", change && "vue-entree")}>
        {children}
      </div>
    </aside>
  );
}
