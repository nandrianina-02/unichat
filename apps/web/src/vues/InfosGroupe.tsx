import { LIMITES_GROUPE, conversationGroupe, schemaNomGroupe, type Groupe, type MembreGroupe } from "@unichat/shared";
import clsx from "clsx";
import { Crown, Flag, LogOut, MessageSquareText, UserMinus, UserPlus, X } from "lucide-react";
import { useActionsDiscussion } from "../composants/ActionsDiscussion";
import { useEffect, useRef, useState } from "react";
import { Avatar, AvatarGroupe } from "../composants/Avatar";
import { ChampModifiable } from "../composants/ChampModifiable";
import { Dialogue } from "../composants/Dialogue";
import { ErreurApi, api } from "../lib/api";
import { useCompte } from "../lib/compte";
import { useMessagerie } from "../lib/messagerie-react";
import { NouveauGroupe } from "../panneaux/NouveauGroupe";

/** « Infos du groupe » : nom, description, membres et actions des administrateurs. */
export function InfosGroupe({
  groupeId,
  onFermer,
  onMessage,
}: {
  groupeId: string;
  onFermer: () => void;
  onMessage: (personneId: string) => void;
}) {
  const { messagerie, etat } = useMessagerie();
  const { sessionPerdue } = useCompte();
  const groupe = etat.groupes[groupeId];
  const [ajout, setAjout] = useState(false);
  const [quitter, setQuitter] = useState(false);
  const [retrait, setRetrait] = useState<MembreGroupe | null>(null);
  const [erreur, setErreur] = useState<string | null>(null);
  const [avis, setAvis] = useState<string | null>(null);
  const actions = useActionsDiscussion(conversationGroupe(groupeId), { onAvis: setAvis });

  useEffect(() => {
    void messagerie.chargerGroupe(groupeId, true);
  }, [messagerie, groupeId]);

  /** Exécute une action du groupe ; renvoie un message d'erreur, ou null. */
  async function agir(action: () => Promise<Groupe | void>): Promise<string | null> {
    setErreur(null);
    try {
      const resultat = await action();
      if (resultat) messagerie.retenirGroupe(resultat);
      else await messagerie.chargerGroupe(groupeId, true);
      return null;
    } catch (e) {
      if (sessionPerdue(e)) return null;
      const message = e instanceof ErreurApi ? e.message : "L'action a échoué.";
      setErreur(message);
      return message;
    }
  }

  if (ajout && groupe) {
    return (
      <section className="vue-entree relative flex h-full w-full flex-col bg-panneau">
        <NouveauGroupe
          titre="Ajouter des membres"
          exclure={groupe.membres.map((m) => m.id)}
          onRetour={() => setAjout(false)}
          onAjouter={async (ids) => {
            const probleme = await agir(() => api.ajouterMembres(groupeId, ids));
            if (!probleme) setAjout(false);
            return probleme;
          }}
        />
      </section>
    );
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
        <h2 className="text-[16px] text-texte">Infos du groupe</h2>
      </header>

      {!groupe ? (
        <p className="px-8 py-10 text-sm text-texte-2">Chargement…</p>
      ) : (
        <div className="min-h-0 flex-1 overflow-y-auto">
          <div className="animate-fade flex flex-col items-center bg-panneau px-8 pt-7 pb-2 text-center">
            <AvatarGroupe taille={140} />
            {!groupe.moiAdmin && <h3 className="mt-4 text-[24px] text-texte">{groupe.nom}</h3>}
            <p className="mt-1 text-[15px] text-texte-2">
              Groupe · {groupe.moiMembre ? `${groupe.membres.length} membre${groupe.membres.length > 1 ? "s" : ""}` : "vous n'en faites plus partie"}
            </p>
          </div>
          {groupe.moiAdmin && (
            <div className="bg-panneau">
              <ChampModifiable
                libelle="Nom du groupe"
                valeur={groupe.nom}
                maximum={LIMITES_GROUPE.nom}
                valider={(v) => {
                  const r = schemaNomGroupe.safeParse(v);
                  return r.success ? null : (r.error.issues[0]?.message ?? "Nom invalide.");
                }}
                enregistrer={(nom) => agir(() => api.majGroupe(groupeId, { nom }))}
              />
            </div>
          )}
          {(groupe.description || groupe.moiAdmin) && (
            <div className="animate-rise stagger-1 mt-2.5 bg-panneau">
              {groupe.moiAdmin ? (
                <ChampModifiable
                  libelle="Description"
                  valeur={groupe.description || ""}
                  invite="Ajouter une description"
                  maximum={LIMITES_GROUPE.description}
                  enregistrer={(description) => agir(() => api.majGroupe(groupeId, { description }))}
                />
              ) : (
                <div className="px-8 py-4">
                  <p className="text-sm text-texte-2">Description</p>
                  <p className="mt-1.5 text-[15px] break-words whitespace-pre-wrap text-texte">{groupe.description}</p>
                </div>
              )}
            </div>
          )}

          {groupe.moiMembre && (
            <div className="animate-rise stagger-2 mt-2.5 bg-panneau pb-2">
              <p className="px-8 pt-4 pb-2 text-sm text-texte-2">
                {groupe.membres.length} membre{groupe.membres.length > 1 ? "s" : ""}
              </p>
              {groupe.moiAdmin && groupe.membres.length < LIMITES_GROUPE.membres && (
                <button type="button" onClick={() => setAjout(true)} className="flex w-full items-center gap-4 px-6 text-left hover:bg-survol">
                  <span className="flex size-10 shrink-0 items-center justify-center rounded-full bg-primaire text-sur-primaire">
                    <UserPlus size={19} />
                  </span>
                  <span className="flex-1 py-3 text-[16px] text-texte">Ajouter des membres</span>
                </button>
              )}
              {groupe.membres.map((m) => (
                <LigneMembre
                  key={m.id}
                  membre={m}
                  moiAdmin={groupe.moiAdmin}
                  onMessage={() => onMessage(m.id)}
                  onAdmin={() => void agir(() => api.nommerAdmin(groupeId, m.id))}
                  onRetirer={() => setRetrait(m)}
                />
              ))}
            </div>
          )}

          {erreur && <p className="animate-fade px-8 py-3 text-sm text-danger">{erreur}</p>}

          <div className="animate-rise stagger-3 mt-2.5 mb-6 bg-panneau">
            {groupe.moiMembre && (
              <button
                type="button"
                onClick={() => setQuitter(true)}
                className="flex w-full items-center gap-6 px-8 py-4 text-left text-[16px] text-danger transition-colors hover:bg-survol"
              >
                <LogOut size={22} /> Quitter le groupe
              </button>
            )}
            <button
              type="button"
              onClick={() => actions.ouvrir("signaler")}
              className="flex w-full items-center gap-6 px-8 py-4 text-left text-[16px] text-danger transition-colors hover:bg-survol"
            >
              <Flag size={22} /> Signaler le groupe
            </button>
          </div>
          {avis && <p role="status" className="animate-fade px-8 pb-6 text-sm text-texte-2">{avis}</p>}
        </div>
      )}

      {quitter && groupe && (
        <Dialogue
          titre={`Quitter « ${groupe.nom} » ?`}
          confirmer="Quitter"
          danger
          onConfirmer={() => {
            setQuitter(false);
            void agir(() => api.retirerMembre(groupeId, messagerie.moi));
          }}
          onFermer={() => setQuitter(false)}
        >
          Les membres verront que vous êtes parti. Vous garderez l'historique déjà reçu, sans pouvoir y écrire.
        </Dialogue>
      )}
      {retrait && groupe && (
        <Dialogue
          titre={`Retirer ${retrait.nom} du groupe ?`}
          confirmer="Retirer"
          danger
          onConfirmer={() => {
            const cible = retrait;
            setRetrait(null);
            void agir(() => api.retirerMembre(groupeId, cible.id));
          }}
          onFermer={() => setRetrait(null)}
        />
      )}
    </section>
  );
}

