import { NOTIFICATION_OCTETS_MAX, type ContenuNotification, type EnveloppeChiffree } from "@unichat/shared";
import { SignJWT, importJWK, type JWK } from "jose";

/**
 * Web Push (RFC 8030), chiffré pour l'appareil (RFC 8291, aes128gcm) et
 * signé VAPID (RFC 8292). Le service de notification du navigateur (Google
 * pour Chrome, Mozilla pour Firefox) transporte des octets qu'il ne peut pas
 * lire. Aucun compte Firebase ni service payant : seulement une paire de clés.
 */

export interface Abonnement {
  endpoint: string;
  p256dh: string;
  auth: string;
}

export type Notification = ContenuNotification;

/** Services de notification connus : le serveur n'envoie rien ailleurs (pas d'URL arbitraire). */
const SERVICES = [/^fcm\.googleapis\.com$/, /^updates\.push\.services\.mozilla\.com$/, /^push\.services\.mozilla\.com$/, /\.notify\.windows\.com$/, /^web\.push\.apple\.com$/];

export function serviceAutorise(endpoint: string): boolean {
  try {
    const url = new URL(endpoint);
    return url.protocol === "https:" && SERVICES.some((motif) => motif.test(url.hostname));
  } catch {
    return false;
  }
}

const encodeur = new TextEncoder();
const octets = (texte: string): Uint8Array<ArrayBuffer> => new Uint8Array(encodeur.encode(texte));

export function base64url(octets: Uint8Array): string {
  let binaire = "";
  for (const o of octets) binaire += String.fromCharCode(o);
  return btoa(binaire).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export function depuisBase64url(texte: string): Uint8Array<ArrayBuffer> {
  const binaire = atob(texte.replace(/-/g, "+").replace(/_/g, "/") + "===".slice((texte.length + 3) % 4));
  const octets = new Uint8Array(binaire.length);
  for (let i = 0; i < binaire.length; i++) octets[i] = binaire.charCodeAt(i);
  return octets;
}

function concatener(...parties: Uint8Array[]): Uint8Array<ArrayBuffer> {
  const resultat = new Uint8Array(parties.reduce((n, p) => n + p.length, 0));
  let position = 0;
  for (const p of parties) {
    resultat.set(p, position);
    position += p.length;
  }
  return resultat;
}

async function hkdf(sel: Uint8Array<ArrayBuffer>, matiere: Uint8Array<ArrayBuffer>, info: Uint8Array<ArrayBuffer>, octets: number): Promise<Uint8Array<ArrayBuffer>> {
  const cle = await crypto.subtle.importKey("raw", matiere, "HKDF", false, ["deriveBits"]);
  return new Uint8Array(await crypto.subtle.deriveBits({ name: "HKDF", hash: "SHA-256", salt: sel, info }, cle, octets * 8));
}

/** Chiffrement aes128gcm pour un abonnement : un seul enregistrement, sel et clé éphémère neufs à chaque envoi. */
export async function chiffrer(contenu: Uint8Array<ArrayBuffer>, abonnement: Pick<Abonnement, "p256dh" | "auth">): Promise<Uint8Array<ArrayBuffer>> {
  const clePubliqueAppareil = depuisBase64url(abonnement.p256dh);
  const secret = depuisBase64url(abonnement.auth);
  const ephemere = (await crypto.subtle.generateKey({ name: "ECDH", namedCurve: "P-256" }, true, ["deriveBits"])) as CryptoKeyPair;
  const clePubliqueServeur = new Uint8Array((await crypto.subtle.exportKey("raw", ephemere.publicKey)) as ArrayBuffer);
  const appareil = await crypto.subtle.importKey("raw", clePubliqueAppareil, { name: "ECDH", namedCurve: "P-256" }, false, []);
  // « public » est le nom standard du paramètre ; les types des Workers l'appellent « $public ».
  const algorithme = { name: "ECDH", public: appareil } as unknown as SubtleCryptoDeriveKeyAlgorithm;
  const partage = new Uint8Array(await crypto.subtle.deriveBits(algorithme, ephemere.privateKey, 256));

  const infoCle = concatener(octets("WebPush: info\0"), clePubliqueAppareil, clePubliqueServeur);
  const ikm = await hkdf(secret, partage, infoCle, 32);
  const sel = crypto.getRandomValues(new Uint8Array(16));
  const cek = await hkdf(sel, ikm, octets("Content-Encoding: aes128gcm\0"), 16);
  const nonce = await hkdf(sel, ikm, octets("Content-Encoding: nonce\0"), 12);

  const cleAes = await crypto.subtle.importKey("raw", cek, "AES-GCM", false, ["encrypt"]);
  // Délimiteur 0x02 : dernier (et unique) enregistrement.
  const chiffre = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv: nonce }, cleAes, concatener(contenu, new Uint8Array([2]))));
  const entete = new Uint8Array(16 + 4 + 1 + clePubliqueServeur.length);
  entete.set(sel, 0);
  new DataView(entete.buffer).setUint32(16, 4096);
  entete[20] = clePubliqueServeur.length;
  entete.set(clePubliqueServeur, 21);
  return concatener(entete, chiffre);
}

