import { LIMITES_MEDIA, LIMITE_TEXTE } from "@unichat/shared";
import clsx from "clsx";
import { CircleAlert, Eye, FileText, Headphones, LoaderCircle, Plus, SendHorizontal, Video, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { tailleFichier } from "../lib/format";
import { preparerFichier, type FichierPrepare } from "../lib/medias";
import { estTactile } from "../lib/appui";
import { useRetourSysteme } from "../lib/retour";
import { BoutonIcone } from "./BoutonIcone";

/** Au-delà, l'envoi groupé ressemble à un transfert de dossier : mieux vaut plusieurs fois. */
const MAX_FICHIERS = 10;

export const ACCEPTE_VISUELS = "image/jpeg,image/png,image/webp,image/gif,image/avif,video/mp4,video/webm,video/quicktime";
export const ACCEPTE_DOCUMENTS = `${ACCEPTE_VISUELS},application/pdf,text/plain,audio/mpeg,audio/mp4,audio/aac,audio/ogg,audio/wav,audio/webm,.m4a`;

interface Element {
  cle: string;
  source: File;
  fichier: FichierPrepare | null;
  url: string | null;
  erreur: string | null;
  legende: string;
}

const nouvel = (source: File): Element => ({ cle: crypto.randomUUID(), source, fichier: null, url: null, erreur: null, legende: "" });

/**
 * Aperçu avant envoi : les fichiers choisis sont préparés (photos réduites,
 * vignettes), affichés en grand, et chacun peut recevoir une légende.
 */
export function EnvoiFichiers({
  fichiers,
  destinataire,
  onAnnuler,
  onEnvoyer,
}: {
  fichiers: File[];
  destinataire: string;
  onAnnuler: () => void;
  onEnvoyer: (envois: { fichier: FichierPrepare; legende: string }[]) => void;
}) {
  const [elements, setElements] = useState<Element[]>(() => fichiers.slice(0, MAX_FICHIERS).map(nouvel));
  const [actif, setActif] = useState(0);
  const [vueUnique, setVueUnique] = useState(false);
  const lances = useRef(new Set<string>());
  const liens = useRef(new Set<string>());
  const ajout = useRef<HTMLInputElement>(null);
  const champ = useRef<HTMLInputElement>(null);

  useEffect(() => {
    for (const el of elements) {
      if (lances.current.has(el.cle)) continue;
      lances.current.add(el.cle);
      void preparerFichier(el.source)
        .then((f) => {
          const limite = LIMITES_MEDIA[f.type];
          if (f.blob.size > limite) throw new Error(`Trop lourd : ${tailleFichier(limite)} au maximum.`);
          const url = f.type === "image" || f.type === "video" ? URL.createObjectURL(f.blob) : null;
          if (url) liens.current.add(url);
          setElements((liste) => liste.map((x) => (x.cle === el.cle ? { ...x, fichier: f, url } : x)));
        })
        .catch((e: unknown) => {
          const message = e instanceof Error ? e.message : "Ce fichier ne peut pas être lu.";
          setElements((liste) => liste.map((x) => (x.cle === el.cle ? { ...x, erreur: message } : x)));
        });
    }
  }, [elements]);

  useEffect(() => {
    const ouverts = liens.current;
    return () => {
      for (const url of ouverts) URL.revokeObjectURL(url);
    };
  }, []);

  useRetourSysteme(true, onAnnuler);
  useEffect(() => {
    // Sur téléphone, le clavier couvrirait l'aperçu : il attend qu'on touche la légende.
    if (!estTactile()) champ.current?.focus();
    const echap = (e: KeyboardEvent) => e.key === "Escape" && onAnnuler();
    window.addEventListener("keydown", echap);
    return () => window.removeEventListener("keydown", echap);
  }, [onAnnuler]);

  const courant = elements[Math.min(actif, elements.length - 1)];
  const enPreparation = elements.some((e) => !e.fichier && !e.erreur);
  const prets = elements.filter((e): e is Element & { fichier: FichierPrepare } => e.fichier !== null);

  function retirer(cle: string) {
    const index = elements.findIndex((e) => e.cle === cle);
    const el = elements[index];
    if (el?.url) {
      URL.revokeObjectURL(el.url);
      liens.current.delete(el.url);
    }
    const reste = elements.filter((e) => e.cle !== cle);
    if (reste.length === 0) {
      onAnnuler();
      return;
    }
    setElements(reste);
    setActif((a) => Math.min(a > index ? a - 1 : a, reste.length - 1));
  }

  // Vue unique : une seule photo ou vidéo à la fois, comme dans WhatsApp.
  const vueUniquePossible = elements.length === 1 && (prets[0]?.fichier.type === "image" || prets[0]?.fichier.type === "video");

  function envoyer() {
    if (enPreparation || prets.length === 0) return;
    onEnvoyer(prets.map((e) => ({ fichier: vueUnique && vueUniquePossible ? { ...e.fichier, vueUnique: true } : e.fichier, legende: e.legende })));
  }

  return (
    <div className="animate-rise absolute inset-0 z-20 flex flex-col bg-entete" role="dialog" aria-modal="true" aria-label="Envoyer des fichiers">
      <header className="flex h-[60px] shrink-0 items-center gap-2 px-2 md:px-4">
        <BoutonIcone libelle="Annuler" onClick={onAnnuler}>
          <X size={22} />
        </BoutonIcone>
        <div className="min-w-0">
          <p className="truncate text-[15px] text-texte">{courant?.source.name}</p>
          <p className="truncate text-[12.5px] text-texte-2">Envoyer à {destinataire}</p>
        </div>
      </header>

      <div className="flex min-h-0 flex-1 items-center justify-center px-6 py-4">
        {courant && <Apercu key={courant.cle} element={courant} />}
      </div>

      <div className="mx-auto w-full max-w-2xl shrink-0 px-4 pb-3">
        <input
          ref={champ}
          value={courant?.legende ?? ""}
          maxLength={LIMITE_TEXTE}
          disabled={!courant?.fichier}
          onChange={(e) => {
            const legende = e.target.value;
            setElements((liste) => liste.map((x) => (x.cle === courant?.cle ? { ...x, legende } : x)));
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.nativeEvent.isComposing) {
              e.preventDefault();
              envoyer();
            }
          }}
          placeholder="Ajouter une légende"
          aria-label="Légende"
          className="h-[44px] w-full rounded-lg bg-panneau px-4 text-[15px] text-texte outline-none placeholder:text-texte-2 disabled:opacity-60"
        />
      </div>

      <footer className="flex shrink-0 items-center gap-3 border-t border-bordure px-4 py-3">
        {vueUniquePossible && (
          <button
            type="button"
            role="switch"
            aria-checked={vueUnique}
            onClick={() => setVueUnique((v) => !v)}
            title="Vue unique : le destinataire ne pourra l'ouvrir qu'une fois"
            className={clsx(
              "flex shrink-0 items-center gap-2 rounded-full border-2 border-dashed px-3 py-1.5 text-[13px] transition-colors",
              vueUnique ? "border-primaire bg-primaire-doux text-primaire-texte" : "border-texte-3 text-texte-2 hover:bg-survol",
            )}
          >
            <Eye size={16} /> Vue unique
          </button>
        )}
        <div className="flex min-w-0 flex-1 items-center gap-2 overflow-x-auto py-1 md:justify-center">
          {elements.map((el, i) => (
            <div key={el.cle} className="group relative shrink-0">
              <button
                type="button"
                onClick={() => setActif(i)}
                aria-label={`Fichier ${i + 1} : ${el.source.name}`}
                aria-current={el === courant}
                className={clsx(
                  "flex size-[52px] items-center justify-center overflow-hidden rounded-md bg-panneau ring-2 transition-shadow",
                  el === courant ? "ring-primaire" : "ring-transparent",
                )}
              >
                <Vignette element={el} />
              </button>
              <button
                type="button"
                onClick={() => retirer(el.cle)}
                aria-label={`Retirer ${el.source.name}`}
                title="Retirer"
                className={clsx(
                  "absolute -top-1.5 -right-1.5 flex size-5 items-center justify-center rounded-full bg-panneau text-texte-2 shadow ring-1 ring-bordure hover:text-texte",
                  el === courant ? "opacity-100" : "opacity-0 group-hover:opacity-100 focus-visible:opacity-100",
                )}
              >
                <X size={12} />
              </button>
            </div>
          ))}
          {elements.length < MAX_FICHIERS && (
            <>
              <button
                type="button"
                onClick={() => ajout.current?.click()}
                aria-label="Ajouter des fichiers"
                title="Ajouter des fichiers"
                className="flex size-[52px] shrink-0 items-center justify-center rounded-md border border-dashed border-texte-3 text-texte-2 transition-colors hover:bg-survol"
              >
                <Plus size={22} />
              </button>
              <input
                ref={ajout}
                type="file"
                multiple
                accept={ACCEPTE_DOCUMENTS}
                hidden
                onChange={(e) => {
                  const choisis = [...(e.target.files ?? [])].slice(0, MAX_FICHIERS - elements.length);
                  e.target.value = "";
                  if (choisis.length === 0) return;
                  setElements((liste) => [...liste, ...choisis.map(nouvel)]);
                  setActif(elements.length);
                }}
              />
            </>
          )}
        </div>
        <button
          type="button"
          onClick={envoyer}
          disabled={enPreparation || prets.length === 0}
          aria-label={prets.length > 1 ? `Envoyer ${prets.length} fichiers` : "Envoyer"}
          title="Envoyer"
          className="relative flex size-[52px] shrink-0 items-center justify-center rounded-full bg-primaire text-sur-primaire transition-opacity hover:bg-primaire-fort disabled:opacity-40"
        >
          {enPreparation ? <LoaderCircle size={22} className="animate-spin" /> : <SendHorizontal size={22} />}
          {prets.length > 1 && (
            <span className="absolute -top-1 -right-1 flex h-5 min-w-5 items-center justify-center rounded-full bg-panneau px-1 text-[11px] font-semibold text-primaire-texte ring-1 ring-bordure">
              {prets.length}
            </span>
          )}
        </button>
      </footer>
    </div>
  );
}

