import { Hono, type Context } from "hono";
import {
  LIMITES_GROUPE,
  schemaAjoutMembres,
  schemaCreationGroupe,
  schemaMajGroupe,
  type Groupe,
} from "@unichat/shared";
import { refus } from "../lib/erreurs";
import { annoncer, garantirAdmin, groupePour, membresDe } from "../lib/groupes";
import { enregistrerPhotoGroupe, lirePhotoEnvoyee, supprimerPhotoGroupe } from "../lib/photos";
import { versOctets } from "../lib/images";
import type { AppEnv } from "../types";
import { exigerSession } from "./garde";
import { MINUTE, corpsJson, limiter } from "./outils";

export const groupes = new Hono<AppEnv>();
groupes.use("*", exigerSession);

/** Seules des personnes de mes contacts : on n'ajoute pas un inconnu à un groupe. */
async function verifierContacts(db: D1Database, proprietaire: string, ids: string[]): Promise<void> {
  const ligne = await db
    .prepare(
      `SELECT COUNT(*) AS n FROM contacts k JOIN utilisateurs u ON u.id = k.contact_id
       WHERE k.proprietaire_id = ?1 AND u.pseudo IS NOT NULL AND k.contact_id IN (SELECT value FROM json_each(?2))`,
    )
    .bind(proprietaire, JSON.stringify(ids))
    .first<{ n: number }>();
  if ((ligne?.n ?? 0) !== ids.length) throw refus.requete("Vous ne pouvez ajouter que des personnes de vos contacts.");
  // Une personne qui m'a bloqué ne peut pas être ajoutée par moi ; le message ne dit pas pourquoi.
  const bloqueur = await db
    .prepare(
      `SELECT u.nom FROM blocages b JOIN utilisateurs u ON u.id = b.bloqueur_id
       WHERE b.bloque_id = ?1 AND b.bloqueur_id IN (SELECT value FROM json_each(?2)) LIMIT 1`,
    )
    .bind(proprietaire, JSON.stringify(ids))
    .first<{ nom: string }>();
  if (bloqueur) throw refus.interdit(`${bloqueur.nom} ne peut pas être ajouté à ce groupe.`);
  // Réglage « Mes contacts » : seules les personnes qu'elle a ajoutées peuvent l'inviter directement.
  const reserve = await db
    .prepare(
      `SELECT u.nom FROM utilisateurs u
       WHERE u.id IN (SELECT value FROM json_each(?2)) AND u.ajout_groupes = 'contacts'
         AND NOT EXISTS (SELECT 1 FROM contacts k WHERE k.proprietaire_id = u.id AND k.contact_id = ?1)
       LIMIT 1`,
    )
    .bind(proprietaire, JSON.stringify(ids))
    .first<{ nom: string }>();
  if (reserve) throw refus.interdit(`${reserve.nom} n'accepte d'être ajouté que par ses contacts. Invitez cette personne avec le lien du groupe.`);
}

async function exigerGroupe(c: Context<AppEnv>, admin = false): Promise<Groupe> {
  const groupe = await groupePour(c.env.DB, c.req.param("id")!, c.get("session").utilisateur_id);
  if (!groupe || !groupe.moiMembre) throw refus.introuvable("Groupe introuvable.");
  if (admin && !groupe.moiAdmin) throw refus.interdit("Seuls les administrateurs du groupe peuvent faire cela.");
  return groupe;
}

groupes.get("/", async (c) => {
  const { results } = await c.env.DB.prepare(
    `SELECT g.id, g.nom FROM groupes g JOIN membres m ON m.groupe_id = g.id
     WHERE m.utilisateur_id = ?1 ORDER BY g.nom COLLATE NOCASE`,
  )
    .bind(c.get("session").utilisateur_id)
    .all<{ id: string; nom: string }>();
  return c.json({ groupes: results });
});

