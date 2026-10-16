import clsx from "clsx";
import { Download, FileText, Globe, Image as IconeImage, LoaderCircle, Play, X } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { Visionneuse, enregistrer, type MessageAvecMedia } from "../composants/Media";
import { premierLien } from "../composants/TexteMessage";
import { Apparition } from "../composants/Apparition";
import { dateListe, tailleFichier } from "../lib/format";
import { useMessagerie, useMessages } from "../lib/messagerie-react";
import type { MessageLocal } from "../lib/stockage";

type Onglet = "medias" | "documents" | "liens";

// Les vues uniques n'ont pas leur place ici : elles ne se revoient pas.
const estVisuel = (m: MessageLocal): m is MessageAvecMedia =>
  !m.supprime && !m.media?.vueUnique && (m.media?.type === "image" || m.media?.type === "video");
const estDocument = (m: MessageLocal): m is MessageAvecMedia => !m.supprime && (m.media?.type === "document" || m.media?.type === "audio");

/** Les fichiers d'une discussion, triés du plus récent au plus ancien, comme « Médias, liens et documents ». */
export function useContenus(conversation: string) {
  const messages = useMessages(conversation);
  return useMemo(() => {
    const tous = [...(messages ?? [])].reverse();
    return {
      medias: tous.filter(estVisuel),
      documents: tous.filter(estDocument),
      liens: tous.filter((m) => !m.supprime && (m.lien || premierLien(m.texte))),
      charge: messages !== null,
    };
  }, [messages]);
}

/** Vignette d'une photo ou d'une vidéo : le fichier de l'appareil s'il y est, sinon l'aperçu flou. */
export function Vignette({ message, taille, onOuvrir }: { message: MessageAvecMedia; taille?: number; onOuvrir: (url: string) => void }) {
  const { messagerie } = useMessagerie();
  const [url, setUrl] = useState<string | null>(null);
  const [chargement, setChargement] = useState(false);

  useEffect(() => {
    let lien: string | null = null;
    let annule = false;
    void messagerie.fichierLocal(message.id).then((blob) => {
      if (annule || !blob) return;
      lien = URL.createObjectURL(blob);
      setUrl(lien);
    });
    return () => {
      annule = true;
      if (lien) URL.revokeObjectURL(lien);
    };
  }, [messagerie, message.id]);

  async function ouvrir() {
    if (url) {
      onOuvrir(url);
      return;
    }
    if (!message.media.id) return;
    setChargement(true);
    try {
      const blob = await messagerie.recupererFichier(message.id, message.media.id);
      const lien = URL.createObjectURL(blob);
      setUrl(lien);
      onOuvrir(lien);
    } catch {
      // Expiré sur le serveur et absent d'ici : rien à montrer.
    } finally {
      setChargement(false);
    }
  }

  const video = message.media.type === "video";
  return (
    <button
      type="button"
      onClick={() => void ouvrir()}
      aria-label={video ? "Ouvrir la vidéo" : "Ouvrir la photo"}
      className="relative block aspect-square overflow-hidden rounded-md bg-texte/10"
      style={taille ? { width: taille, height: taille } : undefined}
    >
      {url && !video && <img src={url} alt="" className="animate-fade size-full object-cover" />}
      {url && video && <video src={`${url}#t=0.1`} muted preload="metadata" className="animate-fade size-full object-cover" />}
      {!url && message.media.apercu && <img src={message.media.apercu} alt="" className="size-full scale-110 object-cover blur-md" />}
      {!url && !message.media.apercu && <IconeImage size={22} className="absolute inset-0 m-auto text-texte-3" />}
      {(video || chargement) && (
        <span className="absolute inset-0 flex items-center justify-center">
          <span className="flex size-8 items-center justify-center rounded-full bg-pastille-media text-sur-visionneuse">
            {chargement ? <LoaderCircle size={16} className="animate-spin" /> : <Play size={15} fill="currentColor" className="translate-x-px" />}
          </span>
        </span>
      )}
    </button>
  );
}

