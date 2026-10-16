import { DUREES_EPHEMERES, SONDAGE, type CarteProfil, type Position, type Sondage } from "@unichat/shared";
import clsx from "clsx";
import { Check, ExternalLink, Eye, LoaderCircle, MapPin, MessageSquareText, Plus, Search, Timer, UserPlus, X } from "lucide-react";
import { useEffect, useState } from "react";
import { api } from "../lib/api";
import { useMessagerie } from "../lib/messagerie-react";
import type { MessageLocal } from "../lib/stockage";
import { Avatar } from "./Avatar";
import { BoutonIcone } from "./BoutonIcone";
import { Case } from "./Case";
import { Dialogue } from "./Dialogue";
import { Apparition } from "./Apparition";

// --- Position -------------------------------------------------------------------------

const lienCarte = (p: Position) => `https://www.openstreetmap.org/?mlat=${p.lat}&mlon=${p.lon}#map=16/${p.lat}/${p.lon}`;

/**
 * Position partagée : sans fond de carte, qui viendrait d'un serveur tiers
 * et révélerait chaque ouverture ; un lien ouvre OpenStreetMap à la demande.
 */
export function CartePosition({ position }: { position: Position }) {
  return (
    <a
      href={lienCarte(position)}
      target="_blank"
      rel="noopener noreferrer nofollow"
      onClick={(e) => e.stopPropagation()}
      className="flex w-[280px] max-w-full items-center gap-3 rounded-md bg-texte/5 p-2.5 transition-colors hover:bg-texte/10"
    >
      <span className="flex size-11 shrink-0 items-center justify-center rounded-md bg-primaire-doux text-primaire-texte">
        <MapPin size={22} />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block text-[14px] font-medium text-texte">Position</span>
        <span className="block truncate text-[12.5px] tabular-nums text-texte-2">
          {position.lat.toFixed(5)}, {position.lon.toFixed(5)}
          {position.precision !== undefined && ` · ${Math.round(position.precision)} m`}
        </span>
        <span className="mt-0.5 flex items-center gap-1 text-[12.5px] text-primaire-texte">
          Ouvrir dans OpenStreetMap <ExternalLink size={12} />
        </span>
      </span>
    </a>
  );
}

export function DialoguePosition({ onEnvoyer, onFermer }: { onEnvoyer: (p: Position) => void; onFermer: () => void }) {
  const [position, setPosition] = useState<Position | null>(null);
  const [erreur, setErreur] = useState<string | null>(null);

  useEffect(() => {
    if (!("geolocation" in navigator)) {
      setErreur("Ce navigateur ne sait pas donner sa position.");
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (p) => setPosition({ lat: p.coords.latitude, lon: p.coords.longitude, precision: p.coords.accuracy }),
      (e) => setErreur(e.code === e.PERMISSION_DENIED ? "L'accès à la position a été refusé. Autorisez-le dans les réglages du navigateur." : "Position introuvable pour le moment."),
      { enableHighAccuracy: true, timeout: 15_000, maximumAge: 30_000 },
    );
  }, []);

  return (
    <Dialogue
      titre="Envoyer votre position"
      confirmer="Envoyer"
      enCours={!position}
      onConfirmer={() => position && onEnvoyer(position)}
      onFermer={onFermer}
    >
      {erreur ? (
        <p className="text-danger">{erreur}</p>
      ) : position ? (
        <>
          <p>Votre position actuelle sera envoyée dans la discussion, une seule fois : elle ne se met pas à jour ensuite.</p>
          <div className="mt-4">
            <CartePosition position={position} />
          </div>
        </>
      ) : (
        <p className="flex items-center gap-3">
          <LoaderCircle size={18} className="animate-spin" /> Recherche de votre position…
        </p>
      )}
    </Dialogue>
  );
}

// --- Contact -------------------------------------------------------------------------------

