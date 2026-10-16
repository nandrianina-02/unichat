import { autreParticipant, conversationDirecte, conversationGroupe, estGroupe, idGroupe } from "@unichat/shared";
import clsx from "clsx";
import { MessageSquareText, Settings } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
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
import { Discussions } from "../panneaux/Discussions";
import { NouveauGroupe } from "../panneaux/NouveauGroupe";
import { NouvelleDiscussion } from "../panneaux/NouvelleDiscussion";
import { Parametres } from "../panneaux/Parametres";
import { Profil } from "../panneaux/Profil";
import { SupprimerCompte } from "../panneaux/SupprimerCompte";
import type { Vue } from "../panneaux/vues";
import { Accueil } from "../vues/Accueil";
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
    };

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

  // Un clic sur une notification ramène à la discussion concernée.
  useEffect(() => {
    messagerie.surOuverture = ouvrirDiscussion;
    return () => {
      messagerie.surOuverture = null;
    };
  }, [messagerie, ouvrirDiscussion]);

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
    <div className="flex h-full overflow-hidden bg-fond">
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
          <CouchePanneau key={e.cle} fermeture={e.fermeture} niveau={i} onFini={() => retirer(e.cle)}>
            {rendre(e.vue)}
          </CouchePanneau>
        ))}
      </aside>

      {/* Sur téléphone, la discussion ou la fiche recouvre tout l'écran. */}
      <main
        className={clsx(
          "min-w-0",
          principal.type === "accueil"
            ? "relative hidden flex-1 md:flex"
            : // Un seul positionnement par taille d'écran : « relative » et « fixed »
              // ensemble s'annulent selon l'ordre des règles CSS.
              "fixed inset-0 z-40 flex md:relative md:inset-auto md:z-auto md:flex-1",
        )}
      >
        {principal.type === "accueil" && <Accueil onAjouter={() => allerA("nouvelle")} />}
        {principal.type === "discussion" && (
          <>
            <Discussion
              key={`${principal.conversation}|${principal.cible ?? ""}`}
              conversation={principal.conversation}
              cible={principal.cible}
              onInfos={() => setPrincipal({ ...principal, cote: "infos" })}
              onRechercher={() => setPrincipal({ ...principal, cote: "recherche" })}
              onFermer={() => setPrincipal(ACCUEIL)}
              onEcrireA={ouvrirPersonne}
            />
            {principal.cote && (
              <aside className="absolute inset-0 z-10 flex lg:static lg:w-[400px] lg:shrink-0 lg:border-l lg:border-bordure">
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
              </aside>
            )}
          </>
        )}
      </main>

      {theme && <DialogueTheme onFermer={() => setTheme(false)} />}
      {fond && <DialogueFond onFermer={() => setFond(false)} />}
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
    </div>
  );
}
