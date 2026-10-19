import { SendHorizontal, Trash2 } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { dureeCourte } from "../lib/format";
import { niveauInstantane } from "../lib/onde";
import { BoutonIcone } from "./BoutonIcone";

/** Barres visibles pendant l'enregistrement, la plus récente à droite ; celles qui débordent à gauche sont masquées. */
const BARRES_DIRECT = 56;
const RYTHME_ONDE = 90;

/** 15 minutes : environ 4 Mo en Opus à 32 kbit/s, loin de la limite de 16 Mo. */
const DUREE_MAX = 15 * 60;
/** Un appui accidentel sur le micro ne doit pas partir comme message. */
const DUREE_MIN = 0.8;
// Opus est le plus léger à qualité égale ; Safari ne sait produire que du MP4.
const FORMATS = ["audio/webm;codecs=opus", "audio/ogg;codecs=opus", "audio/mp4", "audio/webm"];

/**
 * Enregistrement d'un message vocal : la barre remplace le champ de saisie
 * tant que le micro écoute. L'audio ne quitte l'appareil qu'à l'envoi.
 */
export function Enregistrement({
  onAnnuler,
  onTerminer,
  onErreur,
}: {
  onAnnuler: () => void;
  onTerminer: (blob: Blob, duree: number) => void;
  onErreur: (message: string) => void;
}) {
  const [debut, setDebut] = useState<number | null>(null);
  const [ecoule, setEcoule] = useState(0);
  const [onde, setOnde] = useState<number[]>(() => Array.from({ length: BARRES_DIRECT }, () => 0));
  const analyseur = useRef<AnalyserNode | null>(null);
  const enregistreur = useRef<MediaRecorder | null>(null);
  const envoyerALaFin = useRef(false);
  const rappels = useRef({ onTerminer, onErreur });

  useEffect(() => {
    rappels.current = { onTerminer, onErreur };
  }, [onTerminer, onErreur]);

  useEffect(() => {
    let annule = false;
    let flux: MediaStream | null = null;
    let rec: MediaRecorder | null = null;
    let ecoute: AudioContext | null = null;
    const couperMicro = () => {
      flux?.getTracks().forEach((piste) => piste.stop());
      void ecoute?.close().catch(() => undefined);
      analyseur.current = null;
    };

    void (async () => {
      if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === "undefined") {
        rappels.current.onErreur("Ce navigateur ne permet pas d'enregistrer un message vocal.");
        return;
      }
      try {
        flux = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } });
      } catch {
        if (!annule) rappels.current.onErreur("L'accès au micro a été refusé. Autorisez-le dans les réglages du navigateur.");
        return;
      }
      if (annule) {
        couperMicro();
        return;
      }
      // Le niveau du micro, pour voir que le son passe ; sans lui, l'enregistrement fonctionne quand même.
      try {
        ecoute = new AudioContext();
        const noeud = ecoute.createAnalyser();
        noeud.fftSize = 1024;
        ecoute.createMediaStreamSource(flux).connect(noeud);
        analyseur.current = noeud;
        void ecoute.resume().catch(() => undefined);
      } catch {
        ecoute = null;
      }
      const format = FORMATS.find((f) => MediaRecorder.isTypeSupported(f));
      const morceaux: Blob[] = [];
      rec = new MediaRecorder(flux, { ...(format ? { mimeType: format } : {}), audioBitsPerSecond: 32_000 });
      const depart = Date.now();
      rec.ondataavailable = (e) => {
        if (e.data.size > 0) morceaux.push(e.data);
      };
      rec.onstop = () => {
        couperMicro();
        if (!envoyerALaFin.current) return;
        const duree = (Date.now() - depart) / 1000;
        if (duree < DUREE_MIN) {
          rappels.current.onErreur("Message vocal trop court.");
          return;
        }
        rappels.current.onTerminer(new Blob(morceaux, { type: rec?.mimeType || format || "audio/webm" }), duree);
      };
      rec.start(1000);
      enregistreur.current = rec;
      setDebut(depart);
    })();

    return () => {
      annule = true;
      envoyerALaFin.current = false;
      if (rec && rec.state !== "inactive") rec.stop();
      else couperMicro();
    };
  }, []);

  useEffect(() => {
    if (debut === null) return;
    const minuterie = setInterval(() => {
      const secondes = (Date.now() - debut) / 1000;
      setEcoule(secondes);
      if (secondes >= DUREE_MAX) terminer();
    }, 250);
    return () => clearInterval(minuterie);
  }, [debut]);

  useEffect(() => {
    if (debut === null) return;
    const tampon = new Float32Array(1024);
    const minuterie = setInterval(() => {
      const noeud = analyseur.current;
      if (!noeud) return;
      const niveau = niveauInstantane(noeud, tampon);
      setOnde((avant) => [...avant.slice(1), niveau]);
    }, RYTHME_ONDE);
    return () => clearInterval(minuterie);
  }, [debut]);

  function terminer() {
    const rec = enregistreur.current;
    if (!rec || rec.state === "inactive") return;
    envoyerALaFin.current = true;
    rec.stop();
  }

  return (
    <div className="animate-fade flex items-center gap-2 px-3 py-2.5 md:px-4" role="group" aria-label="Enregistrement d'un message vocal">
      <BoutonIcone libelle="Supprimer l'enregistrement" onClick={onAnnuler}>
        <Trash2 size={21} className="text-danger" />
      </BoutonIcone>
      <div className="flex min-h-[42px] flex-1 items-center gap-3 rounded-lg bg-panneau px-4">
        <span className={debut === null ? "size-2.5 rounded-full bg-texte-3" : "enregistrement size-2.5 rounded-full bg-danger"} aria-hidden="true" />
        <span className="text-[15px] tabular-nums text-texte" aria-live="off">
          {dureeCourte(ecoule)}
        </span>
        {debut === null ? (
          <span className="truncate text-sm text-texte-2">Accès au micro…</span>
        ) : (
          <>
            <span className="sr-only">Enregistrement en cours</span>
            <span className="animate-fade flex h-7 min-w-0 flex-1 items-center justify-end gap-[2px] overflow-hidden" aria-hidden="true">
              {onde.map((niveau, i) => (
                <span key={i} className="w-[3px] shrink-0 rounded-full bg-texte-2" style={{ height: `${Math.round(3 + niveau * 23)}px` }} />
              ))}
            </span>
          </>
        )}
      </div>
      <button
        type="button"
        onClick={terminer}
        disabled={debut === null}
        aria-label="Envoyer le message vocal"
        title="Envoyer"
        className="flex size-[42px] shrink-0 items-center justify-center rounded-full bg-primaire text-sur-primaire transition-opacity hover:bg-primaire-fort disabled:opacity-40"
      >
        <SendHorizontal size={20} />
      </button>
    </div>
  );
}
