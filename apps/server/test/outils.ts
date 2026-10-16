import { env } from "cloudflare:workers";
import type { MessageClient, MessageServeur } from "@unichat/shared";
import { SignJWT, exportJWK, generateKeyPair } from "jose";
import { creerApp } from "../src/app";
import { base64url } from "../src/lib/crypto";

export const ORIGINE = "http://localhost";
export const MINUTE = 60 * 1000;
export const HEURE = 60 * MINUTE;
export const JOUR = 24 * HEURE;
const CLIENT_ID = "client-essai.apps.googleusercontent.com";

export interface IdentiteFausse {
  sub: string;
  email: string;
  nom?: string;
  emailVerifie?: boolean;
  photo?: string;
}

// Début de JPEG : seul l'en-tête compte pour la détection du type.
export const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, ...Array.from({ length: 60 }, (_, i) => i)]);
export const WEBP = new Uint8Array([
  ...new TextEncoder().encode("RIFF"),
  0x24, 0, 0, 0,
  ...new TextEncoder().encode("WEBP"),
  ...Array.from({ length: 40 }, (_, i) => i),
]);

/**
 * Faux Google : il signe de vrais jetons d'identité (clé RSA générée pour le
 * test), vérifie le PKCE comme le ferait Google, et sert une photo.
 */
export async function creerGoogleFaux() {
  const { privateKey, publicKey } = await generateKeyPair("RS256");
  const cle = { ...(await exportJWK(publicKey)), kid: "cle-essai", alg: "RS256", use: "sig" };
  const codes = new Map<string, { identite: IdentiteFausse; nonce: string; defi: string; nonceForce?: string }>();
  let horloge = Date.now();

  const recuperer: typeof fetch = async (entree, init) => {
    const url = typeof entree === "string" ? entree : entree instanceof URL ? entree.href : entree.url;
    if (url === "https://www.googleapis.com/oauth2/v3/certs") return Response.json({ keys: [cle] });
    if (url === "https://oauth2.googleapis.com/token") {
      const p = new URLSearchParams(String(init?.body));
      const attente = codes.get(p.get("code") ?? "");
      if (!attente || p.get("client_id") !== CLIENT_ID || p.get("client_secret") !== "secret-essai") {
        return Response.json({ error: "invalid_grant" }, { status: 400 });
      }
      const defi = base64url(
        new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(p.get("code_verifier") ?? ""))),
      );
      if (defi !== attente.defi) return Response.json({ error: "invalid_grant" }, { status: 400 });
      codes.delete(p.get("code") ?? "");
      const { identite } = attente;
      const secondes = Math.floor(horloge / 1000);
      const jeton = await new SignJWT({
        email: identite.email,
        email_verified: identite.emailVerifie ?? true,
        name: identite.nom ?? "Personne Essai",
        picture: identite.photo,
        nonce: attente.nonceForce ?? attente.nonce,
      })
        .setProtectedHeader({ alg: "RS256", kid: "cle-essai" })
        .setIssuer("https://accounts.google.com")
        .setAudience(CLIENT_ID)
        .setSubject(identite.sub)
        .setIssuedAt(secondes)
        .setExpirationTime(secondes + 3600)
        .sign(privateKey);
      return Response.json({ id_token: jeton });
    }
    if (url.startsWith("https://lh3.googleusercontent.com/")) {
      return new Response(JPEG, { headers: { "Content-Type": "image/jpeg" } });
    }
    return new Response("inconnu", { status: 404 });
  };

  return {
    recuperer,
    reglerHorloge: (t: number) => (horloge = t),
    /** La personne accepte sur la page Google : Google émet un code lié au défi PKCE. */
    consentir(urlGoogle: string, identite: IdentiteFausse, options: { nonceForce?: string } = {}) {
      const u = new URL(urlGoogle);
      const code = `code-${crypto.randomUUID()}`;
      codes.set(code, {
        identite,
        nonce: u.searchParams.get("nonce")!,
        defi: u.searchParams.get("code_challenge")!,
        nonceForce: options.nonceForce,
      });
      return { code, state: u.searchParams.get("state")! };
    },
  };
}

export function cookies(reponse: Response): Map<string, string> {
  const resultat = new Map<string, string>();
  for (const ligne of reponse.headers.getSetCookie()) {
    const paire = ligne.split(";")[0]!;
    const i = paire.indexOf("=");
    resultat.set(paire.slice(0, i), paire.slice(i + 1));
  }
  return resultat;
}