groupes.post("/", async (c) => {
  const { nom, membres } = await corpsJson(c, schemaCreationGroupe);
  const moi = c.get("session").utilisateur_id;
  await limiter(c, `groupe:${moi}`, 20, 60 * MINUTE);
  const invites = [...new Set(membres)].filter((id) => id !== moi);
  if (invites.length === 0) throw refus.requete("Choisissez au moins une personne.");
  if (invites.length + 1 > LIMITES_GROUPE.membres) throw refus.requete(`${LIMITES_GROUPE.membres} membres au maximum.`);
  await verifierContacts(c.env.DB, moi, invites);

  const id = crypto.randomUUID();
  const maintenant = c.get("deps").maintenant();
  // Une seule instruction pour tous les membres : D1 limite le nombre de requêtes par appel.
  await c.env.DB.batch([
    c.env.DB.prepare("INSERT INTO groupes (id, nom, cree_par, cree_le) VALUES (?1, ?2, ?3, ?4)").bind(id, nom, moi, maintenant),
    c.env.DB.prepare("INSERT INTO membres (groupe_id, utilisateur_id, role, ajoute_le) VALUES (?1, ?2, 'admin', ?3)").bind(id, moi, maintenant),
    c.env.DB.prepare(
      "INSERT INTO membres (groupe_id, utilisateur_id, role, ajoute_le) SELECT ?1, value, 'membre', ?2 FROM json_each(?3)",
    ).bind(id, maintenant + 1, JSON.stringify(invites)),
  ]);
  await annoncer(c.env, [moi, ...invites], { groupeId: id, action: "creation", par: moi, cibles: invites, nom, le: maintenant });
  return c.json(await groupePour(c.env.DB, id, moi), 201);
});

groupes.get("/:id", async (c) => c.json(await exigerGroupe(c)));

groupes.patch("/:id", async (c) => {
  const groupe = await exigerGroupe(c, true);
  const changements = await corpsJson(c, schemaMajGroupe);
  const moi = c.get("session").utilisateur_id;
  const maintenant = c.get("deps").maintenant();
  const membres = groupe.membres.map((m) => m.id);
  if (changements.nom !== undefined && changements.nom !== groupe.nom) {
    await c.env.DB.prepare("UPDATE groupes SET nom = ?1 WHERE id = ?2").bind(changements.nom, groupe.id).run();
    await annoncer(c.env, membres, { groupeId: groupe.id, action: "renommage", par: moi, cibles: [], nom: changements.nom, le: maintenant });
  }
  if (changements.description !== undefined && changements.description !== groupe.description) {
    await c.env.DB.prepare("UPDATE groupes SET description = ?1 WHERE id = ?2").bind(changements.description, groupe.id).run();
    await annoncer(c.env, membres, { groupeId: groupe.id, action: "description", par: moi, cibles: [], le: maintenant });
  }
  return c.json(await groupePour(c.env.DB, groupe.id, moi));
});

groupes.post("/:id/membres", async (c) => {
  const groupe = await exigerGroupe(c, true);
  const { membres } = await corpsJson(c, schemaAjoutMembres);
  const moi = c.get("session").utilisateur_id;
  const presents = new Set(groupe.membres.map((m) => m.id));
  const nouveaux = [...new Set(membres)].filter((id) => !presents.has(id));
  if (nouveaux.length === 0) throw refus.requete("Ces personnes font déjà partie du groupe.");
  if (presents.size + nouveaux.length > LIMITES_GROUPE.membres) throw refus.requete(`${LIMITES_GROUPE.membres} membres au maximum.`);
  await verifierContacts(c.env.DB, moi, nouveaux);
  const maintenant = c.get("deps").maintenant();
  await c.env.DB.prepare(
    "INSERT OR IGNORE INTO membres (groupe_id, utilisateur_id, role, ajoute_le) SELECT ?1, value, 'membre', ?2 FROM json_each(?3)",
  )
    .bind(groupe.id, maintenant, JSON.stringify(nouveaux))
    .run();
  await annoncer(c.env, [...presents, ...nouveaux], { groupeId: groupe.id, action: "ajout", par: moi, cibles: nouveaux, nom: groupe.nom, le: maintenant });
  return c.json(await groupePour(c.env.DB, groupe.id, moi));
});

groupes.delete("/:id/membres/:membre", async (c) => {
  const moi = c.get("session").utilisateur_id;
  const cible = c.req.param("membre");
  const depart = cible === moi;
  const groupe = await exigerGroupe(c, !depart);
  if (!groupe.membres.some((m) => m.id === cible)) throw refus.introuvable("Cette personne ne fait pas partie du groupe.");
  const maintenant = c.get("deps").maintenant();
  await c.env.DB.prepare("DELETE FROM membres WHERE groupe_id = ?1 AND utilisateur_id = ?2").bind(groupe.id, cible).run();
  const restants = (await membresDe(c.env.DB, groupe.id)).map((m) => m.id);
  if (restants.length === 0) {
    // Plus personne : le groupe disparaît.
    await c.env.DB.prepare("DELETE FROM groupes WHERE id = ?1").bind(groupe.id).run();
  } else {
    await garantirAdmin(c.env.DB, groupe.id);
  }
  await annoncer(c.env, [...restants, cible], {
    groupeId: groupe.id,
    action: depart ? "depart" : "retrait",
    par: moi,
    cibles: [cible],
    le: maintenant,
  });
  return c.body(null, 204);
});

