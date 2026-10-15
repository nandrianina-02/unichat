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
import { Activite } from "../panneaux/Activite";
import { Appareils } from "../panneaux/Appareils";
import { Compte } from "../panneaux/Compte";
import { ChoixVisibilite, Confidentialite } from "../panneaux/Confidentialite";
import { Discussions } from "../panneaux/Discussions";
import { NouvelleDiscussion } from "../panneaux/NouvelleDiscussion";
import { Parametres } from "../panneaux/Parametres";
import { Profil } from "../panneaux/Profil";
import type { Vue } from "../panneaux/vues";
import { Accueil } from "../vues/Accueil";
import { FicheContact } from "../vues/FicheContact";

/**
 * L'application connectée, organisée comme les messageries de bureau : une
 * barre d'icônes, la colonne des discussions (où s'empilent les panneaux),
 * et la zone principale.
 */
export function Application() {
  const moi = useMoi();
  const { deconnecter } = useCompte();
  const { pile, ouvrir, retour, toutFermer, retirer } = usePile<Vue>();
  const [fiche, setFiche] = useState<string | null>(null);
  const [theme, setTheme] = useState(false);
  const [deconnexion, setDeconnexion] = useState(false);
  const [invitation] = useState(invitationEnAttente);

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
        return <NouvelleDiscussion onRetour={retour} onFiche={setFiche} invitation={invitation} />;
      case "parametres":
        return (
          <Parametres onRetour={retour} onOuvrir={ouvrir} onTheme={() => setTheme(true)} onDeconnexion={() => setDeconnexion(true)} />
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
    }
  }

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
          fiche={fiche}
          onFiche={setFiche}
          onNouvelle={() => allerA("nouvelle")}
          onParametres={() => allerA("parametres")}
          onDeconnexion={() => setDeconnexion(true)}
        />
        {pile.map((e, i) => (
          <CouchePanneau key={e.cle} fermeture={e.fermeture} niveau={i} onFini={() => retirer(e.cle)}>
            {rendre(e.vue)}
          </CouchePanneau>
        ))}
      </aside>

      {/* Sur téléphone, la fiche recouvre tout l'écran ; sur ordinateur, elle occupe la zone principale. */}
      <main className={clsx("min-w-0 flex-1", fiche ? "fixed inset-0 z-40 flex md:static md:z-auto" : "hidden md:flex")}>
        {fiche ? <FicheContact key={fiche} id={fiche} onFermer={() => setFiche(null)} /> : <Accueil onAjouter={() => allerA("nouvelle")} />}
      </main>

      {theme && <DialogueTheme onFermer={() => setTheme(false)} />}
      {deconnexion && (
        <Dialogue
          titre="Se déconnecter ?"
          confirmer="Se déconnecter"
          danger
          onConfirmer={() => void deconnecter()}
          onFermer={() => setDeconnexion(false)}
        >
          Cet appareil sera déconnecté. Vous pourrez vous reconnecter avec Google.
        </Dialogue>
      )}
    </div>
  );
}
