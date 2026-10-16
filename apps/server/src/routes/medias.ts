import { Hono, type Context } from "hono";
import {
  CONSERVATION_MEDIA,
  TAILLE_MORCEAU,
  estGroupe,
  formatMedia,
  idGroupe,
  mimeSimple,
  schemaNouveauMedia,
} from "@unichat/shared";
import { lireCorpsBorne } from "../lib/corps";
import { Refus, refus } from "../lib/erreurs";
import { membresDe } from "../lib/groupes";
import {
  ErreurKaraks,
  abandonnerEnvoi,
  envoyerMorceau,
  lienTemporaire,
  ouvrirEnvoi,
  type ConfigKaraks,
} from "../lib/karaks";
import type { AppEnv, Bindings } from "../types";
import { exigerSession } from "./garde";
import { MINUTE, corpsJson, limiter } from "./outils";

export const medias = new Hono<AppEnv>();
medias.use("*", exigerSession);

interface LigneMedia {
  id: string;
  conversation: string;
  proprietaire: string;
  type: string;
  mime: string;
  nom: string;
  taille: number;
  envoi_id: string;
  fichier_id: string | null;
  expire_le: number;
}

function configuration(env: Bindings): ConfigKaraks {
  if (!env.KARAKS_STORAGE_URL || !env.KARAKS_STORAGE_CLE) {
    throw new Refus(503, "stockage_indisponible", "L'envoi de fichiers n'est pas encore configuré sur ce serveur.");
  }
  return { url: env.KARAKS_STORAGE_URL, cle: env.KARAKS_STORAGE_CLE };
}

export async function participe(db: D1Database, conversation: string, utilisateurId: string): Promise<boolean> {
  if (estGroupe(conversation)) return (await membresDe(db, idGroupe(conversation))).some((m) => m.id === utilisateurId);
  const [, x, y] = conversation.split(":");
  return x === utilisateurId || y === utilisateurId;
}

/** Les erreurs du stockage deviennent des messages lisibles. */
function traduire(erreur: unknown): never {
  if (erreur instanceof ErreurKaraks) {
    if (erreur.statut >= 400 && erreur.statut < 500) throw refus.requete(erreur.message);
    throw new Refus(502, "stockage_indisponible", "Le stockage des fichiers ne répond pas. Réessayez dans un instant.");
  }
  throw erreur;
}

/** Nom affiché : sans chemin ni caractère de contrôle. */
const nomPropre = (nom: string) => nom.replace(/[\x00-\x1f\\/]/g, "").trim().slice(0, 180) || "fichier";

medias.post("/", async (c) => {
  const demande = await corpsJson(c, schemaNouveauMedia);
  const moi = c.get("session").utilisateur_id;
  await limiter(c, `media:${moi}`, 60, 60 * MINUTE);
  if (!(await participe(c.env.DB, demande.conversation, moi))) {
    throw refus.interdit("Vous ne faites pas partie de cette discussion.");
  }
  const config = configuration(c.env);
  const format = formatMedia(demande.mime)!;
  const id = crypto.randomUUID();
  const maintenant = c.get("deps").maintenant();
  let envoiId: string;
  try {
    // Chez Karaks Storage, le fichier porte un nom neutre : le vrai nom ne
    // quitte pas UniChat.
    envoiId = await ouvrirEnvoi(c.get("deps").recuperer, config, {
      nom: `${id}.${format.extension}`,
      mime: mimeSimple(demande.mime),
      taille: demande.taille,
    });
  } catch (erreur) {
    traduire(erreur);
  }
  await c.env.DB.prepare(
    `INSERT INTO medias (id, conversation, proprietaire, type, mime, nom, taille, envoi_id, cree_le, expire_le)
     VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10)`,
  )
    .bind(
      id,
      demande.conversation,
      moi,
      format.type,
      mimeSimple(demande.mime),
      nomPropre(demande.nom),
      demande.taille,
      envoiId,
      maintenant,
      maintenant + CONSERVATION_MEDIA,
    )
    .run();
  return c.json({ id, tailleMorceau: TAILLE_MORCEAU }, 201);
});

async function monMedia(c: Context<AppEnv>): Promise<LigneMedia> {
  const ligne = await c.env.DB.prepare("SELECT * FROM medias WHERE id = ?1 AND proprietaire = ?2")
    .bind(c.req.param("id"), c.get("session").utilisateur_id)
    .first<LigneMedia>();
  if (!ligne) throw refus.introuvable("Envoi introuvable.");
  return ligne;
}