/** Clé publique VAPID (point non compressé, base64url), à donner aux navigateurs pour s'abonner. */
export function clePubliqueVapid(jwk: JWK): string {
  return base64url(concatener(new Uint8Array([4]), depuisBase64url(jwk.x!), depuisBase64url(jwk.y!)));
}

export async function enteteVapid(endpoint: string, jwk: JWK, contact: string, maintenant: number): Promise<string> {
  const cle = await importJWK(jwk, "ES256");
  const jeton = await new SignJWT({})
    .setProtectedHeader({ typ: "JWT", alg: "ES256" })
    .setAudience(new URL(endpoint).origin)
    .setExpirationTime(Math.floor(maintenant / 1000) + 12 * 3600)
    .setSubject(contact)
    .sign(cle);
  return `vapid t=${jeton}, k=${clePubliqueVapid(jwk)}`;
}

/**
 * Envoie une notification. Renvoie le statut : 404 ou 410 signifie que
 * l'abonnement n'existe plus (application désinstallée, permission retirée).
 */
export async function pousser(
  recuperer: typeof fetch,
  abonnement: Abonnement,
  notification: Notification,
  vapid: { jwk: JWK; contact: string },
  maintenant: number,
): Promise<number> {
  const corps = await chiffrer(octets(JSON.stringify(notification)), abonnement);
  // Sujet : une notification non encore remise est remplacée par la suivante de la même discussion.
  const sujet = base64url(new Uint8Array(await crypto.subtle.digest("SHA-256", octets(notification.conversation)))).slice(0, 32);
  const reponse = await recuperer(abonnement.endpoint, {
    method: "POST",
    headers: {
      Authorization: await enteteVapid(abonnement.endpoint, vapid.jwk, vapid.contact, maintenant),
      "Content-Encoding": "aes128gcm",
      "Content-Type": "application/octet-stream",
      TTL: String(24 * 3600),
      Urgency: "high",
      Topic: sujet,
    },
    body: corps,
  });
  await reponse.body?.cancel().catch(() => {});
  return reponse.status;
}

/** Résumé d'un message pour la notification, comme dans la liste des discussions. */
export function resumer(m: {
  texte: string;
  media?: { type: string; nom: string; vocal?: boolean; vueUnique?: boolean };
  position?: unknown;
  contact?: { nom: string };
  sondage?: { question: string };
}): string {
  if (m.texte) return m.texte.slice(0, 200);
  if (m.media) {
    if (m.media.type === "image") return m.media.vueUnique ? "Photo à vue unique" : "Photo";
    if (m.media.type === "video") return m.media.vueUnique ? "Vidéo à vue unique" : "Vidéo";
    if (m.media.type === "audio") return m.media.vocal ? "Message vocal" : "Audio";
    return m.media.nom;
  }
  if (m.position) return "Position";
  if (m.contact) return `Contact : ${m.contact.nom}`;
  if (m.sondage) return `Sondage : ${m.sondage.question}`;
  return "Nouveau message";
}

/**
 * Message chiffré : la notification d'un appareil emporte l'enveloppe et la
 * clé qui lui est destinée, pour qu'il en montre le texte. Sans clé pour lui,
 * ou trop long pour tenir dans une notification : le texte générique reste.
 */
export function joindreChiffre(notification: ContenuNotification, enveloppe: EnveloppeChiffree | undefined, numero: number | null): ContenuNotification {
  const cle = enveloppe && numero ? enveloppe.cles[String(numero)] : undefined;
  if (!enveloppe || !cle) return notification;
  const complete: ContenuNotification = {
    ...notification,
    chiffre: { id: enveloppe.id, de: enveloppe.de, deAppareil: enveloppe.deAppareil, conversation: enveloppe.conversation, corps: enveloppe.corps, cle },
  };
  return new TextEncoder().encode(JSON.stringify(complete)).length <= NOTIFICATION_OCTETS_MAX ? complete : notification;
}
