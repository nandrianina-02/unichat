import { TAILLE_MORCEAU, formatMedia, mimeSimple, type TypeMedia } from "@unichat/shared";
import { ErreurApi } from "./api";
import { identifiantsEnvoi } from "./api-medias";

/** Un fichier prêt à partir : contenu, type et ce qu'on sait l'afficher sans le télécharger. */
export interface FichierPrepare {
  blob: Blob;
  nom: string;
  mime: string;
  type: TypeMedia;
  largeur?: number;
  hauteur?: number;
  duree?: number;
  apercu?: string;
  vocal?: boolean;
  vueUnique?: boolean;
}

const COTE_MAX = 1600;

function versBlob(canvas: HTMLCanvasElement, type: string, qualite: number): Promise<Blob> {
  return new Promise((resoudre, rejeter) =>
    canvas.toBlob((b) => (b ? resoudre(b) : rejeter(new Error("encodage impossible"))), type, qualite),
  );
}

function dessiner(source: CanvasImageSource, largeur: number, hauteur: number): HTMLCanvasElement {
  const canvas = document.createElement("canvas");
  canvas.width = largeur;
  canvas.height = hauteur;
  const contexte = canvas.getContext("2d");
  if (!contexte) throw new Error("dessin impossible");
  contexte.imageSmoothingQuality = "high";
  contexte.drawImage(source, 0, 0, largeur, hauteur);
  return canvas;
}

/** Vignette de 24 pixels de large, affichée floue le temps du téléchargement (quelques centaines d'octets). */
function vignette(source: CanvasImageSource, largeur: number, hauteur: number): string {
  const l = 24;
  const h = Math.max(1, Math.round((hauteur / largeur) * l));
  return dessiner(source, l, h).toDataURL("image/jpeg", 0.5);
}

/**
 * Photo réduite à 1 600 pixels de côté, comme le font les messageries : la
 * différence ne se voit pas sur un écran, l'envoi est dix fois plus léger.
 * Les GIF restent tels quels, pour garder leur animation.
 */
async function preparerImage(fichier: File): Promise<FichierPrepare> {
  const source = await createImageBitmap(fichier);
  try {
    const echelle = Math.min(1, COTE_MAX / Math.max(source.width, source.height));
    const largeur = Math.round(source.width * echelle);
    const hauteur = Math.round(source.height * echelle);
    const apercu = vignette(source, source.width, source.height);
    if (fichier.type === "image/gif") {
      return { blob: fichier, nom: fichier.name, mime: "image/gif", type: "image", largeur: source.width, hauteur: source.height, apercu };
    }
    const canvas = dessiner(source, largeur, hauteur);
    let blob = await versBlob(canvas, "image/webp", 0.82);
    if (blob.type !== "image/webp") blob = await versBlob(canvas, "image/jpeg", 0.85);
    const nom = fichier.name.replace(/\.[^.]+$/, "") + (blob.type === "image/webp" ? ".webp" : ".jpg");
    return { blob, nom, mime: blob.type, type: "image", largeur, hauteur, apercu };
  } finally {
    source.close();
  }
}

/** Durée, dimensions et première image d'une vidéo, lues par le navigateur. */
function lireVideo(fichier: Blob): Promise<{ largeur: number; hauteur: number; duree: number; apercu?: string }> {
  return new Promise((resoudre, rejeter) => {
    const url = URL.createObjectURL(fichier);
    const video = document.createElement("video");
    video.muted = true;
    video.preload = "metadata";
    video.playsInline = true;
    const finir = () => URL.revokeObjectURL(url);
    video.onloadeddata = () => {
      video.currentTime = Math.min(0.1, (video.duration || 1) / 2);
    };
    video.onseeked = () => {
      let apercu: string | undefined;
      try {
        apercu = vignette(video, video.videoWidth, video.videoHeight);
      } catch {
        // Certaines vidéos ne se laissent pas dessiner : pas de vignette.
      }
      resoudre({ largeur: video.videoWidth, hauteur: video.videoHeight, duree: video.duration, apercu });
      finir();
    };
    video.onerror = () => {
      finir();
      rejeter(new Error("Cette vidéo ne peut pas être lue."));
    };
    video.src = url;
  });
}

export async function preparerFichier(fichier: File): Promise<FichierPrepare> {
  const format = formatMedia(fichier.type);
  if (!format) throw new Error("Ce type de fichier n'est pas pris en charge (photos, vidéos MP4 ou WebM, PDF, texte).");
  if (format.type === "image") return preparerImage(fichier);
  if (format.type === "video") {
    const infos = await lireVideo(fichier).catch(() => null);
    return { blob: fichier, nom: fichier.name, mime: mimeSimple(fichier.type), type: "video", ...(infos ?? {}) };
  }
  return { blob: fichier, nom: fichier.name, mime: mimeSimple(fichier.type), type: format.type };
}

/** Durée d'un enregistrement audio (les navigateurs ne la connaissent pas toujours tout de suite). */
export function dureeAudio(blob: Blob): Promise<number | undefined> {
  return new Promise((resoudre) => {
    const url = URL.createObjectURL(blob);
    const audio = new Audio();
    audio.preload = "metadata";
    audio.onloadedmetadata = () => {
      URL.revokeObjectURL(url);
      resoudre(Number.isFinite(audio.duration) ? audio.duration : undefined);
    };
    audio.onerror = () => {
      URL.revokeObjectURL(url);
      resoudre(undefined);
    };
    audio.src = url;
  });
}

/**
 * Envoi par morceaux de 4 Mo, avec reprise : un morceau qui échoue est
 * retenté trois fois avant d'abandonner.
 */
export async function envoyerParMorceaux(
  conversation: string,
  f: FichierPrepare,
  progression: (part: number) => void,
): Promise<string> {
  const { id } = await identifiantsEnvoi(conversation, f);
  const taille = f.blob.size;
  let debut = 0;
  while (debut < taille) {
    const fin = Math.min(debut + TAILLE_MORCEAU, taille) - 1;
    const morceau = f.blob.slice(debut, fin + 1);
    let essai = 0;
    for (;;) {
      try {
        const reponse = await fetch(`/api/medias/${encodeURIComponent(id)}`, {
          method: "PUT",
          headers: { "Content-Range": `bytes ${debut}-${fin}/${taille}` },
          body: morceau,
          credentials: "same-origin",
        });
        const corps = (await reponse.json().catch(() => null)) as { recu?: number; message?: string; erreur?: string } | null;
        if (!reponse.ok) throw new ErreurApi(corps?.erreur ?? "envoi", corps?.message ?? "L'envoi a échoué.", reponse.status);
        debut = corps?.recu ?? fin + 1;
        progression(debut / taille);
        break;
      } catch (erreur) {
        essai += 1;
        // Une erreur de contenu ne s'arrangera pas en réessayant.
        if (essai >= 3 || (erreur instanceof ErreurApi && erreur.statut >= 400 && erreur.statut < 500)) throw erreur;
        await new Promise((r) => setTimeout(r, 1000 * essai));
      }
    }
  }
  return id;
}
