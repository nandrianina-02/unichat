import { conversationDirecte, type CarteProfil } from "@unichat/shared";
import { Ban, Flag, LoaderCircle, MessageSquareText, UserMinus, UserPlus, X } from "lucide-react";
import { useEffect, useState } from "react";
import { useActionsDiscussion } from "../composants/ActionsDiscussion";
import { Avatar } from "../composants/Avatar";
import { Dialogue } from "../composants/Dialogue";
import { contactsModifies } from "../composants/Lignes";
import { ErreurApi, api } from "../lib/api";
import { useCompte } from "../lib/compte";
import { useMessagerie } from "../lib/messagerie-react";

/**
 * « Infos du contact ». Ouverte depuis une discussion, elle se place à côté ;
 * sinon elle propose d'écrire à la personne.
 */
export function FicheContact({
  id,
  onFermer,
  onMessage,
}: {
  id: string;
  onFermer: () => void;
  onMessage?: (id: string) => void;
}) {
  const { sessionPerdue } = useCompte();
  const { messagerie, etat } = useMessagerie();
  const [avis, setAvis] = useState<string | null>(null);
  const actions = useActionsDiscussion(conversationDirecte(messagerie.moi, id), { onAvis: setAvis });
  const [carte, setCarte] = useState<CarteProfil | null>(null);
  const [erreur, setErreur] = useState<string | null>(null);
  const [enCours, setEnCours] = useState(false);
  const [retrait, setRetrait] = useState(false);

  useEffect(() => {
    setCarte(null);
    setErreur(null);
    api
      .personne(id)
      .then((c) => {
        setCarte(c);
        messagerie.retenirPersonne(c);
      })
      .catch((e) => !sessionPerdue(e) && setErreur(e instanceof ErreurApi ? e.message : "Profil indisponible."));
  }, [id, sessionPerdue, messagerie]);

  async function basculer() {
    if (!carte) return;
    setEnCours(true);
    try {
      if (carte.estContact) {
        await api.retirerContact(carte.id);
        const retiree = { ...carte, estContact: false };
        setCarte(retiree);
        messagerie.retenirPersonne(retiree);
        setRetrait(false);
      } else {
        const ajoutee = await api.ajouterContact(carte.id);
        setCarte(ajoutee);
        messagerie.retenirPersonne(ajoutee);
      }
      contactsModifies();
    } catch (e) {
      if (!sessionPerdue(e)) setErreur(e instanceof ErreurApi ? e.message : "L'action a échoué.");
    } finally {
      setEnCours(false);
    }
  }

  return (
    <section className="vue-entree flex h-full w-full flex-col bg-fond">
      <header className="flex h-[60px] shrink-0 items-center gap-6 bg-entete px-5">
        <button
          type="button"
          onClick={onFermer}
          aria-label="Fermer"
          title="Fermer"
          className="inline-flex size-10 items-center justify-center rounded-full text-texte-2 hover:bg-survol"
        >
          <X size={22} />
        </button>
        <h2 className="text-[16px] text-texte">Infos du contact</h2>
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto">
        {erreur && <p className="px-8 py-6 text-sm text-danger">{erreur}</p>}
        {!carte && !erreur && (
          <p className="flex items-center justify-center gap-3 py-16 text-sm text-texte-2">
            <LoaderCircle size={18} className="animate-spin" /> Chargement…
          </p>
        )}
        {carte && (
          <>
            <div className="animate-fade flex flex-col items-center bg-panneau px-8 pt-7 pb-6 text-center">
              <Avatar id={carte.id} photo={carte.photo} nom={carte.nom} taille={200} />
              <h3 className="mt-4 text-[24px] text-texte">{carte.nom}</h3>
              {carte.pseudo && <p className="mt-1 text-[16px] text-texte-2">@{carte.pseudo}</p>}
            </div>
            {carte.infos && (
              <div className="animate-rise stagger-1 mt-2.5 bg-panneau px-8 py-4">
                <p className="text-sm text-texte-2">Infos</p>
                <p className="mt-1.5 text-[16px] break-words text-texte">{carte.infos}</p>
              </div>
            )}
            {onMessage && (
              <div className="animate-rise stagger-1 mt-2.5 bg-panneau">
                <button
                  type="button"
                  onClick={() => onMessage(carte.id)}
                  className="flex w-full items-center gap-6 px-8 py-4 text-left text-[16px] text-primaire transition-colors hover:bg-survol"
                >
                  <MessageSquareText size={22} /> Envoyer un message
                </button>
              </div>
            )}
            {!carte.estSoi && (
              <div className="animate-rise stagger-2 mt-2.5 bg-panneau">
                <button
                  type="button"
                  disabled={enCours}
                  onClick={() => (carte.estContact ? setRetrait(true) : void basculer())}
                  className={`flex w-full items-center gap-6 px-8 py-4 text-left text-[16px] transition-colors hover:bg-survol disabled:opacity-60 ${carte.estContact ? "text-danger" : "text-primaire"}`}
                >
                  {enCours ? <LoaderCircle size={22} className="animate-spin" /> : carte.estContact ? <UserMinus size={22} /> : <UserPlus size={22} />}
                  {carte.estContact ? "Retirer des contacts" : "Ajouter aux contacts"}
                </button>
              </div>
            )}
            {!carte.estSoi && (
              <div className="animate-rise stagger-3 mt-2.5 mb-6 bg-panneau">
                {/* L'état suit la messagerie : un blocage fait ailleurs se voit ici aussitôt. */}
                {(etat.personnes[carte.id]?.bloque ?? carte.bloque) ? (
                  <button
                    type="button"
                    onClick={() => actions.ouvrir("bloquer")}
                    className="flex w-full items-center gap-6 px-8 py-4 text-left text-[16px] text-primaire transition-colors hover:bg-survol"
                  >
                    <Ban size={22} /> Débloquer {carte.nom}
                  </button>
                ) : (
                  <button
                    type="button"
                    onClick={() => actions.ouvrir("bloquer")}
                    className="flex w-full items-center gap-6 px-8 py-4 text-left text-[16px] text-danger transition-colors hover:bg-survol"
                  >
                    <Ban size={22} /> Bloquer {carte.nom}
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => actions.ouvrir("signaler")}
                  className="flex w-full items-center gap-6 px-8 py-4 text-left text-[16px] text-danger transition-colors hover:bg-survol"
                >
                  <Flag size={22} /> Signaler {carte.nom}
                </button>
              </div>
            )}
            {avis && <p role="status" className="animate-fade px-8 pb-6 text-sm text-texte-2">{avis}</p>}
          </>
        )}
      </div>
      {actions.dialogue}

      {retrait && carte && (
        <Dialogue
          titre={`Retirer ${carte.nom} de vos contacts ?`}
          confirmer="Retirer"
          danger
          enCours={enCours}
          onConfirmer={() => void basculer()}
          onFermer={() => setRetrait(false)}
        >
          {carte.nom} ne sera pas prévenu. Si vos réglages réservent votre photo ou vos infos à vos contacts, il ne les verra
          plus.
        </Dialogue>
      )}
    </section>
  );
}
