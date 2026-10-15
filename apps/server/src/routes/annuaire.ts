import { Hono } from "hono";
import { LIMITES, lireRecherche, schemaAjoutContact, type Visibilite } from "@unichat/shared";
import { refus } from "../lib/erreurs";
import { versOctets } from "../lib/images";
import { carte, contactsDe, rechercher, visible } from "../lib/profils";
import type { AppEnv } from "../types";
import { exigerSession } from "./garde";
import { MINUTE, corpsJson, ip, limiter } from "./outils";

export const recherche = new Hono<AppEnv>();
recherche.use("*", exigerSession);

recherche.get("/", async (c) => {
  const lecteur = c.get("session").utilisateur_id;
  // Deux limites : par compte et par adresse, pour qu'on ne puisse pas
  // tester des milliers d'adresses e-mail en multipliant les comptes.
  await limiter(c, `recherche:${lecteur}`, 30, 10 * MINUTE);
  await limiter(c, `recherche-ip:${ip(c)}`, 100, 10 * MINUTE);
  const critere = lireRecherche(c.req.query("q") ?? "");
  if (!critere) return c.json({ resultats: [] });
  return c.json({ resultats: await rechercher(c.env.DB, critere, lecteur) });
});

export const personnes = new Hono<AppEnv>();
personnes.use("*", exigerSession);

personnes.get("/:id", async (c) => {
  const resultat = await carte(c.env.DB, c.req.param("id"), c.get("session").utilisateur_id);
  if (!resultat) throw refus.introuvable("Cette personne n'existe pas ou plus.");
  return c.json(resultat);
});

personnes.get("/:id/photo", async (c) => {
  const lecteur = c.get("session").utilisateur_id;
  const cible = c.req.param("id");
  // Colonne choisie dans une liste fermée, jamais copiée depuis la requête.
  const colonne = c.req.query("taille") === "grande" ? "grande" : "petite";
  const ligne = await c.env.DB.prepare(
    `SELECT p.version, p.type, p.${colonne} AS image, u.visibilite_photo,
       EXISTS (SELECT 1 FROM contacts k WHERE k.proprietaire_id = u.id AND k.contact_id = ?1) AS relation
     FROM photos p JOIN utilisateurs u ON u.id = p.utilisateur_id
     WHERE p.utilisateur_id = ?2`,
  )
    .bind(lecteur, cible)
    .first<{ version: string; type: string; image: number[] | ArrayBuffer; visibilite_photo: Visibilite; relation: number }>();
  // Même réponse qu'une photo absente : on ne révèle pas qu'elle existe.
  if (!ligne || !visible(ligne.visibilite_photo, lecteur === cible, ligne.relation === 1)) {
    throw refus.introuvable("Photo introuvable.");
  }
  const etiquette = `"${ligne.version}-${colonne}"`;
  const enTetes = {
    "Content-Type": ligne.type,
    ETag: etiquette,
    // Adresse versionnée : à une adresse donnée, la photo ne change jamais.
    "Cache-Control": c.req.query("v") === ligne.version ? "private, max-age=31536000, immutable" : "private, no-cache",
  };
  if (c.req.header("If-None-Match") === etiquette) return c.body(null, 304, enTetes);
  return c.body(versOctets(ligne.image), 200, enTetes);
});

export const contacts = new Hono<AppEnv>();
contacts.use("*", exigerSession);

contacts.get("/", async (c) => {
  return c.json({ contacts: await contactsDe(c.env.DB, c.get("session").utilisateur_id) });
});

contacts.post("/", async (c) => {
  const { id } = await corpsJson(c, schemaAjoutContact);
  const proprietaire = c.get("session").utilisateur_id;
  if (id === proprietaire) throw refus.requete("Vous ne pouvez pas vous ajouter vous-même.");
  const personne = await carte(c.env.DB, id, proprietaire);
  if (!personne) throw refus.introuvable("Cette personne n'existe pas ou plus.");
  const total = await c.env.DB.prepare("SELECT COUNT(*) AS n FROM contacts WHERE proprietaire_id = ?1")
    .bind(proprietaire)
    .first<{ n: number }>();
  if ((total?.n ?? 0) >= LIMITES.contacts) throw refus.requete(`${LIMITES.contacts} contacts au maximum.`);
  await c.env.DB.prepare("INSERT OR IGNORE INTO contacts (proprietaire_id, contact_id, ajoute_le) VALUES (?1, ?2, ?3)")
    .bind(proprietaire, id, c.get("deps").maintenant())
    .run();
  return c.json(await carte(c.env.DB, id, proprietaire), 201);
});

contacts.delete("/:id", async (c) => {
  await c.env.DB.prepare("DELETE FROM contacts WHERE proprietaire_id = ?1 AND contact_id = ?2")
    .bind(c.get("session").utilisateur_id, c.req.param("id"))
    .run();
  return c.body(null, 204);
});
