import { assembler, egaux, entier32, texteVersOctets } from "./octets";
import { TAILLE_CLE, TAILLE_SIGNATURE, paireEchange, paireSignature, signer, verifierSignature, type Paire } from "./primitives";

/**
 * Identité d'un compte, partagée par tous ses appareils (modèle de Signal) :
 * une clé de signature Ed25519 et une clé d'échange X25519, la seconde
 * signée par la première. Un nouvel appareil la reçoit d'un appareil déjà
 * relié ; le serveur ne la voit jamais. Il ne peut donc pas inscrire un
 * appareil à la place de son titulaire : il lui faudrait signer ses clés.
 *
 * Chaque appareil publie en plus une clé signée (renouvelée chaque mois) et
 * des clés à usage unique, comme dans X3DH.
 */

export interface IdentitePrivee {
  signature: Paire;
  echange: Paire;
  /** Signature de la clé d'échange par la clé de signature. */
  preuve: Uint8Array;
}

export interface IdentitePublique {
  signature: Uint8Array;
  echange: Uint8Array;
  preuve: Uint8Array;
}

export interface CleSignee {
  id: number;
  paire: Paire;
  signature: Uint8Array;
  creeeLe: number;
}

export interface CleSigneePublique {
  id: number;
  cle: Uint8Array;
  signature: Uint8Array;
}

export interface CleUnique {
  id: number;
  paire: Paire;
}

export interface CleUniquePublique {
  id: number;
  cle: Uint8Array;
}

/** Ce qu'il faut pour ouvrir une session avec un appareil. */
export interface Paquet {
  identite: IdentitePublique;
  cleSignee: CleSigneePublique;
  cleUnique?: CleUniquePublique;
}

// Étiquettes de séparation : une signature produite pour un usage ne peut
// pas être présentée pour un autre.
const ETIQUETTE_IDENTITE = texteVersOctets("UniChat-identite-v1");
const ETIQUETTE_CLE_SIGNEE = texteVersOctets("UniChat-cle-signee-v1");

export function creerIdentite(): IdentitePrivee {
  const signature = paireSignature();
  const echange = paireEchange();
  return { signature, echange, preuve: signer(assembler(ETIQUETTE_IDENTITE, echange.publique), signature.secrete) };
}

export const identitePublique = (i: IdentitePrivee): IdentitePublique => ({
  signature: i.signature.publique,
  echange: i.echange.publique,
  preuve: i.preuve,
});

export function verifierIdentite(i: IdentitePublique): boolean {
  return (
    i.signature.length === TAILLE_CLE &&
    i.echange.length === TAILLE_CLE &&
    i.preuve.length === TAILLE_SIGNATURE &&
    verifierSignature(i.preuve, assembler(ETIQUETTE_IDENTITE, i.echange), i.signature)
  );
}

export const memeIdentite = (a: IdentitePublique, b: IdentitePublique) => egaux(a.signature, b.signature) && egaux(a.echange, b.echange);

/** Les deux clés publiques bout à bout : ce qui désigne l'identité dans les calculs. */
export const encoderIdentite = (i: IdentitePublique) => assembler(i.signature, i.echange);

export function creerCleSignee(identite: IdentitePrivee, id: number, maintenant: number): CleSignee {
  const paire = paireEchange();
  return { id, paire, signature: signer(assembler(ETIQUETTE_CLE_SIGNEE, entier32(id), paire.publique), identite.signature.secrete), creeeLe: maintenant };
}

export const cleSigneePublique = (c: CleSignee): CleSigneePublique => ({ id: c.id, cle: c.paire.publique, signature: c.signature });

export function verifierCleSignee(identite: IdentitePublique, c: CleSigneePublique): boolean {
  return c.cle.length === TAILLE_CLE && verifierSignature(c.signature, assembler(ETIQUETTE_CLE_SIGNEE, entier32(c.id), c.cle), identite.signature);
}

/** Clés à usage unique, numérotées à partir de `premier` (le numéro 0 veut dire « aucune »). */
export function creerClesUniques(premier: number, nombre: number): CleUnique[] {
  if (premier < 1) throw new Error("Les clés uniques sont numérotées à partir de 1.");
  return Array.from({ length: nombre }, (_, i) => ({ id: premier + i, paire: paireEchange() }));
}

export const cleUniquePublique = (c: CleUnique): CleUniquePublique => ({ id: c.id, cle: c.paire.publique });

/** Un paquet n'est utilisable que si l'identité se prouve et signe bien la clé de l'appareil. */
export function verifierPaquet(p: Paquet): boolean {
  return verifierIdentite(p.identite) && verifierCleSignee(p.identite, p.cleSignee) && (!p.cleUnique || (p.cleUnique.id >= 1 && p.cleUnique.cle.length === TAILLE_CLE));
}