/**
 * Faux Karaks Storage : mêmes adresses et mêmes réponses que l'API réelle
 * (sessions d'envoi par morceaux, liens temporaires, corbeille), en mémoire.
 */
export function creerKaraksFaux(base: string) {
  const envois = new Map<string, { taille: number; morceaux: Uint8Array[]; recu: number }>();
  const fichiers = new Map<string, Uint8Array>();
  const liens = new Map<string, string>();
  const effaces: string[] = [];

  const recuperer = async (url: string, init: RequestInit = {}): Promise<Response | null> => {
    if (!url.startsWith(base)) return null;
    const chemin = url.slice(base.length);
    const methode = init.method ?? "GET";
    const lien = /^\/l\/(.+)$/.exec(chemin);
    if (lien) {
      const fichier = fichiers.get(liens.get(lien[1]!) ?? "");
      return fichier ? new Response(fichier, { headers: { "Content-Length": String(fichier.length), "Accept-Ranges": "bytes" } }) : new Response(null, { status: 404 });
    }
    if (new Headers(init.headers).get("Authorization") !== "Bearer cle-essai") {
      return Response.json({ success: false, error: { message: "Clé invalide." } }, { status: 401 });
    }
    if (chemin === "/api/v1/uploads" && methode === "POST") {
      const corps = JSON.parse(String(init.body)) as { size: number };
      const id = `upl_${crypto.randomUUID().slice(0, 8)}`;
      envois.set(id, { taille: corps.size, morceaux: [], recu: 0 });
      return Response.json({ success: true, upload: { id, received: 0 } }, { status: 201 });
    }
    const envoi = /^\/api\/v1\/uploads\/([^/]+)$/.exec(chemin);
    if (envoi && methode === "PUT") {
      const e = envois.get(envoi[1]!)!;
      const morceau = new Uint8Array(init.body as ArrayBuffer | Uint8Array);
      e.morceaux.push(morceau);
      e.recu += morceau.length;
      if (e.recu < e.taille) return Response.json({ success: true, upload: { received: e.recu }, file: null }, { status: 202 });
      const contenu = new Uint8Array(e.taille);
      let position = 0;
      for (const m of e.morceaux) {
        contenu.set(m, position);
        position += m.length;
      }
      const id = `fil_${crypto.randomUUID().slice(0, 8)}`;
      fichiers.set(id, contenu);
      return Response.json({ success: true, upload: { received: e.recu }, file: { id, size: e.taille, mimeType: "x" } });
    }
    if (envoi && methode === "DELETE") return Response.json({ success: true });
    const signe = /^\/api\/v1\/files\/([^/]+)\/signed-url$/.exec(chemin);
    if (signe) {
      const jeton = crypto.randomUUID();
      liens.set(jeton, signe[1]!);
      return Response.json({ success: true, url: `${base}/l/${jeton}` }, { status: 201 });
    }
    const definitif = /^\/api\/v1\/files\/([^/]+)\/permanent$/.exec(chemin);
    if (definitif) {
      fichiers.delete(definitif[1]!);
      effaces.push(definitif[1]!);
      return Response.json({ success: true });
    }
    if (/^\/api\/v1\/files\/[^/]+$/.test(chemin) && methode === "DELETE") return Response.json({ success: true });
    return Response.json({ success: false, error: { message: "inconnu" } }, { status: 404 });
  };
  return { recuperer, fichiers, effaces };
}