/** Un morceau du fichier, relayé à Karaks Storage (en-tête Content-Range). */
medias.put("/:id", async (c) => {
  const media = await monMedia(c);
  if (media.fichier_id) return c.json({ recu: media.taille, termine: true });
  const plage = /^bytes (\d+)-(\d+)\/(\d+)$/.exec(c.req.header("Content-Range") ?? "");
  if (!plage) throw refus.requete("En-tête Content-Range attendu.");
  const [debut, fin, total] = plage.slice(1).map(Number) as [number, number, number];
  if (total !== media.taille || fin < debut || fin >= total || fin - debut + 1 > TAILLE_MORCEAU) {
    throw refus.requete("Morceau invalide.");
  }
  const morceau = await lireCorpsBorne(c.req.raw, TAILLE_MORCEAU);
  if (!morceau || morceau.length !== fin - debut + 1) throw refus.requete("Morceau incomplet.");

  let resultat;
  try {
    resultat = await envoyerMorceau(c.get("deps").recuperer, configuration(c.env), media.envoi_id, `bytes ${debut}-${fin}/${total}`, morceau);
  } catch (erreur) {
    traduire(erreur);
  }
  if (resultat.fichier) {
    await c.env.DB.prepare("UPDATE medias SET fichier_id = ?1, termine_le = ?2 WHERE id = ?3")
      .bind(resultat.fichier.id, c.get("deps").maintenant(), media.id)
      .run();
    return c.json({ recu: media.taille, termine: true });
  }
  return c.json({ recu: resultat.recu, termine: false }, 202);
});

/**
 * Téléchargement, réservé aux participants de la discussion. Les octets sont
 * relayés depuis un lien temporaire : l'adresse du stockage n'est jamais
 * donnée au navigateur.
 */
medias.get("/:id", async (c) => {
  const moi = c.get("session").utilisateur_id;
  const media = await c.env.DB.prepare("SELECT * FROM medias WHERE id = ?1").bind(c.req.param("id")).first<LigneMedia>();
  const maintenant = c.get("deps").maintenant();
  // Même réponse pour « absent » et « pas pour vous » : on ne révèle rien.
  if (!media || !media.fichier_id || media.expire_le <= maintenant || !(await participe(c.env.DB, media.conversation, moi))) {
    throw refus.introuvable("Fichier expiré ou introuvable.");
  }
  let url: string;
  try {
    url = await lienTemporaire(c.get("deps").recuperer, configuration(c.env), media.fichier_id);
  } catch (erreur) {
    traduire(erreur);
  }
  const plage = c.req.header("Range");
  const source = await c.get("deps").recuperer(url, { headers: plage ? { Range: plage } : {} });
  if (!source.ok || !source.body) throw new Refus(502, "stockage_indisponible", "Le fichier n'a pas pu être lu. Réessayez.");

  const enTetes = new Headers({
    "Content-Type": media.mime,
    "Cache-Control": "private, max-age=3600",
    "X-Content-Type-Options": "nosniff",
    // Ouvert seul dans un onglet, un fichier ne peut rien exécuter.
    "Content-Security-Policy": "default-src 'none'; sandbox",
    "Content-Disposition": `${media.type === "document" ? "attachment" : "inline"}; filename*=UTF-8''${encodeURIComponent(media.nom)}`,
  });
  for (const nom of ["Content-Length", "Content-Range", "Accept-Ranges"]) {
    const valeur = source.headers.get(nom);
    if (valeur) enTetes.set(nom, valeur);
  }
  return new Response(source.body, { status: source.status === 206 ? 206 : 200, headers: enTetes });
});

/**
 * Abandon d'un envoi en cours, ou retrait d'un fichier envoyé (message
 * supprimé pour tout le monde) : il cesse d'être servi tout de suite et le
 * nettoyage l'efface du stockage.
 */
medias.delete("/:id", async (c) => {
  const media = await monMedia(c);
  if (!media.fichier_id) {
    try {
      await abandonnerEnvoi(c.get("deps").recuperer, configuration(c.env), media.envoi_id);
    } catch {
      // Session déjà expirée chez Karaks Storage : rien à abandonner.
    }
    await c.env.DB.prepare("DELETE FROM medias WHERE id = ?1").bind(media.id).run();
  } else {
    await c.env.DB.prepare("UPDATE medias SET expire_le = 0 WHERE id = ?1").bind(media.id).run();
  }
  return c.body(null, 204);
});
