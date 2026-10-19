import { LoaderCircle } from "lucide-react";
import { useEffect, useRef, useState } from "react";

interface DetecteurNatif {
  detect(source: CanvasImageSource): Promise<{ rawValue: string }[]>;
}
interface ConstructeurDetecteur {
  new (options: { formats: string[] }): DetecteurNatif;
  getSupportedFormats?: () => Promise<string[]>;
}

type Lecture = (video: HTMLVideoElement) => Promise<string | null>;

/**
 * Le détecteur du navigateur quand il existe (Chrome sur Android, macOS) ;
 * sinon jsQR, chargé à la demande (Chrome sur Windows n'a pas de détecteur).
 */
async function creerLecture(): Promise<Lecture> {
  const Natif = (globalThis as { BarcodeDetector?: ConstructeurDetecteur }).BarcodeDetector;
  if (Natif && (await Natif.getSupportedFormats?.().catch((): string[] => []))?.includes("qr_code")) {
    const detecteur = new Natif({ formats: ["qr_code"] });
    return async (video) => (await detecteur.detect(video))[0]?.rawValue ?? null;
  }
  const { default: jsQR } = await import("jsqr");
  const toile = document.createElement("canvas");
  const contexte = toile.getContext("2d", { willReadFrequently: true })!;
  return async (video) => {
    if (!video.videoWidth) return null;
    // Une image réduite suffit à lire un QR code, et la lecture reste rapide.
    const echelle = Math.min(1, 640 / Math.max(video.videoWidth, video.videoHeight));
    toile.width = Math.round(video.videoWidth * echelle);
    toile.height = Math.round(video.videoHeight * echelle);
    contexte.drawImage(video, 0, 0, toile.width, toile.height);
    const image = contexte.getImageData(0, 0, toile.width, toile.height);
    return jsQR(image.data, image.width, image.height, { inversionAttempts: "dontInvert" })?.data ?? null;
  };
}

/** Appareil photo et lecture d'un QR code ; la caméra s'éteint dès qu'un code est lu ou que la vue se ferme. */
export function LecteurQr({ onCode, onErreur }: { onCode: (texte: string) => void; onErreur: (message: string) => void }) {
  const video = useRef<HTMLVideoElement>(null);
  const rappels = useRef({ onCode, onErreur });
  rappels.current = { onCode, onErreur };
  const [actif, setActif] = useState(false);

  useEffect(() => {
    let flux: MediaStream | null = null;
    let fini = false;
    let minuterie: ReturnType<typeof setTimeout> | undefined;
    const eteindre = () => flux?.getTracks().forEach((piste) => piste.stop());

    void (async () => {
      try {
        flux = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "environment" }, audio: false });
      } catch (e) {
        if (!fini) {
          rappels.current.onErreur(
            e instanceof DOMException && e.name === "NotAllowedError"
              ? "L'accès à l'appareil photo a été refusé. Autorisez-le dans les réglages du navigateur, ou collez le code."
              : "Aucun appareil photo n'est disponible ici. Affichez plutôt un code, ou collez-le.",
          );
        }
        return;
      }
      if (fini || !video.current) return eteindre();
      video.current.srcObject = flux;
      await video.current.play().catch(() => {});
      setActif(true);
      const lire = await creerLecture();
      const boucle = async () => {
        if (fini || !video.current) return;
        const texte = await lire(video.current).catch(() => null);
        if (texte && !fini) {
          fini = true;
          eteindre();
          rappels.current.onCode(texte);
          return;
        }
        minuterie = setTimeout(() => void boucle(), 200);
      };
      void boucle();
    })();

    return () => {
      fini = true;
      clearTimeout(minuterie);
      eteindre();
    };
  }, []);

  return (
    <div className="relative mx-auto aspect-square w-full max-w-[280px] overflow-hidden rounded-lg bg-visionneuse">
      <video ref={video} muted playsInline aria-label="Image de l'appareil photo" className="h-full w-full object-cover" />
      {!actif && (
        <span className="absolute inset-0 flex items-center justify-center text-sur-visionneuse/80">
          <LoaderCircle size={26} className="animate-spin" />
        </span>
      )}
      {/* Viseur : quatre coins, sans assombrir l'image. */}
      <span aria-hidden="true" className="pointer-events-none absolute inset-8">
        {["top-0 left-0 border-t-2 border-l-2", "top-0 right-0 border-t-2 border-r-2", "bottom-0 left-0 border-b-2 border-l-2", "right-0 bottom-0 border-r-2 border-b-2"].map((c) => (
          <span key={c} className={`absolute size-7 border-sur-visionneuse ${c}`} />
        ))}
      </span>
    </div>
  );
}
