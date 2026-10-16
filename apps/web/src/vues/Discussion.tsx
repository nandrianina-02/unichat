import {
  DELAI_MODIFICATION,
  DELAI_SUPPRESSION,
  DUREES_EPINGLE,
  LIMITES_MEDIA,
  LIMITE_TEXTE,
  autreParticipant,
  estGroupe,
  formatMedia,
  idGroupe,
  mimeSimple,
  TRANSFERTS_NOMBREUX,
  type CarteProfil,
  type Reaction,
} from "@unichat/shared";
import clsx from "clsx";
import {
  ArrowLeft,
  Ban,
  Check,
  ChevronDown,
  CircleX,
  Copy,
  Flag,
  EllipsisVertical,
  FileText,
  Forward,
  Images,
  Info,
  LoaderCircle,
  Mic,
  Paperclip,
  Pencil,
  Pin,
  PinOff,
  Reply,
  RotateCw,
  Search,
  SendHorizontal,
  SmilePlus,
  SquareCheck,
  Star,
  StarOff,
  Trash2,
  UserPlus,
  X,
} from "lucide-react";
import { Dialogue } from "../composants/Dialogue";
import { DialogueTransfert } from "../composants/Transfert";
import { TexteMessage } from "../composants/TexteMessage";
import { Composeur } from "./Composeur";
import { useActionsDiscussion } from "../composants/ActionsDiscussion";
import { Menu, useFermetureExterieure, type ElementMenu } from "../composants/Menu";
import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { Avatar, AvatarGroupe } from "../composants/Avatar";
import { BoutonIcone } from "../composants/BoutonIcone";
import { Coches } from "../composants/Coches";
import { Enregistrement } from "../composants/Enregistrement";
import { ACCEPTE_DOCUMENTS, ACCEPTE_VISUELS, EnvoiFichiers } from "../composants/EnvoiFichiers";
import { contactsModifies } from "../composants/Lignes";
import { ContenuMedia, Visionneuse, type MessageAvecMedia } from "../composants/Media";
import { ChoixReaction, IconeReaction, REACTIONS_AFFICHEES } from "../composants/Reactions";
import { ErreurApi, api } from "../lib/api";
import { useCompte, useMoi } from "../lib/compte";
import { heureCourte, jourMessage, resumeMessage, tailleFichier, texteEvenement, vuLe } from "../lib/format";
import { useMessagerie, useMessages } from "../lib/messagerie-react";
import type { Epingle, MessageLocal } from "../lib/stockage";

const dateCopie = new Intl.DateTimeFormat("fr-FR", { day: "2-digit", month: "2-digit", year: "numeric" });

/** Fait défiler jusqu'à un message et le surligne un instant (citation, épingle, recherche). */
export function allerAuMessage(id: string): void {
  const cible = document.getElementById(`message-${id}`);
  if (!cible) return;
  cible.scrollIntoView({ block: "center", behavior: "smooth" });
  cible.classList.remove("surbrillance");
  // Relancer l'animation même si on clique deux fois de suite.
  void cible.offsetWidth;
  cible.classList.add("surbrillance");
}

interface Props {
  conversation: string;
  /** Message à montrer à l'ouverture (venu des messages importants). */
  cible?: string;
  onInfos: () => void;
  onRechercher: () => void;
  onFermer: () => void;
}

