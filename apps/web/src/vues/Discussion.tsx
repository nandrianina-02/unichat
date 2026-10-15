import {
  DELAI_SUPPRESSION,
  LIMITE_TEXTE,
  autreParticipant,
  estGroupe,
  idGroupe,
  type CarteProfil,
  type Reaction,
} from "@unichat/shared";
import clsx from "clsx";
import {
  ArrowLeft,
  Ban,
  ChevronDown,
  Copy,
  EllipsisVertical,
  Info,
  LoaderCircle,
  Reply,
  RotateCw,
  SendHorizontal,
  Trash2,
  UserPlus,
  X,
} from "lucide-react";
import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { Avatar, AvatarGroupe } from "../composants/Avatar";
import { BoutonIcone } from "../composants/BoutonIcone";
import { Coches } from "../composants/Coches";
import { contactsModifies } from "../composants/Lignes";
import { ChoixReaction, IconeReaction, REACTIONS_AFFICHEES } from "../composants/Reactions";
import { ErreurApi, api } from "../lib/api";
import { useCompte, useMoi } from "../lib/compte";
import { heureCourte, jourMessage, texteEvenement, vuLe } from "../lib/format";
import { useMessagerie, useMessages } from "../lib/messagerie-react";
import type { MessageLocal } from "../lib/stockage";

// Brouillons gardés le temps de la visite, par discussion, comme dans les messageries de référence.
const brouillons = new Map<string, string>();

interface Props {
  conversation: string;
  onInfos: () => void;
  onFermer: () => void;
}

