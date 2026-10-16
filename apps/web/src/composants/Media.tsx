import type { MediaMessage } from "@unichat/shared";
import clsx from "clsx";
import { Download, FileText, Headphones, LoaderCircle, Mic, Pause, Play, RotateCw, Video, X } from "lucide-react";
import { useEffect, useRef, useState, type ReactNode, type RefObject } from "react";
import { ErreurApi } from "../lib/api";
import { dureeCourte, heureCourte, jourMessage, tailleFichier } from "../lib/format";
import { useMessagerie } from "../lib/messagerie-react";
import type { MessageLocal } from "../lib/stockage";

export type MessageAvecMedia = MessageLocal & { media: MediaMessage };

type EtatFichier =
  | { statut: "verification" }
  | { statut: "absent" }
  | { statut: "chargement" }
  | { statut: "pret"; url: string }
  | { statut: "erreur"; message: string };

/** Devient vrai la première fois que l'élément approche de l'écran : l'historique ne se télécharge pas d'un bloc. */
function useVisible(ref: RefObject<HTMLElement | null>): boolean {
  const [visible, setVisible] = useState(false);
  useEffect(() => {
    const element = ref.current;
    if (!element || visible) return;
    if (typeof IntersectionObserver === "undefined") {
      setVisible(true);
      return;
    }
    const observateur = new IntersectionObserver(
      (entrees) => {
        if (entrees.some((e) => e.isIntersecting)) {
          setVisible(true);
          observateur.disconnect();
        }
      },
      { rootMargin: "200px" },
    );
    observateur.observe(element);
    return () => observateur.disconnect();
  }, [ref, visible]);
  return visible;
}

/**
 * Le fichier d'un message : d'abord celui de l'appareil, sinon téléchargé —
 * d'office pour les photos et les messages vocaux, à la demande pour les
 * vidéos et les documents, qui pèsent plus lourd sur un forfait mobile.
 */
function useFichier(message: MessageLocal, auto: boolean) {
  const { messagerie } = useMessagerie();
  const [etat, setEtat] = useState<EtatFichier>({ statut: "verification" });
  const [demandes, setDemandes] = useState(0);
  const id = message.id;
  const mediaId = message.media?.id ?? "";
  const voulu = auto || demandes > 0;

  useEffect(() => {
    let annule = false;
    let lien: string | null = null;
    void (async () => {
      const local = await messagerie.fichierLocal(id);
      if (annule) return;
      if (local) {
        lien = URL.createObjectURL(local);
        setEtat({ statut: "pret", url: lien });
        return;
      }
      if (!mediaId || !voulu) {
        setEtat({ statut: "absent" });
        return;
      }
      setEtat({ statut: "chargement" });
      try {
        const blob = await messagerie.recupererFichier(id, mediaId);
        if (annule) return;
        lien = URL.createObjectURL(blob);
        setEtat({ statut: "pret", url: lien });
      } catch (e) {
        if (annule) return;
        // Le serveur ne garde les fichiers que 30 jours : passé ce délai, seul l'appareil qui l'a reçu l'a encore.
        setEtat({ statut: "erreur", message: e instanceof ErreurApi && e.statut === 404 ? "Fichier expiré" : "Échec du téléchargement" });
      }
    })();
    return () => {
      annule = true;
      if (lien) URL.revokeObjectURL(lien);
    };
  }, [messagerie, id, mediaId, voulu, demandes]);

  return { etat, telecharger: () => setDemandes((n) => n + 1) };
}

/** Enregistre un fichier dans les téléchargements du navigateur. */
export function enregistrer(url: string, nom: string): void {
  const lien = document.createElement("a");
  lien.href = url;
  lien.download = nom;
  lien.rel = "noopener";
  document.body.append(lien);
  lien.click();
  lien.remove();
}

/** Part envoyée, en anneau : affichée sur la photo ou le document tant que l'envoi n'est pas fini. */
function Anneau({ part, taille = 48, pourcentage = true }: { part: number; taille?: number; pourcentage?: boolean }) {
  const rayon = 18;
  const circonference = 2 * Math.PI * rayon;
  return (
    <span className="relative flex items-center justify-center" style={{ width: taille, height: taille }}>
      <svg viewBox="0 0 44 44" className="absolute inset-0 size-full -rotate-90" aria-hidden="true">
        <circle cx="22" cy="22" r={rayon} fill="none" stroke="currentColor" strokeOpacity="0.25" strokeWidth="3" />
        <circle
          cx="22"
          cy="22"
          r={rayon}
          fill="none"
          stroke="currentColor"
          strokeWidth="3"
          strokeLinecap="round"
          strokeDasharray={circonference}
          strokeDashoffset={circonference * (1 - Math.max(0.03, part))}
          className="transition-[stroke-dashoffset] duration-300"
        />
      </svg>
      {pourcentage && <span className="text-[11px] tabular-nums">{Math.round(part * 100)} %</span>}
      <span className="sr-only">Envoi en cours</span>
    </span>
  );
}