export function Discussion({ conversation, cible, onInfos, onRechercher, onFermer }: Props) {
  const moi = useMoi();
  const { messagerie, etat } = useMessagerie();
  const messages = useMessages(conversation);
  const groupe = estGroupe(conversation) ? etat.groupes[idGroupe(conversation)] : undefined;
  const enGroupe = estGroupe(conversation);
  const autre = enGroupe ? null : autreParticipant(conversation, moi.id);
  const estSoi = autre === moi.id;
  const personne: CarteProfil | undefined = estSoi
    ? { id: moi.id, nom: moi.nom, pseudo: moi.pseudo, infos: moi.infos, photo: moi.photo, estContact: false, estSoi: true, bloque: false }
    : autre
      ? etat.personnes[autre]
      : undefined;
  const quitte = enGroupe && groupe !== undefined && !groupe.moiMembre;

  const [reponse, setReponse] = useState<MessageLocal | null>(null);
  const [aSupprimer, setASupprimer] = useState<MessageLocal[] | null>(null);
  const [selection, setSelection] = useState<Set<string> | null>(null);
  const [edition, setEdition] = useState<MessageLocal | null>(null);
  const [aTransferer, setATransferer] = useState<MessageLocal[] | null>(null);
  const [aEpingler, setAEpingler] = useState<MessageLocal | null>(null);
  const [avis, setAvis] = useState<string | null>(null);
  const [aJoindre, setAJoindre] = useState<File[] | null>(null);
  const [visionne, setVisionne] = useState<{ message: MessageAvecMedia; url: string } | null>(null);
  const [depot, setDepot] = useState(false);

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

  const libelleInfos = enGroupe ? "Infos du groupe" : "Infos du contact";
  const actions = useActionsDiscussion(conversation, { onRetiree: onFermer, onAvis: setAvis });
  // Même ordre que le menu de WhatsApp ; les appels viendront avec l'étape 4.
  const elementsMenu: ElementMenu[] = [
    { icone: Info, libelle: libelleInfos, action: onInfos },
    { icone: Search, libelle: "Rechercher", action: onRechercher },
    { icone: SquareCheck, libelle: "Sélectionner des messages", action: () => setSelection(new Set()) },
    actions.elements.sourdine,
    actions.elements.favoris,
    actions.elements.exporter,
    { icone: CircleX, libelle: "Fermer la discussion", action: onFermer },
    "separateur",
    ...actions.elements.moderation,
  ];

  const discussion = etat.conversations.find((c) => c.id === conversation);
  const epingles = (discussion?.epingles ?? []).filter((p) => p.jusqua > Date.now());
  const epinglees = new Set(epingles.map((p) => p.message));
  const selectionnes = (messages ?? []).filter((m) => selection?.has(m.id));

  async function reagir(message: MessageLocal, code: Reaction | null) {
    if (!(await messagerie.reagir(message, code))) setAvis("Hors connexion : la réaction n'a pas pu être envoyée.");
  }

  async function epingler(message: MessageLocal) {
    if (epinglees.has(message.id)) {
      if (!(await messagerie.epingler(message, null))) setAvis("Hors connexion : réessayez une fois reconnecté.");
      return;
    }
    setAEpingler(message);
  }

  function copier(liste: MessageLocal[]) {
    const avecTexte = liste.filter((m) => m.texte);
    if (avecTexte.length === 0) return;
    // Plusieurs messages : copiés comme WhatsApp, avec l'heure et l'auteur.
    const texte =
      avecTexte.length === 1
        ? avecTexte[0]!.texte
        : avecTexte
            .map((m) => `[${dateCopie.format(new Date(m.le))} ${heureCourte(m.le)}] ${m.de === moi.id ? moi.nom : nom(m.de)} : ${m.texte}`)
            .join("\n");
    void navigator.clipboard.writeText(texte).then(
      () => setAvis(avecTexte.length > 1 ? "Messages copiés." : "Message copié."),
      () => setAvis("La copie a été refusée par le navigateur."),
    );
  }

  function basculerSelection(m: MessageLocal) {
    setSelection((actuelle) => {
      const suite = new Set(actuelle ?? []);
      if (suite.has(m.id)) suite.delete(m.id);
      else suite.add(m.id);
      return suite;
    });
  }

  function joindre(fichiers: File[]) {
    if (quitte || fichiers.length === 0) return;
    setAJoindre(fichiers);
  }

  function envoyerVocal(blob: Blob, duree: number) {
    const mime = mimeSimple(blob.type);
    const format = formatMedia(mime);
    if (!format || format.type !== "audio") {
      setAvis("Ce navigateur enregistre dans un format que UniChat ne prend pas en charge.");
      return;
    }
    if (blob.size > LIMITES_MEDIA.audio) {
      setAvis(`Message vocal trop long : ${tailleFichier(LIMITES_MEDIA.audio)} au maximum.`);
      return;
    }
    const fichier = { blob, nom: `Message vocal.${format.extension}`, mime, type: "audio" as const, duree, vocal: true };
    void messagerie.envoyerFichier(conversation, fichier, "", reponse ?? undefined);
    setReponse(null);
  }

  return (
    <section
      className="relative flex h-full min-w-0 flex-1 flex-col bg-discussion"
      onDragOver={(e) => {
        if (quitte || !e.dataTransfer.types.includes("Files")) return;
        e.preventDefault();
        setDepot(true);
      }}
      onDragLeave={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setDepot(false);
      }}
      onDrop={(e) => {
        if (quitte) return;
        e.preventDefault();
        setDepot(false);
        joindre([...e.dataTransfer.files]);
      }}
    >
      <EnTete
        avatar={enGroupe ? <AvatarGroupe taille={40} groupeId={groupe?.id} photo={groupe?.photo} /> : <Avatar id={autre!} photo={personne?.photo ?? null} nom={titre || "Contact"} taille={40} />}
        titre={titre}
        statut={statut}
        ecrit={Boolean(ecrit)}
        libelleInfos={libelleInfos}
        elements={elementsMenu}
        onInfos={onInfos}
        onRechercher={onRechercher}
        onFermer={onFermer}
      />
      {epingles.length > 0 && messages && (
        <BandeauEpingles
          epingles={epingles}
          messages={messages}
          nom={nom}
          onDesepingler={(m) => void messagerie.epingler(m, null)}
        />
      )}
      {personne && !personne.estContact && !estSoi && !personne.bloque && (
        <BanniereInconnu personne={personne} onBloquer={() => actions.ouvrir("bloquer")} onSignaler={() => actions.ouvrir("signaler")} />
      )}
      <ListeMessages
        messages={messages}
        moiId={moi.id}
        enGroupe={enGroupe}
        nom={nom}
        nomMention={(id) => (id === moi.id ? moi.nom : (groupe?.membres.find((m) => m.id === id)?.nom ?? nom(id)))}
        cible={cible}
        selection={selection}
        epinglees={epinglees}
        onRepondre={(m) => (setEdition(null), setReponse(m))}
        onReagir={(m, code) => void reagir(m, code)}
        onSupprimer={(m) => setASupprimer([m])}
        onCopier={(m) => copier([m])}
        onRenvoyer={(id) => void messagerie.renvoyer(id)}
        onOuvrirMedia={(message, url) => setVisionne({ message, url })}
        onTransferer={(m) => setATransferer([m])}
        onEpingler={(m) => void epingler(m)}
        onImportant={(m) => void messagerie.marquerImportant(m, !m.importantLe)}
        onModifier={(m) => (setReponse(null), setEdition(m))}
        onSelectionner={(m) => setSelection(new Set([m.id]))}
        onBasculerSelection={basculerSelection}
        envois={etat.envois}
      />
      {avis && (
        <p role="status" className="animate-fade shrink-0 bg-entete px-4 pt-2 text-center text-[13px] text-texte-2">
          {avis}
        </p>
      )}
      {selection ? (
        <BarreSelection
          nombre={selection.size}
          tousImportants={selectionnes.length > 0 && selectionnes.every((m) => m.importantLe)}
          onFermer={() => setSelection(null)}
          onCopier={() => copier(selectionnes)}
          onImportant={() => {
            const marquer = !selectionnes.every((m) => m.importantLe);
            for (const m of selectionnes) void messagerie.marquerImportant(m, marquer);
            setSelection(null);
          }}
          onSupprimer={() => setASupprimer(selectionnes)}
          onTransferer={() => setATransferer(selectionnes.filter((m) => !m.supprime))}
        />
      ) : quitte ? (
        <footer className="shrink-0 bg-entete px-4 py-4 text-center text-sm text-texte-2">
          Vous ne pouvez plus envoyer de messages dans ce groupe.
        </footer>
      ) : personne?.bloque ? (
        <footer className="animate-fade shrink-0 bg-entete px-4 py-3 text-center text-sm text-texte-2">
          Vous avez bloqué ce contact.{" "}
          <button type="button" onClick={() => actions.ouvrir("bloquer")} className="font-medium text-primaire-texte hover:underline">
            Débloquer
          </button>
        </footer>
      ) : (
        <Composeur
          conversation={conversation}
          reponse={reponse}
          edition={edition}
          nom={nom}
          onAnnulerReponse={() => setReponse(null)}
          onAnnulerEdition={() => setEdition(null)}
          onModifier={async (texte) => {
            if (edition && texte.trim() !== edition.texte && !(await messagerie.modifier(edition, texte))) {
              setAvis("Le message n'a pas pu être modifié (hors connexion, ou plus de 15 minutes).");
            }
            setEdition(null);
          }}
          membres={groupe?.membres.filter((m) => !m.estSoi).map((m) => ({ id: m.id, nom: m.nom }))}
          onEnvoyer={(texte, extras) => {
            void messagerie.envoyer(conversation, texte, reponse ?? undefined, extras);
            setReponse(null);
          }}
          onEcrit={() => !estSoi && messagerie.signalerEcriture(conversation)}
          onJoindre={joindre}
          onVocal={envoyerVocal}
          onAvis={setAvis}
        />
      )}
      {depot && (
        <div className="animate-fade pointer-events-none absolute inset-0 z-30 flex items-center justify-center bg-voile p-8">
          <p className="flex items-center gap-3 rounded-lg bg-panneau px-6 py-4 text-[15px] text-texte shadow-xl">
            <Paperclip size={20} className="text-primaire" /> Déposez les fichiers pour les envoyer
          </p>
        </div>
      )}
      {aJoindre && (
        <EnvoiFichiers
          fichiers={aJoindre}
          destinataire={titre || "ce contact"}
          onAnnuler={() => setAJoindre(null)}
          onEnvoyer={(envois) => {
            for (const [i, { fichier, legende }] of envois.entries()) {
              // La réponse s'attache au premier fichier, comme une légende.
              void messagerie.envoyerFichier(conversation, fichier, legende, i === 0 ? (reponse ?? undefined) : undefined);
            }
            setReponse(null);
            setAJoindre(null);
          }}
        />
      )}
      {visionne && (
        <Visionneuse
          message={visionne.message}
          url={visionne.url}
          auteur={visionne.message.de === moi.id ? "Vous" : nom(visionne.message.de)}
          onFermer={() => setVisionne(null)}
        />
      )}
      {actions.dialogue}
      {aSupprimer && (
        <DialogueSuppression
          messages={aSupprimer}
          moiId={moi.id}
          onPourTous={async () => {
            let echec = false;
            for (const m of aSupprimer) if (!(await messagerie.supprimerPourTous(m))) echec = true;
            if (echec) setAvis("Hors connexion : réessayez une fois reconnecté.");
            setASupprimer(null);
            setSelection(null);
          }}
          onPourMoi={async () => {
            for (const m of aSupprimer) await messagerie.supprimerPourMoi(m);
            setASupprimer(null);
            setSelection(null);
          }}
          onFermer={() => setASupprimer(null)}
        />
      )}
      {aTransferer && aTransferer.length > 0 && (
        <DialogueTransfert
          messages={aTransferer}
          onAvis={setAvis}
          onFermer={() => {
            setATransferer(null);
            setSelection(null);
          }}
        />
      )}
      {aEpingler && (
        <DialogueEpingle
          onFermer={() => setAEpingler(null)}
          onEpingler={async (duree) => {
            if (!(await messagerie.epingler(aEpingler, duree))) setAvis("Hors connexion : réessayez une fois reconnecté.");
            setAEpingler(null);
          }}
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
  elements,
  onInfos,
  onRechercher,
  onFermer,
}: {
  avatar: ReactNode;
  titre: string;
  statut: string;
  ecrit: boolean;
  libelleInfos: string;
  elements: ElementMenu[];
  onInfos: () => void;
  onRechercher: () => void;
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
      <BoutonIcone libelle="Rechercher" onClick={onRechercher}>
        <Search size={21} />
      </BoutonIcone>
      <div ref={menuRef} className="relative">
        <BoutonIcone libelle="Menu" actif={menu} onClick={() => setMenu((m) => !m)} aria-haspopup="menu" aria-expanded={menu}>
          <EllipsisVertical size={22} />
        </BoutonIcone>
        {menu && (
          <Menu className="right-0 top-11 max-h-[calc(100vh-80px)] overflow-y-auto" elements={elements} onChoix={() => setMenu(false)} />
        )}
      </div>
    </header>
  );
}

/** Message d'une personne absente des contacts : on propose de l'ajouter, comme dans les messageries de référence. */
function BanniereInconnu({
  personne,
  onBloquer,
  onSignaler,
}: {
  personne: CarteProfil;
  onBloquer: () => void;
  onSignaler: () => void;
}) {
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
      <button type="button" onClick={onBloquer} className="inline-flex items-center gap-1.5 font-medium text-danger hover:underline">
        <Ban size={15} /> Bloquer
      </button>
      <button type="button" onClick={onSignaler} className="inline-flex items-center gap-1.5 font-medium text-danger hover:underline">
        <Flag size={15} /> Signaler
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
  onOuvrirMedia: (m: MessageAvecMedia, url: string) => void;
  onTransferer: (m: MessageLocal) => void;
  onEpingler: (m: MessageLocal) => void;
  onImportant: (m: MessageLocal) => void;
  onModifier: (m: MessageLocal) => void;
  onSelectionner: (m: MessageLocal) => void;
  onBasculerSelection: (m: MessageLocal) => void;
}

function ListeMessages({
  messages,
  moiId,
  enGroupe,
  nom,
  envois,
  cible,
  selection,
  epinglees,
  nomMention,
  ...actions
}: {
  messages: MessageLocal[] | null;
  moiId: string;
  enGroupe: boolean;
  nom: (id: string) => string;
  nomMention: (id: string) => string;
  envois: Record<string, number>;
  cible?: string;
  selection: Set<string> | null;
  epinglees: Set<string>;
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
      if (cible && document.getElementById(`message-${cible}`)) allerAuMessage(cible);
      else if (separateur.current) separateur.current.scrollIntoView({ block: "center" });
      else z.scrollTop = z.scrollHeight;
      return;
    }
    const dernier = messages[messages.length - 1];
    // On suit la conversation si on était en bas, ou si c'est moi qui viens d'écrire.
    if (enBas.current || (dernier?.de === moiId && dernier.etat === "attente")) z.scrollTop = z.scrollHeight;
  }, [messages, moiId, cible]);

  function surDefilement() {
    const z = zone.current;
    if (!z) return;
    const distance = z.scrollHeight - z.scrollTop - z.clientHeight;
    enBas.current = distance < 80;
    setBoutonBas(distance > 300);
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
        progression={envois[m.id]}
        nomMention={nomMention}
        selectionActive={selection !== null}
        selectionne={selection?.has(m.id) ?? false}
        epinglee={epinglees.has(m.id)}
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
  progression,
  nomMention,
  selectionActive,
  selectionne,
  epinglee,
  onAllerA,
  onRepondre,
  onReagir,
  onSupprimer,
  onCopier,
  onRenvoyer,
  onOuvrirMedia,
  onTransferer,
  onEpingler,
  onImportant,
  onModifier,
  onSelectionner,
  onBasculerSelection,
}: {
  message: MessageLocal;
  mien: boolean;
  moiId: string;
  premier: boolean;
  auteur: string | null;
  nom: (id: string) => string;
  progression: number | undefined;
  nomMention: (id: string) => string;
  selectionActive: boolean;
  selectionne: boolean;
  epinglee: boolean;
  onAllerA: (id: string) => void;
} & ActionsMessage) {
  const [menu, setMenu] = useState<"bas" | "haut" | null>(null);
  const [reactionRapide, setReactionRapide] = useState(false);
  const cadre = useRef<HTMLDivElement>(null);
  useFermetureExterieure(menu !== null || reactionRapide, cadre, () => {
    setMenu(null);
    setReactionRapide(false);
  });
  const reactions = Object.entries(m.reactions ?? {});
  const maReaction = m.reactions?.[moiId];

  function ouvrirMenu() {
    const r = cadre.current?.getBoundingClientRect();
    // Près du bas de l'écran, le menu s'ouvre vers le haut.
    setMenu(r && r.bottom > window.innerHeight - 300 ? "haut" : "bas");
  }

  // Parti et connu du serveur : on peut l'épingler, le transférer ou le modifier.
  const parti = !mien || (m.etat !== "attente" && m.etat !== "echec");
  const modifiable = mien && parti && !m.supprime && Boolean(m.texte) && Date.now() - m.le < DELAI_MODIFICATION;
  const elements: ElementMenu[] = m.supprime
    ? []
    : [
        { icone: Reply, libelle: "Répondre", action: () => onRepondre(m) },
        ...(m.texte ? [{ icone: Copy, libelle: "Copier", action: () => onCopier(m) }] : []),
        ...(parti ? [{ icone: Forward, libelle: "Transférer", action: () => onTransferer(m) }] : []),
        ...(parti ? [{ icone: epinglee ? PinOff : Pin, libelle: epinglee ? "Désépingler" : "Épingler", action: () => onEpingler(m) }] : []),
        {
          icone: m.importantLe ? StarOff : Star,
          libelle: m.importantLe ? "Retirer des importants" : "Marquer comme important",
          action: () => onImportant(m),
        },
        ...(modifiable ? [{ icone: Pencil, libelle: "Modifier", action: () => onModifier(m) }] : []),
        { icone: SquareCheck, libelle: "Sélectionner", action: () => onSelectionner(m) },
      ];
  // Place réservée à l'heure sur la dernière ligne : elle grandit avec « Modifié » et l'étoile.
  const reserve = (mien ? 68 : 42) + (m.modifieLe && !m.supprime ? 50 : 0) + (m.importantLe ? 16 : 0);
  const media = !m.supprime && m.media ? m.media : undefined;
  // Photo et vidéo occupent toute la bulle, bord à bord ; l'heure se pose dessus quand il n'y a pas de légende.
  const visuel = media?.type === "image" || media?.type === "video";
  const heurePosee = visuel && !m.texte;
  const heure = (
    <>
      {m.importantLe && <Star size={12} className="fill-current" aria-label="Important" />}
      {m.modifieLe && !m.supprime && <span>Modifié</span>}
      {heureCourte(m.le)}
      {mien && !m.supprime && <Coches etat={m.etat} surImage={heurePosee} />}
    </>
  );

  return (
    <div
      id={`message-${m.id}`}
      onClick={selectionActive ? () => onBasculerSelection(m) : undefined}
      className={clsx(
        "relative flex flex-col rounded-lg px-[5%] md:px-[7%]",
        mien ? "items-end" : "items-start",
        premier ? "mt-2.5" : "mt-0.5",
        // En sélection, toute la ligne se coche, la case à gauche comme dans WhatsApp.
        selectionActive && "cursor-pointer py-0.5 pl-14 md:pl-16",
        selectionne && "bg-primaire/10",
      )}
    >
      {selectionActive && (
        <span
          role="checkbox"
          aria-checked={selectionne}
          aria-label="Sélectionner ce message"
          className={clsx(
            "absolute top-1/2 left-4 flex size-5 -translate-y-1/2 items-center justify-center rounded-[4px] border-2 transition-colors",
            selectionne ? "border-primaire bg-primaire" : "border-texte-3",
          )}
        >
          {selectionne && <Check size={14} strokeWidth={3} className="text-sur-primaire" />}
        </span>
      )}
      <div ref={cadre} className={clsx("group relative max-w-[min(85%,560px)] md:max-w-[min(65%,560px)]", selectionActive && "pointer-events-none")}>
        <div
          className={clsx(
            "relative rounded-lg text-[14.5px] leading-[19px] text-texte shadow-sm",
            visuel ? "p-[3px]" : "px-2.5 pt-1.5 pb-2",
            mien ? "bg-bulle-envoyee" : "bg-bulle-recue",
            premier && (mien ? "rounded-tr-none" : "rounded-tl-none"),
          )}
        >
          {premier && <Queue mien={mien} />}
          {(auteur || (m.reponseA && !m.supprime) || (m.transfere && !m.supprime)) && (
            <div className={visuel ? "px-1.5 pt-0.5 pb-[3px]" : undefined}>
              {auteur && <span className="mb-0.5 block text-[13px] font-medium text-primaire-texte">{auteur}</span>}
              {m.transfere && !m.supprime && (
                <span className="mb-0.5 flex items-center gap-1 text-[12.5px] italic text-texte-2">
                  <Forward size={14} className="shrink-0" />
                  {m.transfere >= TRANSFERTS_NOMBREUX ? "Transféré plusieurs fois" : "Transféré"}
                </span>
              )}
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
            </div>
          )}
          {m.lien && !m.supprime && !media && (
            <a
              href={m.lien.url}
              target="_blank"
              rel="noopener noreferrer nofollow"
              className="mb-1.5 block min-w-[200px] rounded-md bg-texte/5 px-3 py-2 transition-colors hover:bg-texte/10"
            >
              <span className="block truncate text-[12px] uppercase tracking-wide text-texte-2">{m.lien.site}</span>
              {m.lien.titre && <span className="mt-0.5 block line-clamp-2 text-[14px] font-medium text-texte">{m.lien.titre}</span>}
              {m.lien.description && <span className="mt-0.5 block line-clamp-2 text-[13px] text-texte-2">{m.lien.description}</span>}
            </a>
          )}
          {media && (
            <ContenuMedia
              message={m as MessageAvecMedia}
              progression={progression}
              surImage={
                heurePosee ? (
                  <span className="pointer-events-none absolute right-1.5 bottom-1.5 flex items-center gap-1 rounded bg-pastille-media px-1.5 py-0.5 text-[11px] text-sur-visionneuse">
                    {heure}
                  </span>
                ) : undefined
              }
              onOuvrir={(url) => onOuvrirMedia(m as MessageAvecMedia, url)}
            />
          )}
          {!heurePosee && (
            <div className={clsx(visuel && "px-1.5 pt-1.5 pb-1", media?.type === "document" && "pt-1")}>
              {m.supprime ? (
                <span className="inline-flex items-center gap-1.5 italic text-texte-2">
                  <Ban size={14} /> {mien ? "Vous avez supprimé ce message" : "Ce message a été supprimé"}
                </span>
              ) : (
                m.texte && (
                  <span className="whitespace-pre-wrap [overflow-wrap:anywhere]">
                    <TexteMessage texte={m.texte} mentions={(m.mentions ?? []).map(nomMention)} />
                  </span>
                )
              )}
              {/* Réserve la place de l'heure sur la dernière ligne, qui s'y loge en bas à droite. */}
              {media?.type !== "audio" && <span aria-hidden="true" className="inline-block" style={{ width: reserve }} />}
            </div>
          )}
          {!heurePosee && <span className="absolute right-2 bottom-1 flex items-center gap-1 text-[11px] text-texte-2">{heure}</span>}
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
        {/* Actions rapides au survol, à côté de la bulle : réagir, transférer. */}
        {!m.supprime && !selectionActive && (
          <div
            className={clsx(
              "absolute top-1/2 flex -translate-y-1/2 items-center gap-0.5 opacity-0 transition-opacity group-hover:opacity-100 focus-within:opacity-100",
              mien ? "right-full mr-1.5" : "left-full ml-1.5",
              (reactionRapide || menu) && "opacity-100",
            )}
          >
            <button
              type="button"
              aria-label="Réagir"
              title="Réagir"
              onClick={() => setReactionRapide((r) => !r)}
              className="flex size-8 items-center justify-center rounded-full text-texte-2 transition-colors hover:bg-panneau"
            >
              <SmilePlus size={18} />
            </button>
            {parti && (
              <button
                type="button"
                aria-label="Transférer"
                title="Transférer"
                onClick={() => onTransferer(m)}
                className="flex size-8 items-center justify-center rounded-full text-texte-2 transition-colors hover:bg-panneau"
              >
                <Forward size={18} />
              </button>
            )}
          </div>
        )}
        {reactionRapide && (
          <div
            className={clsx(
              "animate-pop absolute bottom-full z-30 mb-1 rounded-full bg-panneau px-1.5 py-1 shadow-xl ring-1 ring-bordure",
              mien ? "right-0" : "left-0",
            )}
          >
            <ChoixReaction actuelle={maReaction} onChoisir={(code) => (setReactionRapide(false), onReagir(m, code))} />
          </div>
        )}
        {menu && (
          <Menu
            className={clsx(mien ? "right-0" : "left-0", menu === "haut" ? "bottom-full mb-1" : "top-full mt-1")}
            entete={
              m.supprime ? undefined : <ChoixReaction actuelle={maReaction} onChoisir={(code) => (setMenu(null), onReagir(m, code))} />
            }
            elements={[...elements, "separateur", { icone: Trash2, libelle: "Supprimer", action: () => onSupprimer(m), danger: true }]}
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
  messages,
  moiId,
  onPourTous,
  onPourMoi,
  onFermer,
}: {
  messages: MessageLocal[];
  moiId: string;
  onPourTous: () => void;
  onPourMoi: () => void;
  onFermer: () => void;
}) {
  // Pour tout le monde : mes messages, déjà partis, envoyés il y a moins de 48 heures — tous, ou rien.
  const pourTous =
    messages.length > 0 &&
    messages.every(
      (message) =>
        message.de === moiId &&
        !message.supprime &&
        message.etat !== "attente" &&
        message.etat !== "echec" &&
        Date.now() - message.le < DELAI_SUPPRESSION,
    );
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
        aria-label={messages.length > 1 ? "Supprimer les messages" : "Supprimer le message"}
        className="animate-rise w-full max-w-md rounded-lg bg-panneau p-6 shadow-xl"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <h2 className="text-[17px] text-texte">{messages.length > 1 ? `Supprimer ${messages.length} messages ?` : "Supprimer le message ?"}</h2>
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

/** Messages épinglés : le plus récent d'abord ; un clic y mène et passe au suivant. */
function BandeauEpingles({
  epingles,
  messages,
  nom,
  onDesepingler,
}: {
  epingles: Epingle[];
  messages: MessageLocal[];
  nom: (id: string) => string;
  onDesepingler: (m: MessageLocal) => void;
}) {
  const [rang, setRang] = useState(0);
  const presents = [...epingles]
    .reverse()
    .map((p) => messages.find((m) => m.id === p.message && !m.supprime))
    .filter((m): m is MessageLocal => Boolean(m));
  if (presents.length === 0) return null;
  const courant = presents[rang % presents.length]!;
  return (
    <div
      role="region"
      aria-label="Messages épinglés"
      className="animate-fade flex shrink-0 items-center gap-3 border-b border-bordure bg-panneau py-1.5 pr-2 pl-4"
    >
      {presents.length > 1 && (
        <span className="flex flex-col gap-0.5" aria-hidden="true">
          {presents.map((m, i) => (
            <span key={m.id} className={clsx("h-2.5 w-0.5 rounded-full", i === rang % presents.length ? "bg-primaire" : "bg-texte-3")} />
          ))}
        </span>
      )}
      <Pin size={16} className="shrink-0 text-texte-2" />
      <button
        type="button"
        onClick={() => {
          allerAuMessage(courant.id);
          setRang((r) => r + 1);
        }}
        className="min-w-0 flex-1 text-left"
        title="Aller au message épinglé"
      >
        <span className="block truncate text-[12.5px] text-primaire-texte">{nom(courant.de)}</span>
        <span className="block truncate text-[13.5px] text-texte">{resumeMessage(courant)}</span>
      </button>
      <BoutonIcone libelle="Désépingler" onClick={() => onDesepingler(courant)}>
        <PinOff size={18} />
      </BoutonIcone>
    </div>
  );
}

function BarreSelection({
  nombre,
  tousImportants,
  onFermer,
  onCopier,
  onImportant,
  onSupprimer,
  onTransferer,
}: {
  nombre: number;
  tousImportants: boolean;
  onFermer: () => void;
  onCopier: () => void;
  onImportant: () => void;
  onSupprimer: () => void;
  onTransferer: () => void;
}) {
  useEffect(() => {
    const echap = (e: KeyboardEvent) => e.key === "Escape" && onFermer();
    window.addEventListener("keydown", echap);
    return () => window.removeEventListener("keydown", echap);
  }, [onFermer]);
  const vide = nombre === 0;
  return (
    <footer className="animate-fade flex shrink-0 items-center gap-1 bg-entete px-2 py-2.5 md:px-4">
      <BoutonIcone libelle="Annuler la sélection" onClick={onFermer}>
        <X size={22} />
      </BoutonIcone>
      <span className="flex-1 pl-2 text-[15px] text-texte">
        {nombre} sélectionné{nombre > 1 ? "s" : ""}
      </span>
      <BoutonIcone libelle="Copier" onClick={onCopier} disabled={vide}>
        <Copy size={20} />
      </BoutonIcone>
      <BoutonIcone libelle={tousImportants ? "Retirer des importants" : "Marquer comme importants"} onClick={onImportant} disabled={vide}>
        {tousImportants ? <StarOff size={20} /> : <Star size={20} />}
      </BoutonIcone>
      <BoutonIcone libelle="Supprimer" onClick={onSupprimer} disabled={vide}>
        <Trash2 size={20} />
      </BoutonIcone>
      <BoutonIcone libelle="Transférer" onClick={onTransferer} disabled={vide}>
        <Forward size={20} />
      </BoutonIcone>
    </footer>
  );
}

/** Durée d'une épingle, comme dans WhatsApp : 7 jours par défaut. */
function DialogueEpingle({ onEpingler, onFermer }: { onEpingler: (duree: number) => void; onFermer: () => void }) {
  const [duree, setDuree] = useState<number>(DUREES_EPINGLE[1].duree);
  return (
    <Dialogue titre="Épingler le message" confirmer="Épingler" onConfirmer={() => onEpingler(duree)} onFermer={onFermer}>
      <p>Le message reste en haut de la discussion pour tous les participants. Vous pouvez le désépingler à tout moment.</p>
      <div role="radiogroup" aria-label="Durée de l'épingle" className="mt-4 flex flex-col">
        {DUREES_EPINGLE.map((d) => (
          <label key={d.libelle} className="flex cursor-pointer items-center gap-4 py-2 text-[15px] text-texte">
            <input type="radio" name="epingle" checked={duree === d.duree} onChange={() => setDuree(d.duree)} className="sr-only" />
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
}