export function Discussion({ conversation, onInfos, onFermer }: Props) {
  const moi = useMoi();
  const { messagerie, etat } = useMessagerie();
  const messages = useMessages(conversation);
  const groupe = estGroupe(conversation) ? etat.groupes[idGroupe(conversation)] : undefined;
  const enGroupe = estGroupe(conversation);
  const autre = enGroupe ? null : autreParticipant(conversation, moi.id);
  const estSoi = autre === moi.id;
  const personne: CarteProfil | undefined = estSoi
    ? { id: moi.id, nom: moi.nom, pseudo: moi.pseudo, infos: moi.infos, photo: moi.photo, estContact: false, estSoi: true }
    : autre
      ? etat.personnes[autre]
      : undefined;
  const quitte = enGroupe && groupe !== undefined && !groupe.moiMembre;

  const [reponse, setReponse] = useState<MessageLocal | null>(null);
  const [aSupprimer, setASupprimer] = useState<MessageLocal | null>(null);
  const [avis, setAvis] = useState<string | null>(null);

  useEffect(() => {
    if (!avis) return;
    const minuterie = setTimeout(() => setAvis(null), 3000);
    return () => clearTimeout(minuterie);
  }, [avis]);

  // Présence (discussion à deux) : demandée à l'ouverture, puis toutes les 30 secondes.
  useEffect(() => {
    messagerie.ouvrir(conversation);
    if (autre && !estSoi) void messagerie.chargerPersonne(autre);
    if (enGroupe) void messagerie.chargerGroupe(idGroupe(conversation));
    const minuterie = autre && !estSoi ? setInterval(() => messagerie.demanderPresence(autre), 30_000) : null;
    return () => {
      if (minuterie) clearInterval(minuterie);
      messagerie.ouvrir(null);
    };
  }, [messagerie, conversation, autre, estSoi, enGroupe]);

  // Ce qui s'affiche sous les yeux est lu ; pas quand l'onglet est en arrière-plan.
  useEffect(() => {
    if (!messages) return;
    const marquer = () => !document.hidden && void messagerie.marquerLu(conversation);
    marquer();
    document.addEventListener("visibilitychange", marquer);
    return () => document.removeEventListener("visibilitychange", marquer);
  }, [messages, messagerie, conversation]);

  const nom = (id: string) => messagerie.nom(id, conversation);
  const indication = etat.ecrit[conversation];
  const ecrit = indication && indication.fin > Date.now() ? indication.de : null;
  let statut: string;
  if (enGroupe) {
    if (ecrit) statut = `${nom(ecrit)} écrit…`;
    else if (quitte) statut = "Vous ne faites plus partie de ce groupe";
    else {
      const autres = (groupe?.membres ?? []).filter((m) => !m.estSoi).map((m) => m.nom);
      statut = groupe ? [...autres, "Vous"].join(", ") : "";
    }
  } else if (estSoi) statut = "Envoyez-vous des messages";
  else {
    const presence = autre ? etat.presences[autre] : undefined;
    statut = ecrit ? "écrit…" : presence?.enLigne ? "en ligne" : presence?.vuLe ? vuLe(presence.vuLe) : "";
  }
  const titre = enGroupe ? (groupe?.nom ?? "Groupe") : personne ? (estSoi ? `${personne.nom} (vous)` : personne.nom) : "";

  async function reagir(message: MessageLocal, code: Reaction | null) {
    if (!(await messagerie.reagir(message, code))) setAvis("Hors connexion : la réaction n'a pas pu être envoyée.");
  }

  return (
    <section className="flex h-full min-w-0 flex-1 flex-col bg-discussion">
      <EnTete
        avatar={enGroupe ? <AvatarGroupe taille={40} /> : <Avatar id={autre!} photo={personne?.photo ?? null} nom={titre || "Contact"} taille={40} />}
        titre={titre}
        statut={statut}
        ecrit={Boolean(ecrit)}
        libelleInfos={enGroupe ? "Infos du groupe" : "Infos du contact"}
        onInfos={onInfos}
        onFermer={onFermer}
      />
      {personne && !personne.estContact && !estSoi && <BanniereInconnu personne={personne} />}
      <ListeMessages
        messages={messages}
        moiId={moi.id}
        enGroupe={enGroupe}
        nom={nom}
        onRepondre={(m) => setReponse(m)}
        onReagir={(m, code) => void reagir(m, code)}
        onSupprimer={(m) => setASupprimer(m)}
        onCopier={(m) => {
          void navigator.clipboard.writeText(m.texte).then(
            () => setAvis("Message copié."),
            () => setAvis("La copie a été refusée par le navigateur."),
          );
        }}
        onRenvoyer={(id) => void messagerie.renvoyer(id)}
      />
      {avis && (
        <p role="status" className="animate-fade shrink-0 bg-entete px-4 pt-2 text-center text-[13px] text-texte-2">
          {avis}
        </p>
      )}
      {quitte ? (
        <footer className="shrink-0 bg-entete px-4 py-4 text-center text-sm text-texte-2">
          Vous ne pouvez plus envoyer de messages dans ce groupe.
        </footer>
      ) : (
        <Composeur
          conversation={conversation}
          reponse={reponse}
          nom={nom}
          onAnnulerReponse={() => setReponse(null)}
          onEnvoyer={(texte) => {
            void messagerie.envoyer(conversation, texte, reponse ?? undefined);
            setReponse(null);
          }}
          onEcrit={() => !estSoi && messagerie.signalerEcriture(conversation)}
        />
      )}
      {aSupprimer && (
        <DialogueSuppression
          message={aSupprimer}
          mien={aSupprimer.de === moi.id}
          onPourTous={async () => {
            if (!(await messagerie.supprimerPourTous(aSupprimer))) setAvis("Hors connexion : réessayez une fois reconnecté.");
            setASupprimer(null);
          }}
          onPourMoi={async () => {
            await messagerie.supprimerPourMoi(aSupprimer);
            setASupprimer(null);
          }}
          onFermer={() => setASupprimer(null)}
        />
      )}
    </section>
  );
}

function EnTete({
  avatar,
  titre,
  statut,
  ecrit,
  libelleInfos,
  onInfos,
  onFermer,
}: {
  avatar: ReactNode;
  titre: string;
  statut: string;
  ecrit: boolean;
  libelleInfos: string;
  onInfos: () => void;
  onFermer: () => void;
}) {
  const [menu, setMenu] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  useFermetureExterieure(menu, menuRef, () => setMenu(false));

  return (
    <header className="flex h-[60px] shrink-0 items-center gap-2 bg-entete pr-3 pl-2 md:pl-4">
      <BoutonIcone libelle="Retour" onClick={onFermer} className="md:hidden">
        <ArrowLeft size={22} />
      </BoutonIcone>
      <button type="button" onClick={onInfos} className="flex min-w-0 flex-1 items-center gap-3 rounded-lg py-1 text-left" title={libelleInfos}>
        {avatar}
        <span className="min-w-0">
          <span className="block truncate text-[16px] text-texte">{titre || "…"}</span>
          {statut && (
            <span key={statut} className={clsx("animate-fade block truncate text-[13px]", ecrit ? "text-primaire" : "text-texte-2")}>
              {statut}
            </span>
          )}
        </span>
      </button>
      <div ref={menuRef} className="relative">
        <BoutonIcone libelle="Menu" actif={menu} onClick={() => setMenu((m) => !m)} aria-haspopup="menu" aria-expanded={menu}>
          <EllipsisVertical size={22} />
        </BoutonIcone>
        {menu && (
          <Menu
            className="right-0 top-11"
            elements={[
              { icone: Info, libelle: libelleInfos, action: onInfos },
              { icone: X, libelle: "Fermer la discussion", action: onFermer },
            ]}
            onChoix={() => setMenu(false)}
          />
        )}
      </div>
    </header>
  );
}

