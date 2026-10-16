import { MUET_TOUJOURS, autreParticipant, estGroupe, idGroupe } from "@unichat/shared";
import clsx from "clsx";
import {
  Archive,
  ArchiveRestore,
  Ban,
  Bell,
  BellOff,
  CircleMinus,
  Download,
  Flag,
  Heart,
  HeartOff,
  LogOut,
  Pin,
  PinOff,
  Trash2,
} from "lucide-react";
import { useState, type ReactNode } from "react";
import { ErreurApi, api } from "../lib/api";
import { useCompte } from "../lib/compte";
import { EPINGLES_MAX, estMuette } from "../lib/messagerie";
import { useMessagerie } from "../lib/messagerie-react";
import { Case } from "./Case";
import { Apparition } from "./Apparition";
import { Dialogue } from "./Dialogue";
import { enregistrer } from "./Media";
import type { ElementMenu } from "./Menu";

type Action = "sourdine" | "bloquer" | "signaler" | "effacer" | "supprimer" | "quitter";

const HEURE = 3600_000;
const DUREES_SOURDINE = [
  { libelle: "8 heures", duree: 8 * HEURE },
  { libelle: "1 semaine", duree: 7 * 24 * HEURE },
  { libelle: "Toujours", duree: null },
] as const;

/**
 * Actions sur une discussion, partagées par le menu de la discussion, celui
 * de la liste et les fiches d'infos : mêmes libellés, mêmes confirmations,
 * comme dans WhatsApp. Le hook rend les éléments de menu et les boîtes de
 * dialogue à afficher.
 */
