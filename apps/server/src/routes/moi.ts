import { Hono, type Context } from "hono";
import {
  schemaAjoutTelephone,
  schemaCodeTelephone,
  schemaMajProfil,
  schemaPseudo,
  schemaSuppressionCompte,
  type MajProfil,
  type TypeEvenement,
} from "@unichat/shared";
import { estAdmin } from "../lib/admin";
import { lireUtilisateur } from "../lib/comptes";
import { refus } from "../lib/erreurs";
import { journaliser } from "../lib/evenements";
import { enregistrerPhoto, lirePhotoEnvoyee, supprimerPhoto } from "../lib/photos";
import { versMoi } from "../lib/profils";
import { supprimerCompte } from "../lib/suppression";
import { confirmerVerification, demanderVerification, retirerTelephone, verificationEnCours } from "../lib/telephone";
import type { AppEnv } from "../types";
import { exigerSession } from "./garde";
import { COOKIE_SESSION, MINUTE, corpsJson, effacerCookie, ip, limiter } from "./outils";

export const moi = new Hono<AppEnv>();
moi.use("*", exigerSession);

async function moiActuel(c: Context<AppEnv>) {
  const session = c.get("session");
  const u = await lireUtilisateur(c.env.DB, session.utilisateur_id);
  if (!u) throw refus.nonConnecte();
  const verification = await verificationEnCours(c.env.DB, u.id, c.get("deps").maintenant());
  return versMoi(u, session.id, estAdmin(c.env, u.id), verification);
}

/** Un changement du compte noté dans son activité, avec l'appareil qui l'a fait. */
function evenement(c: Context<AppEnv>, type: TypeEvenement) {
  const session = c.get("session");
  return journaliser(c.env.DB, {
    utilisateurId: session.utilisateur_id,
    type,
    sessionId: session.id,
    appareil: session.appareil,
    ville: session.ville,
    pays: session.pays,
    maintenant: c.get("deps").maintenant(),
  });
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
  trouvableParTelephone: "trouvable_telephone",
  visibiliteVu: "visibilite_vu",
  enLigne: "en_ligne",
  confirmationsLecture: "confirmations_lecture",
  ajoutGroupes: "ajout_groupes",
};


moi.patch("/", async (c) => {
  const changements = await corpsJson(c, schemaMajProfil);
  const session = c.get("session");
  const avant = await lireUtilisateur(c.env.DB, session.utilisateur_id);
  if (!avant) throw refus.nonConnecte();

  const cles = (Object.keys(changements) as (keyof MajProfil)[]).filter((k) => changements[k] !== undefined);
  if (cles.length === 0) return c.json(await moiActuel(c));

  const valeurs = cles.map((k) => (typeof changements[k] === "boolean" ? (changements[k] ? 1 : 0) : changements[k]));
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
  return c.json(await moiActuel(c));
});

/*
 * Numéro de téléphone : un code est envoyé par SMS (service Mess), puis
 * saisi ici. Les limites protègent le crédit SMS et les numéros des autres :
 * on ne fait pas pleuvoir des codes sur un inconnu.
 */
moi.post("/telephone", async (c) => {
  const { numero } = await corpsJson(c, schemaAjoutTelephone);
  const session = c.get("session");
  await limiter(c, `telephone:${session.utilisateur_id}`, 5, 60 * MINUTE);
  await limiter(c, `telephone-ip:${ip(c)}`, 20, 60 * MINUTE);
  await demanderVerification(c.env, c.get("deps").recuperer, session.utilisateur_id, numero, c.get("deps").maintenant());
  return c.json(await moiActuel(c));
});

moi.post("/telephone/verifier", async (c) => {
  const { code } = await corpsJson(c, schemaCodeTelephone);
  const session = c.get("session");
  await limiter(c, `telephone-code:${session.utilisateur_id}`, 15, 10 * MINUTE);
  await confirmerVerification(c.env, c.get("deps").recuperer, session.utilisateur_id, code, c.get("deps").maintenant());
  await evenement(c, "telephone_ajoute").run();
  return c.json(await moiActuel(c));
});

/** Abandonner la vérification en cours, sans toucher au numéro déjà vérifié. */
moi.delete("/telephone/verification", async (c) => {
  await c.env.DB.prepare("DELETE FROM verifications_telephone WHERE utilisateur_id = ?1").bind(c.get("session").utilisateur_id).run();
  return c.json(await moiActuel(c));
});

moi.delete("/telephone", async (c) => {
  if (await retirerTelephone(c.env.DB, c.get("session").utilisateur_id)) await evenement(c, "telephone_retire").run();
  return c.json(await moiActuel(c));
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
  const { grande, petite, type } = await lirePhotoEnvoyee(c.req.raw);
  await enregistrerPhoto(c.env.DB, c.get("session").utilisateur_id, grande, petite, type, c.get("deps").maintenant());
  return c.json(await moiActuel(c));
});

moi.delete("/photo", async (c) => {
  await supprimerPhoto(c.env.DB, c.get("session").utilisateur_id);
  return c.json(await moiActuel(c));
});