function Menu({
  elements,
  onChoix,
  className,
  entete,
}: {
  elements: { icone: typeof Info; libelle: string; action: () => void; danger?: boolean }[];
  onChoix: () => void;
  className?: string;
  entete?: ReactNode;
}) {
  return (
    <div role="menu" className={clsx("animate-pop absolute z-30 w-60 rounded-lg bg-panneau py-2 shadow-xl ring-1 ring-bordure", className)}>
      {entete && <div className="border-b border-bordure px-2.5 pb-2">{entete}</div>}
      {elements.map(({ icone: Icone, libelle, action, danger }) => (
        <button
          key={libelle}
          role="menuitem"
          type="button"
          onClick={() => {
            onChoix();
            action();
          }}
          className={clsx("flex w-full items-center gap-3 px-5 py-2.5 text-left text-sm hover:bg-survol", danger ? "text-danger" : "text-texte")}
        >
          <Icone size={18} className={danger ? "text-danger" : "text-texte-2"} /> {libelle}
        </button>
      ))}
    </div>
  );
}

function useFermetureExterieure(ouvert: boolean, ref: React.RefObject<HTMLElement | null>, fermer: () => void) {
  useEffect(() => {
    if (!ouvert) return;
    const surClic = (e: MouseEvent) => !ref.current?.contains(e.target as Node) && fermer();
    const surTouche = (e: KeyboardEvent) => e.key === "Escape" && fermer();
    document.addEventListener("mousedown", surClic);
    document.addEventListener("keydown", surTouche);
    return () => {
      document.removeEventListener("mousedown", surClic);
      document.removeEventListener("keydown", surTouche);
    };
  }, [ouvert, ref, fermer]);
}

/** Message d'une personne absente des contacts : on propose de l'ajouter, comme dans les messageries de référence. */
function BanniereInconnu({ personne }: { personne: CarteProfil }) {
  const { messagerie } = useMessagerie();
  const { sessionPerdue } = useCompte();
  const [enCours, setEnCours] = useState(false);
  const [erreur, setErreur] = useState<string | null>(null);
  async function ajouter() {
    setEnCours(true);
    try {
      messagerie.retenirPersonne(await api.ajouterContact(personne.id));
      contactsModifies();
    } catch (e) {
      if (!sessionPerdue(e)) setErreur(e instanceof ErreurApi ? e.message : "Ajout impossible.");
    } finally {
      setEnCours(false);
    }
  }
  return (
    <div className="animate-fade flex shrink-0 flex-wrap items-center justify-center gap-x-4 gap-y-2 border-b border-bordure bg-panneau px-4 py-2.5 text-sm">
      <span className="text-texte-2">{personne.nom} n'est pas dans vos contacts.</span>
      <button
        type="button"
        onClick={() => void ajouter()}
        disabled={enCours}
        className="inline-flex items-center gap-1.5 font-medium text-primaire hover:underline disabled:opacity-60"
      >
        {enCours ? <LoaderCircle size={15} className="animate-spin" /> : <UserPlus size={15} />} Ajouter aux contacts
      </button>
      {erreur && <span className="text-danger">{erreur}</span>}
    </div>
  );
}

interface ActionsMessage {
  onRepondre: (m: MessageLocal) => void;
  onReagir: (m: MessageLocal, code: Reaction | null) => void;
  onSupprimer: (m: MessageLocal) => void;
  onCopier: (m: MessageLocal) => void;
  onRenvoyer: (id: string) => void;
}

