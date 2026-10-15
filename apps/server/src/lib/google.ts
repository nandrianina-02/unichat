import { createLocalJWKSet, errors, jwtVerify, type JSONWebKeySet } from "jose";

const AUTORISATION = "https://accounts.google.com/o/oauth2/v2/auth";
const JETON = "https://oauth2.googleapis.com/token";
const CLES = "https://www.googleapis.com/oauth2/v3/certs";
const EMETTEURS = ["https://accounts.google.com", "accounts.google.com"];
const DUREE_CACHE_CLES = 60 * 60 * 1000;

export interface ConfigGoogle {
  clientId: string;
  clientSecret: string;
}

export interface IdentiteGoogle {
  sub: string;
  email: string;
  nom: string;
  photo: string | null;
}

export class ErreurGoogle extends Error {}

export function urlAutorisation(
  config: ConfigGoogle,
  p: { redirection: string; etat: string; nonce: string; defi: string },
): string {
  const url = new URL(AUTORISATION);
  url.search = new URLSearchParams({
    client_id: config.clientId,
    redirect_uri: p.redirection,
    response_type: "code",
    // Le strict nécessaire : identité, adresse et photo. Aucun accès aux
    // données Google n'est demandé.
    scope: "openid email profile",
    state: p.etat,
    nonce: p.nonce,
    code_challenge: p.defi,
    code_challenge_method: "S256",
    prompt: "select_account",
    access_type: "online",
  }).toString();
  return url.toString();
}

export async function echangerCode(
  recuperer: typeof fetch,
  config: ConfigGoogle,
  p: { code: string; redirection: string; verificateur: string },
): Promise<string> {
  const reponse = await recuperer(JETON, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      code: p.code,
      client_id: config.clientId,
      client_secret: config.clientSecret,
      redirect_uri: p.redirection,
      grant_type: "authorization_code",
      code_verifier: p.verificateur,
    }),
  });
  if (!reponse.ok) throw new ErreurGoogle(`échange du code refusé (${reponse.status})`);
  const corps = (await reponse.json()) as { id_token?: string };
  if (!corps.id_token) throw new ErreurGoogle("réponse sans jeton d'identité");
  return corps.id_token;
}

// Clés publiques de Google, gardées une heure. Rangées par fonction de
// récupération : en production il n'y en a qu'une, et chaque test garde les
// siennes sans fuite d'un test à l'autre.
const cachesCles = new WeakMap<typeof fetch, { cles: JSONWebKeySet; expire: number }>();

async function clesGoogle(recuperer: typeof fetch, maintenant: number, forcer = false): Promise<JSONWebKeySet> {
  const cache = cachesCles.get(recuperer);
  if (cache && !forcer && cache.expire > maintenant) return cache.cles;
  const reponse = await recuperer(CLES);
  if (!reponse.ok) throw new ErreurGoogle(`clés publiques indisponibles (${reponse.status})`);
  const cles = (await reponse.json()) as JSONWebKeySet;
  cachesCles.set(recuperer, { cles, expire: maintenant + DUREE_CACHE_CLES });
  return cles;
}

/**
 * Vérifie le jeton d'identité : signature, émetteur, audience, expiration,
 * nonce et adresse vérifiée. Le jeton vient de Google par un canal direct,
 * mais on ne s'en contente pas : c'est lui qui ouvre le compte.
 */
export async function verifierJetonIdentite(
  recuperer: typeof fetch,
  config: ConfigGoogle,
  jeton: string,
  nonceAttendu: string,
  maintenant: number,
): Promise<IdentiteGoogle> {
  const options = {
    issuer: EMETTEURS,
    audience: config.clientId,
    algorithms: ["RS256"],
    currentDate: new Date(maintenant),
  };
  let resultat;
  try {
    resultat = await jwtVerify(jeton, createLocalJWKSet(await clesGoogle(recuperer, maintenant)), options);
  } catch (erreur) {
    // Google renouvelle ses clés : une clé inconnue justifie un seul nouvel essai.
    if (!(erreur instanceof errors.JWKSNoMatchingKey)) throw new ErreurGoogle(`jeton refusé : ${String(erreur)}`);
    try {
      resultat = await jwtVerify(jeton, createLocalJWKSet(await clesGoogle(recuperer, maintenant, true)), options);
    } catch (nouvelle) {
      throw new ErreurGoogle(`jeton refusé : ${String(nouvelle)}`);
    }
  }
  const p = resultat.payload as Record<string, unknown>;
  if (p.nonce !== nonceAttendu) throw new ErreurGoogle("nonce différent");
  if (typeof p.sub !== "string" || !p.sub) throw new ErreurGoogle("identifiant absent");
  if (typeof p.email !== "string" || p.email_verified !== true) throw new ErreurAdresseNonVerifiee();
  const email = p.email.toLowerCase();
  const nom = typeof p.name === "string" && p.name.trim() ? p.name.trim() : email.split("@")[0]!;
  const photo = typeof p.picture === "string" ? p.picture : null;
  return { sub: p.sub, email, nom, photo };
}

export class ErreurAdresseNonVerifiee extends ErreurGoogle {}

/** Adresse de la photo Google à une taille donnée ; null si l'adresse n'est pas celle attendue. */
export function photoGoogle(url: string, taille: number): string | null {
  let adresse: URL;
  try {
    adresse = new URL(url);
  } catch {
    return null;
  }
  // On ne télécharge que depuis le domaine des photos Google.
  if (adresse.protocol !== "https:" || !adresse.hostname.endsWith(".googleusercontent.com")) return null;
  const chemin = adresse.pathname.replace(/=s\d+(-c)?$/, "");
  return `${adresse.origin}${chemin}=s${taille}-c`;
}