/** Une application de test, son faux Google et une horloge que le test fait avancer. */
export async function preparer(options: { stockage?: boolean } = {}) {
  const google = await creerGoogleFaux();
  const karaks = creerKaraksFaux(env.KARAKS_STORAGE_URL!);
  let maintenant = Date.now();
  const recuperer: typeof fetch = async (entree, init) => {
    const url = typeof entree === "string" ? entree : entree instanceof URL ? entree.href : entree.url;
    return (await karaks.recuperer(url, init)) ?? google.recuperer(entree, init);
  };
  const app = creerApp({ recuperer, maintenant: () => maintenant });
  const environnement = {
    ...env,
    GOOGLE_CLIENT_ID: CLIENT_ID,
    GOOGLE_CLIENT_SECRET: "secret-essai",
    ...(options.stockage === false ? {} : { KARAKS_STORAGE_CLE: "cle-essai" }),
  };

  // Une adresse par environnement de test : les compteurs de limitation ne
  // se partagent pas d'un test à l'autre.
  const adresse = `essai-${crypto.randomUUID()}`;
  const requete = (chemin: string, init: RequestInit = {}) => {
    const enTetes = new Headers(init.headers);
    if (!enTetes.has("CF-Connecting-IP")) enTetes.set("CF-Connecting-IP", adresse);
    return app.request(chemin, { ...init, headers: enTetes }, environnement);
  };

  /** Appareil connecté : son cookie suit les renouvellements, comme un navigateur. */
  class Appareil {
    constructor(public jeton: string) {}

    /** Ouvre la connexion temps réel et garde tout ce qui arrive, pour l'attendre ensuite. */
    async tempsReel(origine = ORIGINE) {
      const reponse = await requete("/api/temps-reel", {
        headers: { Upgrade: "websocket", Cookie: `__Host-uc_session=${this.jeton}`, Origin: origine },
      });
      const ws = reponse.webSocket;
      if (reponse.status !== 101 || !ws) return { refus: reponse.status } as const;
      ws.accept();
      const recus: MessageServeur[] = [];
      const enAttente: { condition: (m: MessageServeur) => boolean; resoudre: (m: MessageServeur) => void }[] = [];
      ws.addEventListener("message", (e) => {
        const m = JSON.parse(e.data as string) as MessageServeur;
        recus.push(m);
        for (const attente of [...enAttente]) {
          if (attente.condition(m)) {
            enAttente.splice(enAttente.indexOf(attente), 1);
            attente.resoudre(m);
          }
        }
      });
      const fermeture = new Promise<number>((resoudre) => ws.addEventListener("close", (e) => resoudre(e.code)));
      return {
        refus: null,
        ws,
        recus,
        fermeture,
        envoyer: (m: MessageClient) => ws.send(JSON.stringify(m)),
        attendre<T extends MessageServeur>(condition: (m: MessageServeur) => m is T, delai = 3000): Promise<T> {
          const deja = recus.find(condition);
          if (deja) return Promise.resolve(deja as T);
          return new Promise<T>((resoudre, rejeter) => {
            const minuterie = setTimeout(() => rejeter(new Error("message attendu non reçu")), delai);
            enAttente.push({
              condition,
              resoudre: (m) => {
                clearTimeout(minuterie);
                resoudre(m as T);
              },
            });
          });
        },
      };
    }
    async appel(chemin: string, init: RequestInit & { json?: unknown } = {}) {
      const enTetes = new Headers(init.headers);
      enTetes.set("Cookie", `__Host-uc_session=${this.jeton}`);
      const methode = init.method ?? "GET";
      if (methode !== "GET" && !enTetes.has("Origin")) enTetes.set("Origin", ORIGINE);
      let corps = init.body;
      if (init.json !== undefined) {
        enTetes.set("Content-Type", "application/json");
        corps = JSON.stringify(init.json);
      }
      const reponse = await requete(chemin, { ...init, method: methode, headers: enTetes, body: corps });
      const nouveau = cookies(reponse).get("__Host-uc_session");
      if (nouveau) this.jeton = nouveau;
      return reponse;
    }
  }

  async function connecter(identite: IdentiteFausse, userAgent = "Mozilla/5.0 (Windows NT 10.0) Chrome/130.0 Safari/537.36") {
    google.reglerHorloge(maintenant);
    const depart = await requete("/api/auth/google", { headers: { "User-Agent": userAgent } });
    const etat = cookies(depart).get("__Host-uc_oauth")!;
    const { code, state } = google.consentir(depart.headers.get("Location")!, identite);
    const retour = await requete(`/api/auth/google/rappel?code=${code}&state=${state}`, {
      headers: { Cookie: `__Host-uc_oauth=${etat}`, "User-Agent": userAgent },
    });
    const jeton = cookies(retour).get("__Host-uc_session");
    if (!jeton) throw new Error(`connexion échouée : ${retour.headers.get("Location")}`);
    return new Appareil(jeton);
  }

  return {
    app,
    google,
    karaks,
    recuperer,
    environnement,
    requete,
    connecter,
    avancer: (ms: number) => (maintenant += ms),
    maintenant: () => maintenant,
  };
}

export function identite(prefixe: string): IdentiteFausse {
  const id = crypto.randomUUID().slice(0, 8);
  return { sub: `${prefixe}-${id}`, email: `${prefixe}.${id}@gmail.com`, nom: `${prefixe} ${id}` };
}