function ListeMessages({
  messages,
  moiId,
  enGroupe,
  nom,
  ...actions
}: {
  messages: MessageLocal[] | null;
  moiId: string;
  enGroupe: boolean;
  nom: (id: string) => string;
} & ActionsMessage) {
  const zone = useRef<HTMLDivElement>(null);
  const separateur = useRef<HTMLDivElement>(null);
  const enBas = useRef(true);
  const initialise = useRef(false);
  const [boutonBas, setBoutonBas] = useState(false);
  // Le premier message non lu est relevé à l'ouverture : le repère reste en
  // place même une fois les messages marqués comme lus.
  const repere = useRef<{ id: string; nombre: number } | null | undefined>(undefined);
  if (messages && repere.current === undefined) {
    const nonLus = messages.filter((m) => m.de !== moiId && !m.lu && m.type !== "evenement");
    repere.current = nonLus[0] ? { id: nonLus[0].id, nombre: nonLus.length } : null;
  }

  useLayoutEffect(() => {
    const z = zone.current;
    if (!z || !messages) return;
    if (!initialise.current) {
      initialise.current = true;
      if (separateur.current) separateur.current.scrollIntoView({ block: "center" });
      else z.scrollTop = z.scrollHeight;
      return;
    }
    const dernier = messages[messages.length - 1];
    // On suit la conversation si on était en bas, ou si c'est moi qui viens d'écrire.
    if (enBas.current || (dernier?.de === moiId && dernier.etat === "attente")) z.scrollTop = z.scrollHeight;
  }, [messages, moiId]);

  function surDefilement() {
    const z = zone.current;
    if (!z) return;
    const distance = z.scrollHeight - z.scrollTop - z.clientHeight;
    enBas.current = distance < 80;
    setBoutonBas(distance > 300);
  }

  function allerAuMessage(id: string) {
    const cible = document.getElementById(`message-${id}`);
    if (!cible) return;
    cible.scrollIntoView({ block: "center", behavior: "smooth" });
    cible.classList.remove("surbrillance");
    // Relancer l'animation même si on clique deux fois de suite.
    void cible.offsetWidth;
    cible.classList.add("surbrillance");
  }

  const elements: ReactNode[] = [];
  let jourPrecedent = "";
  let precedent: MessageLocal | null = null;
  for (const m of messages ?? []) {
    const jour = jourMessage(m.le);
    if (jour !== jourPrecedent) {
      elements.push(
        <div key={`jour-${m.id}`} className="my-3 flex justify-center">
          <span className="rounded-lg bg-panneau px-3 py-1.5 text-[12.5px] uppercase text-texte-2 shadow-sm">{jour}</span>
        </div>,
      );
      jourPrecedent = jour;
      precedent = null;
    }
    if (repere.current?.id === m.id) {
      elements.push(
        <div key="non-lus" ref={separateur} className="my-3 bg-panneau/70 py-1.5 text-center text-[12.5px] uppercase text-primaire-texte">
          {repere.current.nombre} message{repere.current.nombre > 1 ? "s" : ""} non lu{repere.current.nombre > 1 ? "s" : ""}
        </div>,
      );
      precedent = null;
    }
    if (m.type === "evenement" && m.evenement) {
      elements.push(
        <div key={m.id} className="my-2 flex justify-center px-6">
          <span className="max-w-md rounded-lg bg-panneau/90 px-3 py-1.5 text-center text-[12.5px] text-texte-2 shadow-sm">
            {texteEvenement(m.evenement, nom)}
          </span>
        </div>,
      );
      precedent = null;
      continue;
    }
    const premier = !precedent || precedent.de !== m.de;
    elements.push(
      <Bulle
        key={m.id}
        message={m}
        mien={m.de === moiId}
        moiId={moiId}
        premier={premier}
        auteur={enGroupe && premier && m.de !== moiId ? nom(m.de) : null}
        nom={nom}
        onAllerA={allerAuMessage}
        {...actions}
      />,
    );
    precedent = m;
  }

  return (
    <div className="relative min-h-0 flex-1">
      <div ref={zone} onScroll={surDefilement} className="papier-peint h-full overflow-y-auto pb-3">
        <div className="flex justify-center px-6 pt-4 pb-2">
          <p className="max-w-md rounded-lg bg-panneau/90 px-3 py-2 text-center text-[12.5px] leading-relaxed text-texte-2 shadow-sm">
            Les messages sont gardés sur vos appareils. UniChat ne les conserve que le temps de les remettre.
          </p>
        </div>
        {messages === null ? (
          <p className="flex justify-center py-10 text-texte-2">
            <LoaderCircle size={20} className="animate-spin" />
          </p>
        ) : (
          elements
        )}
      </div>
      {boutonBas && (
        <button
          type="button"
          aria-label="Aller aux derniers messages"
          title="Aller aux derniers messages"
          onClick={() => zone.current?.scrollTo({ top: zone.current.scrollHeight, behavior: "smooth" })}
          className="animate-pop absolute right-5 bottom-4 flex size-11 items-center justify-center rounded-full bg-panneau text-texte-2 shadow-lg ring-1 ring-bordure hover:text-texte"
        >
          <ChevronDown size={22} />
        </button>
      )}
    </div>
  );
}