export function CarteContact({ contact, onMessage }: { contact: NonNullable<MessageLocal["contact"]>; onMessage: (id: string) => void }) {
  const { messagerie, etat } = useMessagerie();
  const connue = etat.personnes[contact.id];
  const [ajout, setAjout] = useState<"oui" | "en-cours" | null>(null);
  const estSoi = contact.id === messagerie.moi;

  async function ajouter() {
    setAjout("en-cours");
    try {
      messagerie.retenirPersonne(await api.ajouterContact(contact.id));
      setAjout("oui");
    } catch {
      setAjout(null);
    }
  }

  return (
    <div className="w-[280px] max-w-full overflow-hidden rounded-md bg-texte/5">
      <div className="flex items-center gap-3 p-2.5">
        <Avatar id={contact.id} photo={connue?.photo ?? null} nom={contact.nom} taille={44} />
        <span className="min-w-0 flex-1">
          <span className="block truncate text-[14.5px] font-medium text-texte">{contact.nom}</span>
          {contact.pseudo && <span className="block truncate text-[12.5px] text-texte-2">@{contact.pseudo}</span>}
        </span>
      </div>
      {!estSoi && (
        <div className="flex border-t border-bordure">
          <button
            type="button"
            onClick={() => onMessage(contact.id)}
            className="flex flex-1 items-center justify-center gap-1.5 py-2 text-[13.5px] font-medium text-primaire-texte transition-colors hover:bg-texte/5"
          >
            <MessageSquareText size={15} /> Écrire
          </button>
          {!(connue?.estContact || ajout === "oui") && (
            <button
              type="button"
              onClick={() => void ajouter()}
              disabled={ajout === "en-cours"}
              className="flex flex-1 items-center justify-center gap-1.5 border-l border-bordure py-2 text-[13.5px] font-medium text-primaire-texte transition-colors hover:bg-texte/5 disabled:opacity-60"
            >
              {ajout === "en-cours" ? <LoaderCircle size={15} className="animate-spin" /> : <UserPlus size={15} />} Ajouter
            </button>
          )}
        </div>
      )}
    </div>
  );
}

