import { Hono, type Context } from "hono";
import { LIMITES, schemaMajProfil, schemaPseudo, schemaSuppressionCompte, type MajProfil } from "@unichat/shared";
import { lireUtilisateur } from "../lib/comptes";
import { lireCorpsBorne } from "../lib/corps";
import { refus } from "../lib/erreurs";
import { journaliser } from "../lib/evenements";
import { typeImage } from "../lib/images";
import { enregistrerPhoto, supprimerPhoto } from "../lib/photos";
import { versMoi } from "../lib/profils";
import { supprimerCompte } from "../lib/suppression";
import type { AppEnv } from "../types";
import { exigerSession } from "./garde";
import { COOKIE_SESSION, MINUTE, corpsJson, effacerCookie, limiter } from "./outils";

export const moi = new Hono<AppEnv>();
moi.use("*", exigerSession);

async function moiActuel(c: Context<AppEnv>) {
  const session = c.get("session");
  const u = await lireUtilisateur(c.env.DB, session.utilisateur_id);
  if (!u) throw refus.nonConnecte();
  return versMoi(u, session.id);
}

moi.get("/", async (c) => c.json(await moiActuel(c)));

moi.delete("/", async (c) => {
  const { confirmation } = await corpsJson(c, schemaSuppressionCompte);
  const session = c.get("session");
  const u = await lireUtilisateur(c.env.DB, session.utilisateur_id);
  if (!u) throw refus.nonConnecte();
  // Recopier son nom d'utilisateur : une suppression ne part pas d'un clic égaré.
  if (!u.pseudo || confirmation !== u.pseudo) {
    throw refus.requete("Le nom d'utilisateur saisi ne correspond pas à votre compte.");
  }
  await supprimerCompte(c.env, u.id);
  effacerCookie(c, COOKIE_SESSION);
  return c.body(null, 204);
});

const COLONNES: Record<keyof MajProfil, string> = {
  nom: "nom",
  infos: "infos",
  pseudo: "pseudo",
  visibilitePhoto: "visibilite_photo",
  visibiliteInfos: "visibilite_infos",
  trouvableParEmail: "trouvable_email",
};

moi.patch("/", async (c) => {
  const changements = await corpsJson(c, schemaMajProfil);
  const session = c.get("session");
  const avant = await lireUtilisateur(c.env.DB, session.utilisateur_id);
  if (!avant) throw refus.nonConnecte();

  const cles = (Object.keys(changements) as (keyof MajProfil)[]).filter((k) => changements[k] !== undefined);
  if (cles.length === 0) return c.json(versMoi(avant, session.id));

  const valeurs = cles.map((k) => (k === "trouvableParEmail" ? (changements[k] ? 1 : 0) : changements[k]));
  const affectations = cles.map((k, i) => `${COLONNES[k]} = ?${i + 1}`).join(", ");
  const maintenant = c.get("deps").maintenant();
  const instructions = [
    c.env.DB.prepare(`UPDATE utilisateurs SET ${affectations} WHERE id = ?${cles.length + 1}`).bind(
      ...valeurs,
      avant.id,
    ),
  ];
  // Un changement de nom d'utilisateur se voit dans l'activité du compte :
  // c'est par lui que les autres vous trouvent.
  if (changements.pseudo && avant.pseudo && changements.pseudo !== avant.pseudo) {
    instructions.push(
      journaliser(c.env.DB, {
        utilisateurId: avant.id,
        type: "pseudo_modifie",
        sessionId: session.id,
        appareil: session.appareil,
        ville: session.ville,
        pays: session.pays,
        maintenant,
      }),
    );
  }
  try {
    await c.env.DB.batch(instructions);
  } catch (erreur) {
    if (String(erreur).includes("UNIQUE")) throw refus.conflit("Ce nom d'utilisateur est déjà pris.");
    throw erreur;
  }
  const apres = await lireUtilisateur(c.env.DB, avant.id);
  return c.json(versMoi(apres!, session.id));
});

moi.get("/pseudo-disponible", async (c) => {
  const session = c.get("session");
  await limiter(c, `pseudo:${session.utilisateur_id}`, 60, 10 * MINUTE);
  const verification = schemaPseudo.safeParse(c.req.query("p") ?? "");
  if (!verification.success) {
    return c.json({ disponible: false, message: verification.error.issues[0]?.message ?? "Nom invalide." });
  }
  const pris = await c.env.DB.prepare("SELECT 1 FROM utilisateurs WHERE pseudo = ?1 AND id <> ?2")
    .bind(verification.data, session.utilisateur_id)
    .first();
  return c.json(
    pris ? { disponible: false, message: "Ce nom d'utilisateur est déjà pris." } : { disponible: true, pseudo: verification.data },
  );
});

moi.put("/photo", async (c) => {
  const brut = await lireCorpsBorne(c.req.raw, LIMITES.photoGrande + LIMITES.photoPetite + 4096);
  if (!brut) throw refus.requete("Photo trop lourde.");
  let corps: FormData;
  try {
    corps = await new Response(brut, { headers: { "Content-Type": c.req.header("Content-Type") ?? "" } }).formData();
  } catch {
    throw refus.requete("Envoi de photo invalide.");
  }
  const fichiers = [corps.get("grande"), corps.get("petite")];
  if (!fichiers.every((f): f is File => f instanceof File)) throw refus.requete("Photo manquante.");
  const [grande, petite] = await Promise.all(fichiers.map(async (f) => new Uint8Array(await f.arrayBuffer())));
  if (grande!.length > LIMITES.photoGrande || petite!.length > LIMITES.photoPetite) {
    throw refus.requete("Photo trop lourde.");
  }
  const type = typeImage(grande!);
  if (!type || typeImage(petite!) !== type) throw refus.requete("Format d'image non pris en charge.");
  await enregistrerPhoto(c.env.DB, c.get("session").utilisateur_id, grande!, petite!, type, c.get("deps").maintenant());
  return c.json(await moiActuel(c));
});

moi.delete("/photo", async (c) => {
  await supprimerPhoto(c.env.DB, c.get("session").utilisateur_id);
  return c.json(await moiActuel(c));
});