function Queue({ mien }: { mien: boolean }) {
  return mien ? (
    <svg viewBox="0 0 8 13" width="8" height="13" aria-hidden="true" className="absolute top-0 -right-2 text-bulle-envoyee">
      <path fill="currentColor" d="M0 0h6.2c1.2 0 1.8 1.4 1 2.3L0 11.7V0z" />
    </svg>
  ) : (
    <svg viewBox="0 0 8 13" width="8" height="13" aria-hidden="true" className="absolute top-0 -left-2 text-bulle-recue">
      <path fill="currentColor" d="M8 0H1.8C.6 0 0 1.4.8 2.3L8 11.7V0z" />
    </svg>
  );
}

function Bulle({
  message: m,
  mien,
  moiId,
  premier,
  auteur,
  nom,
  onAllerA,
  onRepondre,
  onReagir,
  onSupprimer,
  onCopier,
  onRenvoyer,
}: {
  message: MessageLocal;
  mien: boolean;
  moiId: string;
  premier: boolean;
  auteur: string | null;
  nom: (id: string) => string;
  onAllerA: (id: string) => void;
} & ActionsMessage) {
  const [menu, setMenu] = useState<"bas" | "haut" | null>(null);
  const cadre = useRef<HTMLDivElement>(null);
  useFermetureExterieure(menu !== null, cadre, () => setMenu(null));
  const reactions = Object.entries(m.reactions ?? {});
  const maReaction = m.reactions?.[moiId];

  function ouvrirMenu() {
    const r = cadre.current?.getBoundingClientRect();
    // Près du bas de l'écran, le menu s'ouvre vers le haut.
    setMenu(r && r.bottom > window.innerHeight - 300 ? "haut" : "bas");
  }

  const elements = m.supprime
    ? []
    : [
        { icone: Reply, libelle: "Répondre", action: () => onRepondre(m) },
        { icone: Copy, libelle: "Copier", action: () => onCopier(m) },
      ];

  return (
    <div
      id={`message-${m.id}`}
      className={clsx("flex flex-col rounded-lg px-[5%] md:px-[7%]", mien ? "items-end" : "items-start", premier ? "mt-2.5" : "mt-0.5")}
    >
      <div ref={cadre} className="group relative max-w-[min(85%,560px)] md:max-w-[min(65%,560px)]">
        <div
          className={clsx(
            "relative rounded-lg px-2.5 pt-1.5 pb-2 text-[14.5px] leading-[19px] text-texte shadow-sm",
            mien ? "bg-bulle-envoyee" : "bg-bulle-recue",
            premier && (mien ? "rounded-tr-none" : "rounded-tl-none"),
          )}
        >
          {premier && <Queue mien={mien} />}
          {auteur && <span className="mb-0.5 block text-[13px] font-medium text-primaire-texte">{auteur}</span>}
          {m.reponseA && !m.supprime && (
            <button
              type="button"
              onClick={() => onAllerA(m.reponseA!.id)}
              className="mb-1.5 block w-full min-w-[160px] rounded-md border-l-4 border-primaire bg-texte/5 px-2.5 py-1.5 text-left"
            >
              <span className="block text-[12.5px] font-medium text-primaire-texte">{nom(m.reponseA.de)}</span>
              <span className="line-clamp-2 text-[13px] text-texte-2">{m.reponseA.extrait}</span>
            </button>
          )}
          {m.supprime ? (
            <span className="inline-flex items-center gap-1.5 italic text-texte-2">
              <Ban size={14} /> {mien ? "Vous avez supprimé ce message" : "Ce message a été supprimé"}
            </span>
          ) : (
            <span className="whitespace-pre-wrap [overflow-wrap:anywhere]">{m.texte}</span>
          )}
          {/* Réserve la place de l'heure sur la dernière ligne, qui s'y loge en bas à droite. */}
          <span aria-hidden="true" className={clsx("inline-block", mien ? "w-[68px]" : "w-[42px]")} />
          <span className="absolute right-2 bottom-1 flex items-center gap-1 text-[11px] text-texte-2">
            {heureCourte(m.le)}
            {mien && !m.supprime && <Coches etat={m.etat} />}
          </span>
          {/* Ouverture du menu : visible au survol, comme sur ordinateur dans les messageries de référence. */}
          <button
            type="button"
            aria-label="Actions sur le message"
            title="Actions"
            onClick={ouvrirMenu}
            className={clsx(
              "absolute top-1 right-1 flex size-6 items-center justify-center rounded-full text-texte-2 opacity-0 transition-opacity group-hover:opacity-100 focus-visible:opacity-100",
              mien ? "bg-bulle-envoyee" : "bg-bulle-recue",
              menu && "opacity-100",
            )}
          >
            <ChevronDown size={18} />
          </button>
        </div>
        {menu && (
          <Menu
            className={clsx(mien ? "right-0" : "left-0", menu === "haut" ? "bottom-full mb-1" : "top-full mt-1")}
            entete={
              m.supprime ? undefined : <ChoixReaction actuelle={maReaction} onChoisir={(code) => (setMenu(null), onReagir(m, code))} />
            }
            elements={[...elements, { icone: Trash2, libelle: "Supprimer", action: () => onSupprimer(m), danger: true }]}
            onChoix={() => setMenu(null)}
          />
        )}
        {reactions.length > 0 && (
          <button
            type="button"
            onClick={() => (maReaction ? onReagir(m, null) : ouvrirMenu())}
            title={reactions.map(([qui, code]) => `${nom(qui)} : ${REACTIONS_AFFICHEES[code].libelle}`).join("\n")}
            className={clsx(
              "animate-pop relative z-10 -mt-1.5 flex items-center gap-1 rounded-full bg-panneau px-1.5 py-0.5 text-xs text-texte-2 shadow ring-1 ring-bordure",
              mien ? "mr-2 ml-auto" : "ml-2",
            )}
          >
            {[...new Set(reactions.map(([, code]) => code))].slice(0, 3).map((code) => (
              <IconeReaction key={code} code={code} taille={14} />
            ))}
            {reactions.length > 1 && <span className="pl-0.5 tabular-nums">{reactions.length}</span>}
          </button>
        )}
      </div>
      {mien && m.etat === "echec" && (
        <button
          type="button"
          onClick={() => onRenvoyer(m.id)}
          className="animate-fade mt-1 inline-flex items-center gap-1.5 text-xs text-danger hover:underline"
          title={m.erreur}
        >
          <RotateCw size={13} /> Non envoyé{m.erreur ? ` : ${m.erreur}` : ""} Réessayer
        </button>
      )}
    </div>
  );
}