function Apercu({ element: el }: { element: Element }) {
  if (el.erreur) {
    return (
      <div className="animate-fade flex max-w-sm flex-col items-center text-center">
        <CircleAlert size={44} className="text-danger" />
        <p className="mt-4 text-[15px] text-texte">{el.source.name}</p>
        <p className="mt-1 text-sm text-texte-2">{el.erreur}</p>
      </div>
    );
  }
  if (!el.fichier) return <LoaderCircle size={30} className="animate-spin text-texte-2" />;
  const f = el.fichier;
  if (f.type === "image" && el.url) {
    return <img src={el.url} alt={f.nom} className="animate-fade max-h-full max-w-full rounded object-contain shadow-sm" />;
  }
  if (f.type === "video" && el.url) {
    return <video src={el.url} controls playsInline className="animate-fade max-h-full max-w-full rounded shadow-sm" />;
  }
  return (
    <div className="animate-fade flex w-full max-w-xs flex-col items-center rounded-lg bg-panneau px-6 py-10 text-center shadow-sm">
      {f.type === "audio" ? <Headphones size={56} className="text-primaire" /> : <FileText size={56} className="text-primaire" />}
      <p className="mt-5 w-full truncate text-[15px] text-texte">{f.nom}</p>
      <p className="mt-1 text-sm text-texte-2">{tailleFichier(f.blob.size)}</p>
    </div>
  );
}

function Vignette({ element: el }: { element: Element }) {
  if (el.erreur) return <CircleAlert size={22} className="text-danger" />;
  if (!el.fichier) return <LoaderCircle size={18} className="animate-spin text-texte-2" />;
  if (el.fichier.type === "image" && el.url) return <img src={el.url} alt="" className="size-full object-cover" />;
  if (el.fichier.type === "video") {
    return el.fichier.apercu ? (
      <span className="relative size-full">
        <img src={el.fichier.apercu} alt="" className="size-full object-cover" />
        <Video size={16} className="absolute bottom-1 left-1 text-sur-visionneuse" />
      </span>
    ) : (
      <Video size={22} className="text-texte-2" />
    );
  }
  return el.fichier.type === "audio" ? <Headphones size={22} className="text-texte-2" /> : <FileText size={22} className="text-texte-2" />;
}