export function ContenuMedia({
  message,
  progression,
  surImage,
  onOuvrir,
}: {
  message: MessageAvecMedia;
  /** Part déjà envoyée, pour mes fichiers en cours d'envoi. */
  progression: number | undefined;
  /** Heure et coches posées sur la photo quand elle n'a pas de légende. */
  surImage?: ReactNode;
  onOuvrir: (url: string) => void;
}) {
  switch (message.media.type) {
    case "image":
    case "video":
      return <MediaVisuel message={message} progression={progression} surImage={surImage} onOuvrir={onOuvrir} />;
    case "audio":
      return <MessageAudio message={message} progression={progression} />;
    default:
      return <DocumentJoint message={message} progression={progression} />;
  }
}

function MediaVisuel({
  message,
  progression,
  surImage,
  onOuvrir,
}: {
  message: MessageAvecMedia;
  progression: number | undefined;
  surImage?: ReactNode;
  onOuvrir: (url: string) => void;
}) {
  const m = message.media;
  const cadre = useRef<HTMLDivElement>(null);
  const visible = useVisible(cadre);
  const { etat, telecharger } = useFichier(message, visible && m.type === "image");
  // Les formats extrêmes (panoramas, captures d'écran très hautes) sont recadrés dans la bulle, entiers dans la visionneuse.
  const ratio = m.largeur && m.hauteur ? Math.min(1.9, Math.max(0.6, m.largeur / m.hauteur)) : 4 / 3;
  const libelle = m.type === "image" ? "Photo" : "Vidéo";

  let indicateur: ReactNode = null;
  let action: (() => void) | null = null;
  if (progression !== undefined) {
    indicateur = (
      <span className="rounded-full bg-pastille-media text-sur-visionneuse">
        <Anneau part={progression} />
      </span>
    );
  } else if (etat.statut === "chargement" || (etat.statut === "verification" && !m.apercu)) {
    indicateur = (
      <span className="flex size-12 items-center justify-center rounded-full bg-pastille-media text-sur-visionneuse">
        <LoaderCircle size={24} className="animate-spin" />
      </span>
    );
  } else if (etat.statut === "absent") {
    action = telecharger;
    indicateur = (
      <span className="flex items-center gap-1.5 rounded-full bg-pastille-media px-3.5 py-2 text-[13px] text-sur-visionneuse">
        <Download size={17} /> {tailleFichier(m.taille)}
      </span>
    );
  } else if (etat.statut === "erreur") {
    action = telecharger;
    indicateur = (
      <span className="flex items-center gap-1.5 rounded-full bg-pastille-media px-3.5 py-2 text-[13px] text-sur-visionneuse">
        <RotateCw size={16} /> {etat.message}
      </span>
    );
  } else if (etat.statut === "pret") {
    const url = etat.url;
    action = () => onOuvrir(url);
    if (m.type === "video") {
      indicateur = (
        <span className="flex size-12 items-center justify-center rounded-full bg-pastille-media text-sur-visionneuse">
          <Play size={24} className="translate-x-px" fill="currentColor" />
        </span>
      );
    }
  }

  return (
    <div
      ref={cadre}
      className="relative w-[min(330px,68vw)] overflow-hidden rounded-md bg-texte/10"
      style={{ aspectRatio: String(ratio) }}
    >
      {m.apercu && <img src={m.apercu} alt="" aria-hidden="true" className="absolute inset-0 size-full scale-110 object-cover blur-lg" />}
      {etat.statut === "pret" &&
        (m.type === "image" ? (
          <img src={etat.url} alt={message.texte || libelle} className="animate-fade absolute inset-0 size-full object-cover" />
        ) : (
          // « #t=0.1 » : le navigateur affiche la première image au lieu d'un cadre noir.
          <video src={`${etat.url}#t=0.1`} muted playsInline preload="metadata" className="animate-fade absolute inset-0 size-full object-cover" />
        ))}
      <button
        type="button"
        onClick={action ?? undefined}
        disabled={!action}
        aria-label={etat.statut === "pret" ? `Ouvrir la ${libelle.toLowerCase()}` : `Télécharger la ${libelle.toLowerCase()}`}
        className="absolute inset-0 flex items-center justify-center disabled:cursor-default"
      >
        {indicateur && <span className="animate-fade">{indicateur}</span>}
      </button>
      {m.type === "video" && m.duree !== undefined && (
        <span className="pointer-events-none absolute bottom-1.5 left-1.5 flex items-center gap-1 rounded bg-pastille-media px-1.5 py-0.5 text-[11px] text-sur-visionneuse">
          <Video size={13} /> {dureeCourte(m.duree)}
        </span>
      )}
      {surImage}
    </div>
  );
}