function DialogueSuppression({
  message,
  mien,
  onPourTous,
  onPourMoi,
  onFermer,
}: {
  message: MessageLocal;
  mien: boolean;
  onPourTous: () => void;
  onPourMoi: () => void;
  onFermer: () => void;
}) {
  // Pour tout le monde : mon message, déjà parti, envoyé il y a moins de 48 heures.
  const pourTous =
    mien &&
    !message.supprime &&
    message.etat !== "attente" &&
    message.etat !== "echec" &&
    Date.now() - message.le < DELAI_SUPPRESSION;
  const premier = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    premier.current?.focus();
    const echap = (e: KeyboardEvent) => e.key === "Escape" && onFermer();
    window.addEventListener("keydown", echap);
    return () => window.removeEventListener("keydown", echap);
  }, [onFermer]);

  const bouton = "rounded-full px-5 py-2 text-sm font-medium transition-colors";
  return (
    <div className="animate-fade fixed inset-0 z-50 flex items-center justify-center bg-voile p-4" onMouseDown={onFermer}>
      <div
        role="alertdialog"
        aria-modal="true"
        aria-label="Supprimer le message"
        className="animate-rise w-full max-w-md rounded-lg bg-panneau p-6 shadow-xl"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <h2 className="text-[17px] text-texte">Supprimer le message ?</h2>
        {pourTous && (
          <p className="mt-3 text-sm leading-relaxed text-texte-2">
            « Pour tout le monde » le remplace par « Ce message a été supprimé » chez chacun.
          </p>
        )}
        <div className="mt-7 flex flex-col items-end gap-1.5">
          {pourTous && (
            <button ref={premier} type="button" onClick={onPourTous} className={clsx(bouton, "text-danger hover:bg-danger-doux")}>
              Supprimer pour tout le monde
            </button>
          )}
          <button
            ref={pourTous ? undefined : premier}
            type="button"
            onClick={onPourMoi}
            className={clsx(bouton, "text-primaire hover:bg-primaire-doux")}
          >
            Supprimer pour moi
          </button>
          <button type="button" onClick={onFermer} className={clsx(bouton, "text-texte-2 hover:bg-survol")}>
            Annuler
          </button>
        </div>
      </div>
    </div>
  );
}

