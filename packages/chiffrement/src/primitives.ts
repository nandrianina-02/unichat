import { gcm } from "@noble/ciphers/aes.js";
import { ed25519, x25519 } from "@noble/curves/ed25519.js";
import { hkdf } from "@noble/hashes/hkdf.js";
import { hmac } from "@noble/hashes/hmac.js";
import { sha256 } from "@noble/hashes/sha2.js";
import { assembler } from "./octets";

/**
 * Primitives cryptographiques, toutes prises dans les bibliothèques noble
 * (auditées, sans dépendance, licence MIT) : X25519 pour les échanges de
 * clés, Ed25519 pour les signatures, HKDF et HMAC sur SHA-256, AES-256-GCM.
 * Rien n'est réinventé ici : ce module ne fait que fixer les tailles et les
 * étiquettes de séparation des usages.
 */

export interface Paire {
  secrete: Uint8Array;
  publique: Uint8Array;
}

export const TAILLE_CLE = 32;
export const TAILLE_SIGNATURE = 64;

export function aleatoire(taille: number): Uint8Array {
  const octets = new Uint8Array(taille);
  crypto.getRandomValues(octets);
  return octets;
}

export function paireEchange(): Paire {
  const { secretKey, publicKey } = x25519.keygen();
  return { secrete: secretKey, publique: publicKey };
}

export function paireSignature(): Paire {
  const { secretKey, publicKey } = ed25519.keygen();
  return { secrete: secretKey, publique: publicKey };
}

/** Clés publiques recalculées depuis les secrètes : une identité reçue doit être cohérente. */
export const publiqueEchange = (secrete: Uint8Array) => x25519.getPublicKey(secrete);
export const publiqueSignature = (secrete: Uint8Array) => ed25519.getPublicKey(secrete);

/** Secret partagé X25519. Une clé publique de petit ordre est refusée (noble lève une erreur). */
export function echanger(secrete: Uint8Array, publique: Uint8Array): Uint8Array {
  if (publique.length !== TAILLE_CLE) throw new Error("Clé publique invalide.");
  return x25519.getSharedSecret(secrete, publique);
}

export function signer(message: Uint8Array, secrete: Uint8Array): Uint8Array {
  return ed25519.sign(message, secrete);
}

export function verifierSignature(signature: Uint8Array, message: Uint8Array, publique: Uint8Array): boolean {
  if (signature.length !== TAILLE_SIGNATURE || publique.length !== TAILLE_CLE) return false;
  try {
    return ed25519.verify(signature, message, publique);
  } catch {
    return false;
  }
}

export function deriver(ikm: Uint8Array, sel: Uint8Array, info: string, taille: number): Uint8Array {
  return hkdf(sha256, ikm, sel, new TextEncoder().encode(info), taille);
}

export function authentifier(cle: Uint8Array, message: Uint8Array): Uint8Array {
  return hmac(sha256, cle, message);
}

export const empreinteSha256 = (octets: Uint8Array) => sha256(octets);

const TAILLE_NONCE = 12;

/** AES-256-GCM avec un nonce donné : réservé aux clés à usage unique (clés de message). */
export function chiffrerAead(cle: Uint8Array, nonce: Uint8Array, clair: Uint8Array, associe: Uint8Array): Uint8Array {
  return gcm(cle, nonce, associe).encrypt(clair);
}

export function dechiffrerAead(cle: Uint8Array, nonce: Uint8Array, chiffre: Uint8Array, associe: Uint8Array): Uint8Array {
  try {
    return gcm(cle, nonce, associe).decrypt(chiffre);
  } catch {
    throw new Error("Message altéré ou clé incorrecte.");
  }
}

/**
 * Chiffrement d'un contenu sous une clé aléatoire (corps d'un message,
 * fichier) : nonce tiré au hasard, placé devant le texte chiffré.
 */
export function sceller(cle: Uint8Array, clair: Uint8Array, associe: Uint8Array): Uint8Array {
  const nonce = aleatoire(TAILLE_NONCE);
  return assembler(nonce, chiffrerAead(cle, nonce, clair, associe));
}

export function ouvrir(cle: Uint8Array, scelle: Uint8Array, associe: Uint8Array): Uint8Array {
  if (scelle.length < TAILLE_NONCE + 16) throw new Error("Contenu tronqué.");
  return dechiffrerAead(cle, scelle.subarray(0, TAILLE_NONCE), scelle.subarray(TAILLE_NONCE), associe);
}