// Un seul son à la fois : lancer un message vocal arrête celui qui jouait.
let lectureEnCours: HTMLAudioElement | null = null;
const VITESSES = [1, 1.5, 2];

function MessageAudio({ message, progression }: { message: MessageAvecMedia; progression: number | undefined }) {
  const m = message.media;
  const cadre = useRef<HTMLDivElement>(null);
  const audio = useRef<HTMLAudioElement>(null);
  const visible = useVisible(cadre);
  const { etat, telecharger } = useFichier(message, visible);
  const [lecture, setLecture] = useState(false);
  const [position, setPosition] = useState(0);
  const [duree, setDuree] = useState(m.duree ?? 0);
  const [vitesse, setVitesse] = useState(1);
  const pret = etat.statut === "pret";

  useEffect(() => {
    if (audio.current) audio.current.playbackRate = vitesse;
  }, [vitesse, pret]);

  function basculer() {
    if (!pret) {
      telecharger();
      return;
    }
    const a = audio.current;
    if (!a) return;
    if (a.paused) void a.play().catch(() => setLecture(false));
    else a.pause();
  }

  let bouton: ReactNode;
  let libelle: string;
  if (etat.statut === "chargement" || etat.statut === "verification") {
    bouton = <LoaderCircle size={22} className="animate-spin" />;
    libelle = "Chargement";
  } else if (etat.statut === "erreur") {
    bouton = <RotateCw size={20} />;
    libelle = `${etat.message} : réessayer`;
  } else if (etat.statut === "absent") {
    bouton = <Download size={20} />;
    libelle = "Télécharger";
  } else {
    bouton = lecture ? <Pause size={22} fill="currentColor" /> : <Play size={22} fill="currentColor" className="translate-x-px" />;
    libelle = lecture ? "Pause" : "Lire";
  }

  return (
    <div ref={cadre} className="flex w-[min(300px,64vw)] items-center gap-2.5 pt-1">
      <span
        className={clsx(
          "flex size-11 shrink-0 items-center justify-center rounded-full",
          m.vocal ? "bg-primaire-doux text-primaire-texte" : "bg-primaire text-sur-primaire",
        )}
        aria-hidden="true"
      >
        {progression !== undefined ? <Anneau part={progression} taille={40} pourcentage={false} /> : m.vocal ? <Mic size={21} /> : <Headphones size={20} />}
      </span>
      <button
        type="button"
        onClick={basculer}
        aria-label={libelle}
        title={libelle}
        className="flex size-9 shrink-0 items-center justify-center rounded-full text-texte-2 transition-colors hover:bg-texte/10"
      >
        {bouton}
      </button>
      <div className="min-w-0 flex-1">
        <input
          type="range"
          min={0}
          max={duree || 1}
          step={0.01}
          value={Math.min(position, duree || 1)}
          disabled={!pret}
          onChange={(e) => {
            const valeur = Number(e.target.value);
            if (audio.current) audio.current.currentTime = valeur;
            setPosition(valeur);
          }}
          aria-label="Position dans le message"
          className="block h-4 w-full cursor-pointer accent-primaire disabled:cursor-default"
        />
        <div className="flex h-[15px] items-center gap-2 text-[11px] tabular-nums text-texte-2">
          <span>{dureeCourte(lecture || position > 0 ? position : duree)}</span>
          {(lecture || position > 0) && (
            <button
              type="button"
              onClick={() => setVitesse((v) => VITESSES[(VITESSES.indexOf(v) + 1) % VITESSES.length]!)}
              aria-label={`Vitesse de lecture : ${vitesse} fois`}
              title="Vitesse de lecture"
              className="animate-fade rounded-full bg-texte/10 px-1.5 font-medium text-texte"
            >
              {String(vitesse).replace(".", ",")}×
            </button>
          )}
        </div>
      </div>
      {pret && (
        <audio
          ref={audio}
          src={etat.url}
          preload="metadata"
          onPlay={(e) => {
            if (lectureEnCours && lectureEnCours !== e.currentTarget) lectureEnCours.pause();
            lectureEnCours = e.currentTarget;
            setLecture(true);
          }}
          onPause={() => setLecture(false)}
          onEnded={() => {
            setLecture(false);
            setPosition(0);
          }}
          onTimeUpdate={(e) => setPosition(e.currentTarget.currentTime)}
          onLoadedMetadata={(e) => Number.isFinite(e.currentTarget.duration) && setDuree(e.currentTarget.duration)}
        />
      )}
    </div>
  );
}