function Composeur({
  conversation,
  reponse,
  nom,
  onAnnulerReponse,
  onEnvoyer,
  onEcrit,
}: {
  conversation: string;
  reponse: MessageLocal | null;
  nom: (id: string) => string;
  onAnnulerReponse: () => void;
  onEnvoyer: (texte: string) => void;
  onEcrit: () => void;
}) {
  const [texte, setTexte] = useState(() => brouillons.get(conversation) ?? "");
  const champ = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    champ.current?.focus();
  }, [reponse]);
  useEffect(() => {
    if (texte) brouillons.set(conversation, texte);
    else brouillons.delete(conversation);
  }, [texte, conversation]);
  // Le champ grandit avec le texte, jusqu'à six lignes.
  useLayoutEffect(() => {
    const t = champ.current;
    if (!t) return;
    t.style.height = "auto";
    t.style.height = `${Math.min(t.scrollHeight, 132)}px`;
  }, [texte]);

  function envoyer() {
    if (!texte.trim()) return;
    onEnvoyer(texte);
    setTexte("");
    champ.current?.focus();
  }

  return (
    <footer className="shrink-0 bg-entete">
      {reponse && (
        <div className="animate-rise flex items-center gap-3 px-3 pt-2.5 md:px-4">
          <div className="min-w-0 flex-1 rounded-md border-l-4 border-primaire bg-panneau px-3 py-2">
            <p className="text-[12.5px] font-medium text-primaire-texte">Réponse à {nom(reponse.de)}</p>
            <p className="truncate text-[13px] text-texte-2">{reponse.texte}</p>
          </div>
          <BoutonIcone libelle="Annuler la réponse" onClick={onAnnulerReponse}>
            <X size={20} />
          </BoutonIcone>
        </div>
      )}
      <div className="flex items-end gap-2 px-3 py-2.5 md:px-4">
        <div className="flex min-h-[42px] flex-1 items-center rounded-lg bg-panneau px-3.5 py-[10px]">
          <textarea
            ref={champ}
            rows={1}
            value={texte}
            maxLength={LIMITE_TEXTE}
            onChange={(e) => {
              setTexte(e.target.value);
              if (e.target.value.trim()) onEcrit();
            }}
            onKeyDown={(e) => {
              // Entrée envoie, Maj+Entrée va à la ligne ; pas pendant une saisie
              // en cours de composition (accents, alphabets asiatiques).
              if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
                e.preventDefault();
                envoyer();
              }
              if (e.key === "Escape" && reponse) onAnnulerReponse();
            }}
            placeholder="Écrire un message"
            aria-label="Message"
            className="max-h-[132px] w-full resize-none bg-transparent text-[15px] leading-[20px] text-texte outline-none placeholder:text-texte-2"
          />
        </div>
        <button
          type="button"
          onClick={envoyer}
          disabled={!texte.trim()}
          aria-label="Envoyer"
          title="Envoyer"
          className="flex size-[42px] shrink-0 items-center justify-center rounded-full bg-primaire text-sur-primaire transition-opacity hover:bg-primaire-fort disabled:opacity-40"
        >
          <SendHorizontal size={20} />
        </button>
      </div>
    </footer>
  );
}