function LigneMembre({
  membre: m,
  moiAdmin,
  onMessage,
  onAdmin,
  onRetirer,
}: {
  membre: MembreGroupe;
  moiAdmin: boolean;
  onMessage: () => void;
  onAdmin: () => void;
  onRetirer: () => void;
}) {
  const [menu, setMenu] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!menu) return;
    const fermer = (e: MouseEvent) => !ref.current?.contains(e.target as Node) && setMenu(false);
    document.addEventListener("mousedown", fermer);
    return () => document.removeEventListener("mousedown", fermer);
  }, [menu]);

  const actions = [
    { icone: MessageSquareText, libelle: `Écrire à ${m.nom}`, action: onMessage, danger: false },
    ...(moiAdmin && m.role !== "admin" ? [{ icone: Crown, libelle: "Nommer administrateur", action: onAdmin, danger: false }] : []),
    ...(moiAdmin ? [{ icone: UserMinus, libelle: "Retirer du groupe", action: onRetirer, danger: true }] : []),
  ];

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        disabled={m.estSoi}
        onClick={() => setMenu((x) => !x)}
        className="flex w-full items-center gap-4 px-6 text-left transition-colors enabled:hover:bg-survol"
      >
        <Avatar id={m.id} photo={m.photo} nom={m.nom} taille={40} />
        <span className="min-w-0 flex-1 py-3">
          <span className="block truncate text-[16px] text-texte">{m.estSoi ? "Vous" : m.nom}</span>
          {m.pseudo && <span className="block truncate text-[13px] text-texte-2">@{m.pseudo}</span>}
        </span>
        {m.role === "admin" && (
          <span className="shrink-0 rounded-md bg-primaire-doux px-2 py-0.5 text-[12px] text-primaire-texte">Admin</span>
        )}
      </button>
      {menu && (
        <div role="menu" className="animate-pop absolute top-full right-6 z-30 w-60 rounded-lg bg-panneau py-2 shadow-xl ring-1 ring-bordure">
          {actions.map(({ icone: Icone, libelle, action, danger }) => (
            <button
              key={libelle}
              role="menuitem"
              type="button"
              onClick={() => {
                setMenu(false);
                action();
              }}
              className={clsx("flex w-full items-center gap-3 px-5 py-2.5 text-left text-sm hover:bg-survol", danger ? "text-danger" : "text-texte")}
            >
              <Icone size={18} className={danger ? "text-danger" : "text-texte-2"} /> {libelle}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
