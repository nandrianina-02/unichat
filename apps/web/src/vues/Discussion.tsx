import { LIMITE_TEXTE, conversationDirecte, type CarteProfil } from "@unichat/shared";
import clsx from "clsx";
import { ArrowLeft, ChevronDown, EllipsisVertical, Info, LoaderCircle, RotateCw, SendHorizontal, UserPlus, X } from "lucide-react";
import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { Avatar } from "../composants/Avatar";
import { BoutonIcone } from "../composants/BoutonIcone";
import { Coches } from "../composants/Coches";
import { contactsModifies } from "../composants/Lignes";
import { ErreurApi, api } from "../lib/api";
import { useCompte, useMoi } from "../lib/compte";
import { heureCourte, jourMessage, vuLe } from "../lib/format";
import { useMessagerie, useMessages } from "../lib/messagerie-react";
import type { MessageLocal } from "../lib/stockage";

// Brouillons gardés le temps de la visite, par discussion, comme dans les messageries de référence.
const brouillons = new Map<string, string>();

interface Props {
  avec: string;
  onInfos: () => void;
  onFermer: () => void;
}

export function Discussion({ avec, onInfos, onFermer }: Props) {
  const moi = useMoi();
  const { messagerie, etat } = useMessagerie();
  const conversation = conversationDirecte(moi.id, avec);
  const messages = useMessages(conversation);
  const estSoi = avec === moi.id;
  const personne: CarteProfil | undefined = estSoi
    ? { id: moi.id, nom: moi.nom, pseudo: moi.pseudo, infos: moi.infos, photo: moi.photo, estContact: false, estSoi: true }
    : etat.personnes[avec];

  // Présence : demandée à l'ouverture, puis toutes les 30 secondes tant que la discussion est affichée.
  useEffect(() => {
    messagerie.ouvrir(conversation);
    if (!estSoi) void messagerie.chargerPersonne(avec);
    const minuterie = setInterval(() => messagerie.demanderPresence(avec), 30_000);
    return () => {
      clearInterval(minuterie);
      messagerie.ouvrir(null);
    };
  }, [messagerie, conversation, avec, estSoi]);

  // Ce qui s'affiche sous les yeux est lu ; pas quand l'onglet est en arrière-plan.
  useEffect(() => {
    if (!messages) return;
    const marquer = () => !document.hidden && void messagerie.marquerLu(conversation);
    marquer();
    document.addEventListener("visibilitychange", marquer);
    return () => document.removeEventListener("visibilitychange", marquer);
  }, [messages, messagerie, conversation]);

  const ecrit = (etat.ecrit[avec] ?? 0) > Date.now();
  const presence = etat.presences[avec];
  const statut = estSoi
    ? "Envoyez-vous des messages"
    : ecrit
      ? "écrit…"
      : presence?.enLigne
        ? "en ligne"
        : presence?.vuLe
          ? vuLe(presence.vuLe)
          : "";
  const nom = personne ? (estSoi ? `${personne.nom} (vous)` : personne.nom) : "";

  return (
    <section className="flex h-full min-w-0 flex-1 flex-col bg-discussion">
      <EnTete
        avec={avec}
        personne={personne}
        nom={nom}
        statut={statut}
        ecrit={ecrit}
        onInfos={onInfos}
        onFermer={onFermer}
      />
      {personne && !personne.estContact && !estSoi && <BanniereInconnu personne={personne} />}
      <ListeMessages messages={messages} moiId={moi.id} onRenvoyer={(id) => void messagerie.renvoyer(id)} />
      <Composeur
        conversation={conversation}
        onEnvoyer={(texte) => void messagerie.envoyer(avec, texte)}
        onEcrit={() => !estSoi && messagerie.signalerEcriture(avec)}
      />
    </section>
  );
}

