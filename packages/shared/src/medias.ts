import { z } from "zod";

export type TypeMedia = "image" | "video" | "audio" | "document";

const MO = 1024 * 1024;

/**
 * Tailles maximales. Plus basses que celles de WhatsApp : chaque fichier
 * passe par des offres gratuites (Cloudflare, Vercel, Google Drive).
 */
export const LIMITES_MEDIA: Record<TypeMedia, number> = {
  image: 16 * MO,
  video: 64 * MO,
  audio: 16 * MO,
  document: 64 * MO,
};

/** Envoi par morceaux : la taille imposée par Karaks Storage (une requête Vercel ne dépasse pas 4,5 Mo). */
export const TAILLE_MORCEAU = 4 * MO;

/** Durée de conservation d'un fichier sur le serveur : comme un message, 30 jours au plus. */
export const CONSERVATION_MEDIA = 30 * 24 * 60 * 60 * 1000;

/**
 * Formats acceptés : ceux que Karaks Storage sait vérifier (le contenu doit
 * correspondre au type annoncé). Pas de SVG : une image qui peut contenir du
 * code n'a rien à faire dans une messagerie.
 */
export const FORMATS_MEDIA: Record<string, { type: TypeMedia; extension: string }> = {
  "image/jpeg": { type: "image", extension: "jpg" },
  "image/png": { type: "image", extension: "png" },
  "image/webp": { type: "image", extension: "webp" },
  "image/gif": { type: "image", extension: "gif" },
  "image/avif": { type: "image", extension: "avif" },
  "video/mp4": { type: "video", extension: "mp4" },
  "video/webm": { type: "video", extension: "webm" },
  "video/quicktime": { type: "video", extension: "mov" },
  "audio/webm": { type: "audio", extension: "webm" },
  "audio/ogg": { type: "audio", extension: "ogg" },
  "audio/mpeg": { type: "audio", extension: "mp3" },
  "audio/mp4": { type: "audio", extension: "m4a" },
  "audio/aac": { type: "audio", extension: "aac" },
  "audio/wav": { type: "audio", extension: "wav" },
  "application/pdf": { type: "document", extension: "pdf" },
  "text/plain": { type: "document", extension: "txt" },
};

/** « audio/webm;codecs=opus » devient « audio/webm ». */
export const mimeSimple = (mime: string) => mime.split(";")[0]!.trim().toLowerCase();

export function formatMedia(mime: string) {
  return FORMATS_MEDIA[mimeSimple(mime)] ?? null;
}

const motifConversation = /^(d:[0-9a-f-]{36}:[0-9a-f-]{36}|g:[0-9a-f-]{36})$/i;

export const schemaNouveauMedia = z
  .object({
    conversation: z.string().regex(motifConversation, "Discussion invalide."),
    nom: z.string().trim().min(1).max(180),
    mime: z.string().max(100),
    taille: z.number().int().positive(),
  })
  .strict()
  .superRefine((m, ctx) => {
    const format = formatMedia(m.mime);
    if (!format) {
      ctx.addIssue({ code: "custom", message: "Ce type de fichier n'est pas pris en charge." });
      return;
    }
    const maximum = LIMITES_MEDIA[format.type];
    if (m.taille > maximum) {
      ctx.addIssue({ code: "custom", message: `Fichier trop lourd : ${Math.round(maximum / MO)} Mo au maximum.` });
    }
  });

/** Ce que porte un message qui contient un fichier. */
export interface MediaMessage {
  id: string;
  type: TypeMedia;
  mime: string;
  nom: string;
  taille: number;
  largeur?: number;
  hauteur?: number;
  /** En secondes (vidéo, message vocal). */
  duree?: number;
  /** Vignette minuscule (data:image/…), affichée floue avant le téléchargement. */
  apercu?: string;
  /** Enregistré au micro dans la discussion, plutôt que joint depuis un fichier. */
  vocal?: boolean;
}

/** Ce que l'application déclare d'un fichier à l'envoi ; le reste vient du serveur. */
export const schemaMediaEnvoye = z
  .object({
    id: z.string().uuid(),
    largeur: z.number().int().min(1).max(20000).optional(),
    hauteur: z.number().int().min(1).max(20000).optional(),
    duree: z.number().min(0).max(36000).optional(),
    apercu: z
      .string()
      .max(6000)
      .regex(/^data:image\/(jpeg|webp);base64,[A-Za-z0-9+/=]+$/, "Aperçu invalide.")
      .optional(),
    vocal: z.boolean().optional(),
  })
  .strict();