export function Galerie({ conversation, onFermer }: { conversation: string; onFermer: () => void }) {
  const { messagerie } = useMessagerie();
  const contenus = useContenus(conversation);
  const [onglet, setOnglet] = useState<Onglet>("medias");
  const [visionne, setVisionne] = useState<{ message: MessageAvecMedia; url: string } | null>(null);

  async function documentEnregistre(m: MessageAvecMedia) {
    const local = await messagerie.fichierLocal(m.id);
    const blob = local ?? (m.media.id ? await messagerie.recupererFichier(m.id, m.media.id).catch(() => null) : null);
    if (!blob) return;
    const url = URL.createObjectURL(blob);
    enregistrer(url, m.media.nom);
    setTimeout(() => URL.revokeObjectURL(url), 10_000);
  }

  const onglets: { id: Onglet; libelle: string; nombre: number }[] = [
    { id: "medias", libelle: "Médias", nombre: contenus.medias.length },
    { id: "documents", libelle: "Documents", nombre: contenus.documents.length },
    { id: "liens", libelle: "Liens", nombre: contenus.liens.length },
  ];

  return (
    <section className="flex h-full w-full flex-col bg-panneau">
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
        <h2 className="text-[16px] text-texte">Médias, liens et documents</h2>
      </header>
      <div role="tablist" aria-label="Contenus" className="flex shrink-0 border-b border-bordure">
        {onglets.map((o) => (
          <button
            key={o.id}
            type="button"
            role="tab"
            aria-selected={onglet === o.id}
            onClick={() => setOnglet(o.id)}
            className={clsx(
              "flex-1 border-b-2 py-3 text-[14px] transition-colors",
              onglet === o.id ? "border-primaire text-primaire-texte" : "border-transparent text-texte-2 hover:text-texte",
            )}
          >
            {o.libelle}
          </button>
        ))}
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto">
        {!contenus.charge && (
          <p className="flex justify-center py-10 text-texte-2">
            <LoaderCircle size={20} className="animate-spin" />
          </p>
        )}
        {contenus.charge && onglets.find((o) => o.id === onglet)!.nombre === 0 && (
          <p className="animate-fade px-8 py-12 text-center text-sm text-texte-2">
            {onglet === "medias" ? "Aucune photo ni vidéo" : onglet === "documents" ? "Aucun document" : "Aucun lien"} dans cette discussion.
          </p>
        )}
        {onglet === "medias" && contenus.medias.length > 0 && (
          <div className="animate-fade grid grid-cols-3 gap-1 p-3">
            {contenus.medias.map((m) => (
              <Vignette key={m.id} message={m} onOuvrir={(url) => setVisionne({ message: m, url })} />
            ))}
          </div>
        )}
        {onglet === "documents" &&
          contenus.documents.map((m, i) => (
            <button
              key={m.id}
              type="button"
              onClick={() => void documentEnregistre(m)}
              className={clsx("flex w-full items-center gap-4 border-b border-bordure px-6 py-3 text-left transition-colors hover:bg-survol", i < 6 && `animate-fade stagger-${i + 1}`)}
            >
              <span className="flex size-10 shrink-0 items-center justify-center rounded bg-primaire-doux text-primaire-texte">
                <FileText size={20} />
              </span>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[14.5px] text-texte">{m.media.nom}</span>
                <span className="block text-[12.5px] text-texte-2">
                  {tailleFichier(m.media.taille)} · {dateListe(m.le)}
                </span>
              </span>
              <Download size={18} className="shrink-0 text-texte-2" />
            </button>
          ))}
        {onglet === "liens" &&
          contenus.liens.map((m, i) => {
            const url = m.lien?.url ?? premierLien(m.texte)!;
            return (
              <a
                key={m.id}
                href={url}
                target="_blank"
                rel="noopener noreferrer nofollow"
                className={clsx("flex items-start gap-4 border-b border-bordure px-6 py-3 transition-colors hover:bg-survol", i < 6 && `animate-fade stagger-${i + 1}`)}
              >
                <span className="flex size-10 shrink-0 items-center justify-center rounded bg-primaire-doux text-primaire-texte">
                  <Globe size={20} />
                </span>
                <span className="min-w-0 flex-1">
                  {m.lien?.titre && <span className="block truncate text-[14.5px] text-texte">{m.lien.titre}</span>}
                  <span className="block truncate text-[13px] text-primaire-texte">{url}</span>
                  <span className="block text-[12px] text-texte-2">{dateListe(m.le)}</span>
                </span>
              </a>
            );
          })}
      </div>
      <Apparition>
        {visionne && (
          <Visionneuse
            message={visionne.message}
            url={visionne.url}
            auteur={messagerie.nom(visionne.message.de, conversation)}
            onFermer={() => setVisionne(null)}
          />
        )}
      </Apparition>
    </section>
  );
}

/** Rangée « Médias, liens et documents » des infos d'un contact ou d'un groupe. */
export function ApercuGalerie({ conversation, onOuvrir }: { conversation: string; onOuvrir: () => void }) {
  const contenus = useContenus(conversation);
  const total = contenus.medias.length + contenus.documents.length + contenus.liens.length;
  if (!contenus.charge) return null;
  return (
    <div className="animate-rise stagger-1 mt-2.5 bg-panneau px-8 py-4">
      <button type="button" onClick={onOuvrir} className="flex w-full items-center justify-between text-left">
        <span className="text-sm text-texte-2">Médias, liens et documents</span>
        <span className="text-sm text-texte-2">{total}</span>
      </button>
      {contenus.medias.length > 0 && (
        <div className="mt-3 grid grid-cols-4 gap-1.5">
          {contenus.medias.slice(0, 4).map((m) => (
            <Vignette key={m.id} message={m} onOuvrir={onOuvrir} />
          ))}
        </div>
      )}
    </div>
  );
}