export function DialogueContact({ onEnvoyer, onFermer }: { onEnvoyer: (c: CarteProfil) => void; onFermer: () => void }) {
  const [contacts, setContacts] = useState<CarteProfil[] | null>(null);
  const [choix, setChoix] = useState<CarteProfil | null>(null);
  const [recherche, setRecherche] = useState("");

  useEffect(() => {
    api.contacts().then(
      (r) => setContacts(r.contacts),
      () => setContacts([]),
    );
  }, []);

  const texte = recherche.trim().toLowerCase();
  const liste = (contacts ?? []).filter((c) => !texte || c.nom.toLowerCase().includes(texte));

  return (
    <Dialogue titre="Partager un contact" confirmer="Envoyer" enCours={!choix} onConfirmer={() => choix && onEnvoyer(choix)} onFermer={onFermer}>
      <label className="flex h-10 items-center gap-3 rounded-lg bg-champ px-3">
        <Search size={17} className="shrink-0 text-texte-2" />
        <input
          value={recherche}
          onChange={(e) => setRecherche(e.target.value)}
          placeholder="Rechercher un contact"
          aria-label="Rechercher un contact"
          className="min-w-0 flex-1 bg-transparent text-[15px] text-texte outline-none placeholder:text-texte-2"
        />
      </label>
      <div role="radiogroup" aria-label="Contact" className="mt-3 max-h-[320px] overflow-y-auto">
        {contacts === null && (
          <p className="flex justify-center py-6">
            <LoaderCircle size={18} className="animate-spin" />
          </p>
        )}
        {contacts?.length === 0 && <p className="py-6 text-center">Vous n'avez pas encore de contact.</p>}
        {liste.map((c) => (
          <button
            key={c.id}
            type="button"
            role="radio"
            aria-checked={choix?.id === c.id}
            onClick={() => setChoix(c)}
            className={clsx("flex w-full items-center gap-3 rounded-md px-2 py-2 text-left transition-colors", choix?.id === c.id ? "bg-selection" : "hover:bg-survol")}
          >
            <Avatar id={c.id} photo={c.photo} nom={c.nom} taille={36} />
            <span className="min-w-0 flex-1 truncate text-[15px] text-texte">{c.nom}</span>
            {choix?.id === c.id && <Check size={18} className="text-primaire" />}
          </button>
        ))}
      </div>
    </Dialogue>
  );
}

// --- Sondage -------------------------------------------------------------------------------

export function BlocSondage({
  message,
  moiId,
  nom,
  onVoter,
}: {
  message: MessageLocal & { sondage: Sondage };
  moiId: string;
  nom: (id: string) => string;
  onVoter: (choix: number[]) => void;
}) {
  const s = message.sondage;
  const votes = message.votes ?? {};
  const mesChoix = votes[moiId] ?? [];
  const votants = Object.keys(votes).length;
  const [details, setDetails] = useState(false);
  const compte = s.options.map((_, i) => Object.values(votes).filter((c) => c.includes(i)).length);
  const maximum = Math.max(1, ...compte);

  function basculer(i: number) {
    if (s.multiple) onVoter(mesChoix.includes(i) ? mesChoix.filter((c) => c !== i) : [...mesChoix, i].sort());
    else onVoter(mesChoix[0] === i ? [] : [i]);
  }

  return (
    <div className="w-[300px] max-w-full">
      <p className="text-[15px] font-medium text-texte">{s.question}</p>
      <p className="mt-0.5 text-[12.5px] text-texte-2">{s.multiple ? "Choisissez une ou plusieurs options" : "Choisissez une option"}</p>
      <div className="mt-2.5 space-y-2.5">
        {s.options.map((option, i) => {
          const choisi = mesChoix.includes(i);
          return (
            <button
              key={i}
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                basculer(i);
              }}
              role={s.multiple ? "checkbox" : "radio"}
              aria-checked={choisi}
              className="block w-full text-left"
            >
              <span className="flex items-center gap-2.5">
                <span
                  aria-hidden="true"
                  className={clsx(
                    "flex size-5 shrink-0 items-center justify-center border-2 transition-colors",
                    s.multiple ? "rounded-[4px]" : "rounded-full",
                    choisi ? "border-primaire bg-primaire" : "border-texte-3",
                  )}
                >
                  {choisi && <Check size={13} strokeWidth={3} className="text-sur-primaire" />}
                </span>
                <span className="min-w-0 flex-1 text-[14.5px] text-texte">{option}</span>
                <span className="text-[12.5px] tabular-nums text-texte-2">{compte[i]}</span>
              </span>
              <span className="mt-1.5 ml-[30px] block h-1.5 overflow-hidden rounded-full bg-texte/10">
                <span className="block h-full rounded-full bg-primaire transition-[width] duration-300" style={{ width: `${(compte[i]! / maximum) * 100}%` }} />
              </span>
            </button>
          );
        })}
      </div>
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          setDetails(true);
        }}
        disabled={votants === 0}
        className="mt-3 w-full border-t border-bordure pt-2 text-center text-[13.5px] font-medium text-primaire-texte disabled:text-texte-3"
      >
        {votants === 0 ? "Aucun vote" : `Voir les votes (${votants})`}
      </button>
      <Apparition>
        {details && (
          <Dialogue titre="Votes" confirmer="Fermer" annuler={false} onConfirmer={() => setDetails(false)} onFermer={() => setDetails(false)}>
            <p className="font-medium text-texte">{s.question}</p>
            {s.options.map((option, i) => {
              const qui = Object.entries(votes).filter(([, c]) => c.includes(i)).map(([id]) => nom(id));
              return (
                <div key={i} className="mt-3">
                  <p className="flex justify-between text-[14px] text-texte">
                    <span>{option}</span>
                    <span className="tabular-nums text-texte-2">
                      {qui.length} vote{qui.length > 1 ? "s" : ""}
                    </span>
                  </p>
                  {qui.length > 0 && <p className="mt-0.5 text-[13px] text-texte-2">{qui.join(", ")}</p>}
                </div>
              );
            })}
          </Dialogue>
        )}
      </Apparition>
    </div>
  );
}

export function DialogueSondage({ onEnvoyer, onFermer }: { onEnvoyer: (s: Sondage) => void; onFermer: () => void }) {
  const [question, setQuestion] = useState("");
  const [options, setOptions] = useState(["", ""]);
  const [multiple, setMultiple] = useState(false);
  const remplies = options.map((o) => o.trim()).filter(Boolean);
  const valide = question.trim().length > 0 && remplies.length >= SONDAGE.optionsMin;

  return (
    <Dialogue
      titre="Créer un sondage"
      confirmer="Envoyer"
      enCours={!valide}
      onConfirmer={() => valide && onEnvoyer({ question: question.trim(), options: remplies, multiple })}
      onFermer={onFermer}
    >
      <label className="block text-[13px] text-texte-2">
        Question
        <input
          value={question}
          maxLength={SONDAGE.question}
          onChange={(e) => setQuestion(e.target.value)}
          placeholder="Posez une question"
          className="mt-1 w-full rounded-lg bg-champ px-3 py-2.5 text-[15px] text-texte outline-none placeholder:text-texte-3"
        />
      </label>
      <p className="mt-4 text-[13px] text-texte-2">Options</p>
      <div className="mt-1 max-h-[260px] space-y-2 overflow-y-auto">
        {options.map((o, i) => (
          <div key={i} className="flex items-center gap-2">
            <input
              value={o}
              maxLength={SONDAGE.option}
              onChange={(e) => setOptions((liste) => liste.map((x, j) => (j === i ? e.target.value : x)))}
              placeholder={`Option ${i + 1}`}
              aria-label={`Option ${i + 1}`}
              className="min-w-0 flex-1 rounded-lg bg-champ px-3 py-2 text-[15px] text-texte outline-none placeholder:text-texte-3"
            />
            {options.length > SONDAGE.optionsMin && (
              <BoutonIcone libelle={`Retirer l'option ${i + 1}`} onClick={() => setOptions((liste) => liste.filter((_, j) => j !== i))}>
                <X size={18} />
              </BoutonIcone>
            )}
          </div>
        ))}
      </div>
      {options.length < SONDAGE.optionsMax && (
        <button
          type="button"
          onClick={() => setOptions((liste) => [...liste, ""])}
          className="mt-2 inline-flex items-center gap-2 text-[14px] font-medium text-primaire-texte hover:underline"
        >
          <Plus size={16} /> Ajouter une option
        </button>
      )}
      <Case coche={multiple} onChange={setMultiple} className="mt-4 text-[15px] text-texte">
        Autoriser plusieurs réponses
      </Case>
    </Dialogue>
  );
}