function DocumentJoint({ message, progression }: { message: MessageAvecMedia; progression: number | undefined }) {
  const m = message.media;
  const { etat, telecharger } = useFichier(message, false);
  // Après un clic sur « Télécharger », le fichier est enregistré dès qu'il est arrivé.
  const aEnregistrer = useRef(false);
  const extension = (m.nom.includes(".") ? m.nom.split(".").pop()! : m.mime.split("/").pop()!).toUpperCase().slice(0, 5);

  useEffect(() => {
    if (etat.statut === "pret" && aEnregistrer.current) {
      aEnregistrer.current = false;
      enregistrer(etat.url, m.nom);
    }
  }, [etat, m.nom]);

  function cliquer() {
    if (etat.statut === "pret") enregistrer(etat.url, m.nom);
    else if (etat.statut === "absent" || etat.statut === "erreur") {
      aEnregistrer.current = true;
      telecharger();
    }
  }

  let indicateur: ReactNode;
  if (progression !== undefined) indicateur = <Anneau part={progression} taille={30} pourcentage={false} />;
  else if (etat.statut === "chargement" || etat.statut === "verification") indicateur = <LoaderCircle size={18} className="animate-spin" />;
  else if (etat.statut === "erreur") indicateur = <RotateCw size={17} />;
  else indicateur = <Download size={18} />;

  return (
    <button
      type="button"
      onClick={cliquer}
      title={etat.statut === "erreur" ? etat.message : `Télécharger ${m.nom}`}
      className="flex w-[min(320px,66vw)] items-center gap-3 rounded-md bg-texte/5 p-2.5 text-left transition-colors hover:bg-texte/10"
    >
      <span className="flex size-10 shrink-0 items-center justify-center rounded bg-primaire-doux text-primaire-texte" aria-hidden="true">
        <FileText size={22} />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[14px] text-texte">{m.nom}</span>
        <span className="block text-[12px] text-texte-2">
          {extension} · {tailleFichier(m.taille)}
          {etat.statut === "erreur" && <span className="text-danger"> · {etat.message}</span>}
        </span>
      </span>
      <span className="flex size-8 shrink-0 items-center justify-center rounded-full text-texte-2 ring-1 ring-bordure">{indicateur}</span>
    </button>
  );
}

/** Photo ou vidéo en plein écran, sur fond sombre quel que soit le thème. */
export function Visionneuse({ message, url, auteur, onFermer }: { message: MessageAvecMedia; url: string; auteur: string; onFermer: () => void }) {
  const fermer = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    fermer.current?.focus();
    const echap = (e: KeyboardEvent) => e.key === "Escape" && onFermer();
    window.addEventListener("keydown", echap);
    return () => window.removeEventListener("keydown", echap);
  }, [onFermer]);

  const bouton = "inline-flex size-10 shrink-0 items-center justify-center rounded-full text-sur-visionneuse/80 transition-colors hover:bg-sur-visionneuse/10 hover:text-sur-visionneuse";
  const m = message.media;
  return (
    <div role="dialog" aria-modal="true" aria-label={m.type === "image" ? "Photo" : "Vidéo"} className="animate-fade fixed inset-0 z-50 flex flex-col bg-visionneuse text-sur-visionneuse">
      <header className="flex h-[60px] shrink-0 items-center gap-2 px-3 md:px-5">
        <div className="min-w-0 flex-1">
          <p className="truncate text-[15px]">{auteur}</p>
          <p className="text-[12.5px] text-sur-visionneuse/65">
            {jourMessage(message.le)} à {heureCourte(message.le)}
          </p>
        </div>
        <button type="button" onClick={() => enregistrer(url, m.nom)} aria-label="Télécharger" title="Télécharger" className={bouton}>
          <Download size={21} />
        </button>
        <button ref={fermer} type="button" onClick={onFermer} aria-label="Fermer" title="Fermer" className={bouton}>
          <X size={23} />
        </button>
      </header>
      <div className="flex min-h-0 flex-1 items-center justify-center px-4 pb-4" onClick={onFermer}>
        {m.type === "image" ? (
          <img
            src={url}
            alt={message.texte || "Photo"}
            onClick={(e) => e.stopPropagation()}
            className="animate-rise max-h-full max-w-full object-contain"
          />
        ) : (
          <video src={url} controls autoPlay playsInline onClick={(e) => e.stopPropagation()} className="animate-rise max-h-full max-w-full" />
        )}
      </div>
      {message.texte && (
        <p className="mx-auto max-w-2xl shrink-0 px-6 pb-6 text-center text-[14.5px] leading-relaxed whitespace-pre-wrap [overflow-wrap:anywhere]">
          {message.texte}
        </p>
      )}
    </div>
  );
}