groupes.post("/:id/admins/:membre", async (c) => {
  const groupe = await exigerGroupe(c, true);
  const cible = c.req.param("membre");
  if (!groupe.membres.some((m) => m.id === cible)) throw refus.introuvable("Cette personne ne fait pas partie du groupe.");
  await c.env.DB.prepare("UPDATE membres SET role = 'admin' WHERE groupe_id = ?1 AND utilisateur_id = ?2").bind(groupe.id, cible).run();
  return c.json(await groupePour(c.env.DB, groupe.id, c.get("session").utilisateur_id));
});

// --- Photo du groupe ------------------------------------------------------------------

groupes.put("/:id/photo", async (c) => {
  const groupe = await exigerGroupe(c, true);
  const moi = c.get("session").utilisateur_id;
  await limiter(c, `photo-groupe:${moi}`, 30, 60 * MINUTE);
  const { grande, petite, type } = await lirePhotoEnvoyee(c.req.raw);
  const maintenant = c.get("deps").maintenant();
  await enregistrerPhotoGroupe(c.env.DB, groupe.id, grande, petite, type, maintenant);
  await annoncer(c.env, groupe.membres.map((m) => m.id), { groupeId: groupe.id, action: "photo", par: moi, cibles: [], le: maintenant });
  return c.json(await groupePour(c.env.DB, groupe.id, moi));
});

groupes.delete("/:id/photo", async (c) => {
  const groupe = await exigerGroupe(c, true);
  const moi = c.get("session").utilisateur_id;
  await supprimerPhotoGroupe(c.env.DB, groupe.id);
  await annoncer(c.env, groupe.membres.map((m) => m.id), { groupeId: groupe.id, action: "photo", par: moi, cibles: [], le: c.get("deps").maintenant() });
  return c.json(await groupePour(c.env.DB, groupe.id, moi));
});

/** Réservée aux membres, avec la même adresse versionnée que les photos de profil. */
groupes.get("/:id/photo", async (c) => {
  await exigerGroupe(c);
  const colonne = c.req.query("taille") === "grande" ? "grande" : "petite";
  const ligne = await c.env.DB.prepare(`SELECT version, type, ${colonne} AS image FROM photos_groupes WHERE groupe_id = ?1`)
    .bind(c.req.param("id"))
    .first<{ version: string; type: string; image: number[] | ArrayBuffer }>();
  if (!ligne) throw refus.introuvable("Photo introuvable.");
  const etiquette = `"${ligne.version}-${colonne}"`;
  const enTetes = {
    "Content-Type": ligne.type,
    ETag: etiquette,
    "Cache-Control": c.req.query("v") === ligne.version ? "private, max-age=31536000, immutable" : "private, no-cache",
  };
  if (c.req.header("If-None-Match") === etiquette) return c.body(null, 304, enTetes);
  return c.body(versOctets(ligne.image), 200, enTetes);
});

// --- Lien d'invitation ----------------------------------------------------------------

/** 128 bits aléatoires, en base64 sans remplissage : 22 caractères, introuvables par essais. */
function nouveauCode(): string {
  const octets = crypto.getRandomValues(new Uint8Array(16));
  return btoa(String.fromCharCode(...octets)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/** Le lien du groupe, créé à la première demande d'un administrateur. */
groupes.get("/:id/invitation", async (c) => {
  const groupe = await exigerGroupe(c, true);
  const ligne = await c.env.DB.prepare("SELECT invitation FROM groupes WHERE id = ?1").bind(groupe.id).first<{ invitation: string | null }>();
  if (ligne?.invitation) return c.json({ code: ligne.invitation });
  const code = nouveauCode();
  await c.env.DB.prepare("UPDATE groupes SET invitation = ?1 WHERE id = ?2").bind(code, groupe.id).run();
  return c.json({ code });
});

/** Réinitialiser : l'ancien lien cesse aussitôt de fonctionner. */
groupes.post("/:id/invitation", async (c) => {
  const groupe = await exigerGroupe(c, true);
  const code = nouveauCode();
  await c.env.DB.prepare("UPDATE groupes SET invitation = ?1 WHERE id = ?2").bind(code, groupe.id).run();
  return c.json({ code });
});
