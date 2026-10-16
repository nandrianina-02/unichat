import { assembler, entier32, lireEntier32, versHex } from "./octets";
import { TAILLE_CLE, authentifier, chiffrerAead, dechiffrerAead, deriver, echanger, paireEchange, type Paire } from "./primitives";

/**
 * Double Ratchet, tel que le décrit la spécification de Signal
 * (signal.org/docs/specifications/doubleratchet). Chaque message a sa propre
 * clé, oubliée sitôt servie : une clé volée aujourd'hui n'ouvre ni les
 * messages passés, ni, après le prochain échange, les messages futurs.
 *
 * L'état est une donnée simple (octets et nombres) : l'appelant le range où
 * il veut (IndexedDB sur le web) et le remplace après chaque opération.
 */

export interface EtatRatchet {
  /** Ma paire de ratchet du moment. */
  dhs: Paire;
  /** La clé de ratchet de l'autre, inconnue tant qu'il n'a rien envoyé. */
  dhr: Uint8Array | null;
  rk: Uint8Array;
  cks: Uint8Array | null;
  ckr: Uint8Array | null;
  ns: number;
  nr: number;
  pn: number;
  /** Clés de messages sautés (arrivés dans le désordre), par « clé de ratchet:numéro ». */
  sautees: Record<string, Uint8Array>;
  /** Ordre d'arrivée des clés sautées : les plus anciennes partent en premier. */
  ordre: string[];
}

export interface EnTeteRatchet {
  dh: Uint8Array;
  pn: number;
  n: number;
}

/** Messages qu'une chaîne peut sauter d'un coup : au-delà, c'est une attaque ou une perte massive. */
export const SAUT_MAX = 1000;
/** Clés sautées gardées en tout, toutes chaînes confondues. */
export const SAUTEES_MAX = 2000;
export const TAILLE_ENTETE = TAILLE_CLE + 8;

const INFO_RACINE = "UniChat-ratchet-v1";
const INFO_MESSAGE = "UniChat-message-v1";
const SEL_NUL = new Uint8Array(32);
const GRAINE_MESSAGE = Uint8Array.of(1);
const GRAINE_CHAINE = Uint8Array.of(2);

function kdfRacine(rk: Uint8Array, dh: Uint8Array): [Uint8Array, Uint8Array] {
  const sortie = deriver(dh, rk, INFO_RACINE, 64);
  return [sortie.slice(0, 32), sortie.slice(32)];
}

function kdfChaine(ck: Uint8Array): [Uint8Array, Uint8Array] {
  return [authentifier(ck, GRAINE_CHAINE), authentifier(ck, GRAINE_MESSAGE)];
}

/** Clé AES et nonce tirés de la clé de message : chacune ne sert qu'une fois. */
function cleEtNonce(mk: Uint8Array): [Uint8Array, Uint8Array] {
  const sortie = deriver(mk, SEL_NUL, INFO_MESSAGE, 44);
  return [sortie.slice(0, 32), sortie.slice(32)];
}

export function encoderEnTete(e: EnTeteRatchet): Uint8Array {
  return assembler(e.dh, entier32(e.pn), entier32(e.n));
}

export function lireEnTete(octets: Uint8Array, decalage = 0): EnTeteRatchet {
  if (octets.length < decalage + TAILLE_ENTETE) throw new Error("Message tronqué.");
  return {
    dh: octets.slice(decalage, decalage + TAILLE_CLE),
    pn: lireEntier32(octets, decalage + TAILLE_CLE),
    n: lireEntier32(octets, decalage + TAILLE_CLE + 4),
  };
}

/** Celui qui ouvre la session (après X3DH) : il connaît déjà la clé signée de l'autre. */
export function initierEmetteur(sk: Uint8Array, cleSigneeDistante: Uint8Array): EtatRatchet {
  const dhs = paireEchange();
  const [rk, cks] = kdfRacine(sk, echanger(dhs.secrete, cleSigneeDistante));
  return { dhs, dhr: cleSigneeDistante, rk, cks, ckr: null, ns: 0, nr: 0, pn: 0, sautees: {}, ordre: [] };
}