export function useActionsDiscussion(
  conversation: string,
  options: { onRetiree?: () => void; onAvis?: (texte: string) => void } = {},
) {
  const { messagerie, etat } = useMessagerie();
  const { sessionPerdue } = useCompte();
  const [action, setAction] = useState<Action | null>(null);
  const [enCours, setEnCours] = useState(false);
  const [coche, setCoche] = useState(true);
  const [duree, setDuree] = useState<number | null>(8 * HEURE);

  const groupe = estGroupe(conversation);
  const autre = groupe ? null : autreParticipant(conversation, messagerie.moi);
  const estSoi = autre === messagerie.moi;
  const personne = autre ? etat.personnes[autre] : undefined;
  const infosGroupe = groupe ? etat.groupes[idGroupe(conversation)] : undefined;
  const discussion = etat.conversations.find((c) => c.id === conversation);
  const nom = groupe ? (infosGroupe?.nom ?? "ce groupe") : (personne?.nom ?? "ce contact");
  const muette = discussion ? estMuette(discussion) : false;
  const favori = Boolean(discussion?.reglages?.favori);
  const archivee = Boolean(discussion?.reglages?.archive);
  const epinglee = Boolean(discussion?.reglages?.epingle);
  const bloque = Boolean(personne?.bloque);
  const membre = groupe ? infosGroupe?.moiMembre !== false : true;

  function ouvrir(a: Action) {
    setCoche(true);
    setAction(a);
  }

  async function executer(travail: () => Promise<void>, erreurParDefaut: string) {
    setEnCours(true);
    try {
      await travail();
      setAction(null);
    } catch (e) {
      if (!sessionPerdue(e)) options.onAvis?.(e instanceof ErreurApi ? e.message : erreurParDefaut);
      setAction(null);
    } finally {
      setEnCours(false);
    }
  }

  async function exporter() {
    const texte = await messagerie.exporter(conversation);
    const url = URL.createObjectURL(new Blob([texte], { type: "text/plain;charset=utf-8" }));
    enregistrer(url, `Discussion UniChat avec ${nom}.txt`);
    setTimeout(() => URL.revokeObjectURL(url), 10_000);
  }

  function epingler() {
    if (!epinglee && etat.conversations.filter((c) => c.reglages?.epingle).length >= EPINGLES_MAX) {
      options.onAvis?.(`${EPINGLES_MAX} discussions épinglées au maximum.`);
      return;
    }
    void messagerie.regler(conversation, { epingle: !epinglee });
  }

  const sourdine: ElementMenu = muette
    ? { icone: Bell, libelle: "Réactiver le son", action: () => void messagerie.regler(conversation, { muetJusqua: null }) }
    : { icone: BellOff, libelle: "Mode silencieux", action: () => ouvrir("sourdine") };
  const favoris: ElementMenu = {
    icone: favori ? HeartOff : Heart,
    libelle: favori ? "Retirer des favoris" : "Ajouter aux favoris",
    action: () => void messagerie.regler(conversation, { favori: !favori }),
  };
  const archive: ElementMenu = {
    icone: archivee ? ArchiveRestore : Archive,
    libelle: archivee ? "Désarchiver" : "Archiver",
    action: () => void messagerie.regler(conversation, { archive: !archivee, ...(archivee ? {} : { epingle: false }) }),
  };
  const epingle: ElementMenu = { icone: epinglee ? PinOff : Pin, libelle: epinglee ? "Désépingler" : "Épingler", action: epingler };
  const exporterDiscussion: ElementMenu = { icone: Download, libelle: "Exporter la discussion", action: () => void exporter() };

  const moderation: ElementMenu[] = [];
  if (!estSoi) moderation.push({ icone: Flag, libelle: groupe ? "Signaler le groupe" : "Signaler", action: () => ouvrir("signaler"), danger: true });
  if (autre && !estSoi) moderation.push({ icone: Ban, libelle: bloque ? "Débloquer" : "Bloquer", action: () => ouvrir("bloquer"), danger: !bloque });
  if (groupe && membre) moderation.push({ icone: LogOut, libelle: "Quitter le groupe", action: () => ouvrir("quitter"), danger: true });
  moderation.push({ icone: CircleMinus, libelle: "Effacer la discussion", action: () => ouvrir("effacer"), danger: true });
  // Un groupe dont on est encore membre se quitte d'abord, comme dans WhatsApp.
  if (!groupe || !membre) moderation.push({ icone: Trash2, libelle: "Supprimer la discussion", action: () => ouvrir("supprimer"), danger: true });

  let dialogue: ReactNode = null;
  const fermer = () => !enCours && setAction(null);
  if (action === "sourdine") {
    dialogue = (
      <Dialogue
        titre="Mettre la discussion en sourdine"
        confirmer="Mettre en sourdine"
        onConfirmer={() => {
          void messagerie.regler(conversation, { muetJusqua: duree === null ? MUET_TOUJOURS : Date.now() + duree });
          setAction(null);
        }}
        onFermer={fermer}
      >
        <p>Vous ne serez plus averti des nouveaux messages. Ils restent comptés dans la liste.</p>
        <div role="radiogroup" aria-label="Durée de la sourdine" className="mt-4 flex flex-col">
          {DUREES_SOURDINE.map((d) => (
            <label key={d.libelle} className="flex cursor-pointer items-center gap-4 py-2 text-[15px] text-texte">
              <input type="radio" name="sourdine" checked={duree === d.duree} onChange={() => setDuree(d.duree)} className="sr-only" />
              <span
                aria-hidden="true"
                className={clsx(
                  "flex size-5 items-center justify-center rounded-full border-2 transition-colors",
                  duree === d.duree ? "border-primaire" : "border-texte-3",
                )}
              >
                {duree === d.duree && <span className="animate-fade size-2.5 rounded-full bg-primaire" />}
              </span>
              {d.libelle}
            </label>
          ))}
        </div>
      </Dialogue>
    );
  } else if (action === "bloquer" && autre) {
    dialogue = (
      <Dialogue
        titre={bloque ? `Débloquer ${nom} ?` : `Bloquer ${nom} ?`}
        confirmer={bloque ? "Débloquer" : "Bloquer"}
        danger={!bloque}
        enCours={enCours}
        onConfirmer={() => void executer(() => messagerie.bloquer(autre, !bloque).then(() => undefined), "Le blocage a échoué.")}
        onFermer={fermer}
      >
        {bloque
          ? `${nom} pourra de nouveau vous écrire et voir votre présence, selon vos réglages.`
          : "Les contacts bloqués ne peuvent plus vous envoyer de messages, ni voir votre présence, votre photo ou vos infos. Ils n'en sont pas avertis. Les groupes en commun ne changent pas."}
      </Dialogue>
    );
  } else if (action === "signaler") {
    dialogue = (
      <Dialogue
        titre={groupe ? `Signaler « ${nom} » ?` : `Signaler ${nom} ?`}
        confirmer="Signaler"
        danger
        enCours={enCours}
        onConfirmer={() =>
          void executer(async () => {
            await messagerie.signaler(conversation, { bloquer: !groupe && coche });
            if (groupe && coche && membre) {
              await api.retirerMembre(idGroupe(conversation), messagerie.moi);
              await messagerie.chargerGroupe(idGroupe(conversation), true);
            }
            options.onAvis?.("Signalement envoyé. Merci : il sera examiné.");
          }, "Le signalement n'a pas pu être envoyé.")
        }
        onFermer={fermer}
      >
        <p>
          Les 5 derniers messages {groupe ? "des autres membres de ce groupe" : "de cette personne"} dans cette discussion
          seront transmis à UniChat pour examen. {groupe ? "Les membres" : "Elle"} n'en {groupe ? "seront" : "sera"} pas
          averti{groupe ? "s" : "e"}.
        </p>
        {(!groupe || membre) && (
          <Case coche={coche} onChange={setCoche} className="mt-4 text-[15px] text-texte">
            {groupe ? "Quitter le groupe" : `Bloquer ${nom}`}
          </Case>
        )}
      </Dialogue>
    );
  } else if (action === "quitter" && infosGroupe) {
    dialogue = (
      <Dialogue
        titre={`Quitter « ${nom} » ?`}
        confirmer="Quitter"
        danger
        enCours={enCours}
        onConfirmer={() =>
          void executer(async () => {
            await api.retirerMembre(infosGroupe.id, messagerie.moi);
            await messagerie.chargerGroupe(infosGroupe.id, true);
          }, "Impossible de quitter le groupe.")
        }
        onFermer={fermer}
      >
        Vous ne recevrez plus les messages de ce groupe. Les membres verront que vous êtes parti.
      </Dialogue>
    );
  } else if (action === "effacer") {
    dialogue = (
      <Dialogue
        titre="Effacer cette discussion ?"
        confirmer="Effacer"
        danger
        enCours={enCours}
        onConfirmer={() => void executer(() => messagerie.effacer(conversation), "L'effacement a échoué.")}
        onFermer={fermer}
      >
        Les messages sont effacés de vos appareils. La discussion reste dans la liste ; {groupe ? "les membres gardent" : `${nom} garde`} ses
        messages.
      </Dialogue>
    );
  } else if (action === "supprimer") {
    dialogue = (
      <Dialogue
        titre="Supprimer cette discussion ?"
        confirmer="Supprimer"
        danger
        enCours={enCours}
        onConfirmer={() =>
          void executer(async () => {
            await messagerie.supprimerDiscussion(conversation);
            options.onRetiree?.();
          }, "La suppression a échoué.")
        }
        onFermer={fermer}
      >
        Les messages sont effacés de vos appareils et la discussion quitte la liste. Elle reviendra au prochain message.
      </Dialogue>
    );
  }

  return {
    ouvrir,
    dialogue: <Apparition>{dialogue}</Apparition>,
    bloque,
    elements: { sourdine, favoris, archive, epingle, exporter: exporterDiscussion, moderation },
  };
}
