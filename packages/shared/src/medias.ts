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

/** Fichier chiffré sur l'appareil : nonce (12 octets) devant, étiquette GCM (16 octets) derrière. */
export const SURCOUT_CHIFFREMENT = 28;
/** Le plus gros fichier accepté, tous types confondus : la borne d'un fichier chiffré, dont le serveur ignore le type. */
export const TAILLE_MEDIA_MAX = Math.max(...Object.values(LIMITES_MEDIA)) + SURCOUT_CHIFFREMENT;

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
    /**
     * Chiffré sur l'appareil (étape 3, lot 5) : le serveur n'en connaît ni le
     * nom, ni le type, ni le contenu ; seule la taille est bornée.
     */
    chiffre: z.boolean().optional(),
  })
  .strict()
  .superRefine((m, ctx) => {
    if (m.chiffre) {
      if (m.taille > TAILLE_MEDIA_MAX) ctx.addIssue({ code: "custom", message: `Fichier trop lourd : ${Math.round(TAILLE_MEDIA_MAX / MO)} Mo au maximum.` });
      return;
    }
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
  /** Photo ou vidéo à vue unique : effacée de l'appareil du destinataire une fois ouverte. */
  vueUnique?: boolean;
  /** Clé du fichier chiffré (AES-256-GCM, base64) : elle ne voyage que dans un message chiffré. */
  cle?: string;
}

export const schemaTransfertMedia = z
  .object({ conversation: z.string().regex(motifConversation, "Discussion invalide.") })
  .strict();

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
    vueUnique: z.boolean().optional(),
  })
  .strict();