/** Celui qui reçoit la session : sa clé signée sert de première clé de ratchet. */
export function initierRecepteur(sk: Uint8Array, cleSignee: Paire): EtatRatchet {
  return { dhs: cleSignee, dhr: null, rk: sk, cks: null, ckr: null, ns: 0, nr: 0, pn: 0, sautees: {}, ordre: [] };
}

export function chiffrerRatchet(etat: EtatRatchet, clair: Uint8Array, associe: Uint8Array): { etat: EtatRatchet; entete: Uint8Array; chiffre: Uint8Array } {
  if (!etat.cks) throw new Error("Session pas encore prête à envoyer.");
  const suivant = structuredClone(etat);
  const [cks, mk] = kdfChaine(suivant.cks!);
  suivant.cks = cks;
  const entete = encoderEnTete({ dh: suivant.dhs.publique, pn: suivant.pn, n: suivant.ns });
  suivant.ns += 1;
  const [cle, nonce] = cleEtNonce(mk);
  return { etat: suivant, entete, chiffre: chiffrerAead(cle, nonce, clair, assembler(associe, entete)) };
}

/**
 * Déchiffre sur une copie de l'état : si l'authentification échoue, rien
 * n'a bougé (la spécification insiste, sinon un message forgé suffirait à
 * désynchroniser la session).
 */
export function dechiffrerRatchet(etat: EtatRatchet, enteteOctets: Uint8Array, chiffre: Uint8Array, associe: Uint8Array): { etat: EtatRatchet; clair: Uint8Array } {
  const entete = lireEnTete(enteteOctets);
  const suivant = structuredClone(etat);
  const aad = assembler(associe, enteteOctets);

  const repere = `${versHex(entete.dh)}:${entete.n}`;
  const sautee = suivant.sautees[repere];
  if (sautee) {
    const [cle, nonce] = cleEtNonce(sautee);
    const clair = dechiffrerAead(cle, nonce, chiffre, aad);
    delete suivant.sautees[repere];
    suivant.ordre = suivant.ordre.filter((r) => r !== repere);
    return { etat: suivant, clair };
  }

  if (!suivant.dhr || versHex(entete.dh) !== versHex(suivant.dhr)) {
    sauter(suivant, entete.pn);
    // Pas de ratchet DH sans clé de l'autre : premier message reçu.
    suivant.pn = suivant.ns;
    suivant.ns = 0;
    suivant.nr = 0;
    suivant.dhr = entete.dh;
    [suivant.rk, suivant.ckr] = kdfRacine(suivant.rk, echanger(suivant.dhs.secrete, suivant.dhr));
    suivant.dhs = paireEchange();
    [suivant.rk, suivant.cks] = kdfRacine(suivant.rk, echanger(suivant.dhs.secrete, suivant.dhr));
  }
  sauter(suivant, entete.n);
  if (entete.n < suivant.nr) throw new Error("Message déjà reçu.");
  const [ckr, mk] = kdfChaine(suivant.ckr!);
  suivant.ckr = ckr;
  suivant.nr += 1;
  const [cle, nonce] = cleEtNonce(mk);
  return { etat: suivant, clair: dechiffrerAead(cle, nonce, chiffre, aad) };
}

function sauter(etat: EtatRatchet, jusqua: number): void {
  if (!etat.ckr) return;
  if (jusqua - etat.nr > SAUT_MAX) throw new Error("Trop de messages manquants.");
  while (etat.nr < jusqua) {
    const [ckr, mk] = kdfChaine(etat.ckr);
    etat.ckr = ckr;
    const repere = `${versHex(etat.dhr!)}:${etat.nr}`;
    etat.sautees[repere] = mk;
    etat.ordre.push(repere);
    etat.nr += 1;
  }
  while (etat.ordre.length > SAUTEES_MAX) delete etat.sautees[etat.ordre.shift()!];
}