// --- Messages éphémères ------------------------------------------------------------------

export function DialogueEphemere({
  actuelle,
  onChoisir,
  onFermer,
}: {
  actuelle: number | undefined;
  onChoisir: (duree: number | null) => void;
  onFermer: () => void;
}) {
  const [duree, setDuree] = useState<number | null>(actuelle ?? null);
  const choix: { libelle: string; duree: number | null }[] = [...DUREES_EPHEMERES, { libelle: "Désactivés", duree: null }];
  return (
    <Dialogue titre="Messages éphémères" confirmer="OK" onConfirmer={() => onChoisir(duree)} onFermer={onFermer}>
      <p className="flex gap-3">
        <Timer size={20} className="mt-0.5 shrink-0 text-primaire" />
        Les nouveaux messages disparaîtront de la discussion, chez chacun, une fois la durée écoulée. Ceux que vous marquez
        importants restent sur votre appareil.
      </p>
      <div role="radiogroup" aria-label="Durée" className="mt-4 flex flex-col">
        {choix.map((d) => (
          <label key={d.libelle} className="flex cursor-pointer items-center gap-4 py-2 text-[15px] text-texte">
            <input type="radio" name="ephemere" checked={duree === d.duree} onChange={() => setDuree(d.duree)} className="sr-only" />
            <span
              aria-hidden="true"
              className={clsx("flex size-5 items-center justify-center rounded-full border-2 transition-colors", duree === d.duree ? "border-primaire" : "border-texte-3")}
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

// --- Vue unique ----------------------------------------------------------------------------

/** Pastille d'une photo ou vidéo à vue unique, à la place de l'image. */
export function PastilleVueUnique({
  message,
  mien,
  enCours,
  onOuvrir,
}: {
  message: MessageLocal;
  mien: boolean;
  enCours: boolean;
  onOuvrir: () => void;
}) {
  const libelle = message.media?.type === "video" ? "Vidéo" : "Photo";
  const ouverte = mien ? (message.ouvertPar?.length ?? 0) > 0 : Boolean(message.vueOuverte);
  const ouvrable = !mien && !message.vueOuverte;
  return (
    <button
      type="button"
      onClick={(e) => {
        e.stopPropagation();
        if (ouvrable) onOuvrir();
      }}
      disabled={!ouvrable || enCours}
      className={clsx(
        "flex w-[220px] max-w-full items-center gap-3 rounded-md px-3 py-2.5 text-left",
        ouvrable ? "bg-primaire-doux transition-colors hover:bg-primaire-doux/70" : "bg-texte/5",
      )}
    >
      <span
        className={clsx(
          "flex size-8 shrink-0 items-center justify-center rounded-full border-2 border-dashed",
          ouvrable ? "border-primaire text-primaire" : "border-texte-3 text-texte-3",
        )}
      >
        {enCours ? <LoaderCircle size={16} className="animate-spin" /> : <Eye size={16} />}
      </span>
      <span className="min-w-0">
        <span className={clsx("block text-[14px]", ouvrable ? "font-medium text-primaire-texte" : "text-texte-2")}>{libelle}</span>
        <span className="block text-[12px] text-texte-2">{ouverte ? "Ouverte" : mien ? "Vue unique" : "Vue unique : touchez pour ouvrir"}</span>
      </span>
    </button>
  );
}