function EnTete({
  avec,
  personne,
  nom,
  statut,
  ecrit,
  onInfos,
  onFermer,
}: {
  avec: string;
  personne: CarteProfil | undefined;
  nom: string;
  statut: string;
  ecrit: boolean;
  onInfos: () => void;
  onFermer: () => void;
}) {
  const [menu, setMenu] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!menu) return;
    const fermer = (e: MouseEvent) => !menuRef.current?.contains(e.target as Node) && setMenu(false);
    document.addEventListener("mousedown", fermer);
    return () => document.removeEventListener("mousedown", fermer);
  }, [menu]);

  return (
    <header className="flex h-[60px] shrink-0 items-center gap-2 bg-entete pr-3 pl-2 md:pl-4">
      <BoutonIcone libelle="Retour" onClick={onFermer} className="md:hidden">
        <ArrowLeft size={22} />
      </BoutonIcone>
      <button type="button" onClick={onInfos} className="flex min-w-0 flex-1 items-center gap-3 rounded-lg py-1 text-left" title="Infos du contact">
        <Avatar id={avec} photo={personne?.photo ?? null} nom={nom || "Contact"} taille={40} />
        <span className="min-w-0">
          <span className="block truncate text-[16px] text-texte">{nom || "…"}</span>
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
          <div role="menu" className="animate-pop absolute right-0 top-11 z-30 w-56 rounded-lg bg-panneau py-2 shadow-xl ring-1 ring-bordure">
            {[
              { icone: Info, libelle: "Infos du contact", action: onInfos },
              { icone: X, libelle: "Fermer la discussion", action: onFermer },
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
    </header>
  );
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

function ListeMessages({
  messages,
  moiId,
  onRenvoyer,
}: {
  messages: MessageLocal[] | null;
  moiId: string;
  onRenvoyer: (id: string) => void;
}) {
  const zone = useRef<HTMLDivElement>(null);
  const separateur = useRef<HTMLDivElement>(null);
  const enBas = useRef(true);
  const initialise = useRef(false);
  const [boutonBas, setBoutonBas] = useState(false);
  // Le premier message non lu est relevé à l'ouverture : le repère reste en
  // place même une fois les messages marqués comme lus.
  const repere = useRef<{ id: string; nombre: number } | null | undefined>(undefined);
  if (messages && repere.current === undefined) {
    const nonLus = messages.filter((m) => m.de !== moiId && !m.lu);
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
    elements.push(
      <Bulle key={m.id} message={m} mien={m.de === moiId} premier={!precedent || precedent.de !== m.de} onRenvoyer={onRenvoyer} />,
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
  premier,
  onRenvoyer,
}: {
  message: MessageLocal;
  mien: boolean;
  premier: boolean;
  onRenvoyer: (id: string) => void;
}) {
  return (
    <div className={clsx("flex flex-col px-[5%] md:px-[7%]", mien ? "items-end" : "items-start", premier ? "mt-2.5" : "mt-0.5")}>
      <div
        className={clsx(
          "relative max-w-[min(85%,560px)] rounded-lg px-2.5 pt-1.5 pb-2 text-[14.5px] leading-[19px] text-texte shadow-sm md:max-w-[min(65%,560px)]",
          mien ? "bg-bulle-envoyee" : "bg-bulle-recue",
          premier && (mien ? "rounded-tr-none" : "rounded-tl-none"),
        )}
      >
        {premier && <Queue mien={mien} />}
        <span className="whitespace-pre-wrap [overflow-wrap:anywhere]">{m.texte}</span>
        {/* Réserve la place de l'heure sur la dernière ligne, qui s'y loge en bas à droite. */}
        <span aria-hidden="true" className={clsx("inline-block", mien ? "w-[68px]" : "w-[42px]")} />
        <span className="absolute right-2 bottom-1 flex items-center gap-1 text-[11px] text-texte-2">
          {heureCourte(m.le)}
          {mien && <Coches etat={m.etat} />}
        </span>
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

function Composeur({
  conversation,
  onEnvoyer,
  onEcrit,
}: {
  conversation: string;
  onEnvoyer: (texte: string) => void;
  onEcrit: () => void;
}) {
  const [texte, setTexte] = useState(() => brouillons.get(conversation) ?? "");
  const champ = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    champ.current?.focus();
  }, []);
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
    <footer className="flex shrink-0 items-end gap-2 bg-entete px-3 py-2.5 md:px-4">
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
    </footer>
  );
}
