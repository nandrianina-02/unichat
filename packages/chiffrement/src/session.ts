import { verifierIdentite, type CleSignee, type CleUnique, type IdentitePrivee, type IdentitePublique, type Paquet } from "./identite";
import { assembler, egaux, entier32, lireEntier32 } from "./octets";
import { TAILLE_CLE, TAILLE_SIGNATURE } from "./primitives";
import { TAILLE_ENTETE, chiffrerRatchet, dechiffrerRatchet, initierEmetteur, initierRecepteur, type EtatRatchet } from "./ratchet";
import { accepterX3DH, ouvrirX3DH, type OuvertureX3DH } from "./x3dh";

/**
 * Sessions avec un appareil distant. Comme dans Signal, on en garde
 * plusieurs : quand deux appareils s'écrivent pour la première fois au même
 * instant, chacun ouvre la sienne ; la plus récemment utilisée devient
 * l'active, et les messages en route sur l'autre restent lisibles.
 */

export interface Session {
  ratchet: EtatRatchet;
  ad: Uint8Array;
  /** Clé éphémère de l'ouverture X3DH : elle reconnaît la session. */
  ephemere: Uint8Array;
  /** Tant que l'autre n'a pas répondu, chaque message rejoint l'ouverture : le premier peut se perdre. */
  ouverture?: OuvertureX3DH;
  identite: IdentitePublique;
}

export interface Correspondant {
  /** La session active d'abord. */
  sessions: Session[];
}

export const SESSIONS_MAX = 5;

const VERSION = 1;
const TYPE_MESSAGE = 1;
const TYPE_OUVERTURE = 2;
const TAILLE_OUVERTURE = TAILLE_CLE * 3 + TAILLE_SIGNATURE + 8;

/** Clés de l'appareil qui reçoit : il les retrouve par leur numéro. */
export interface ClesLocales {
  identite: IdentitePrivee;
  cleSignee: (id: number) => CleSignee | undefined;
  cleUnique: (id: number) => CleUnique | undefined;
}

export interface Dechiffre {
  correspondant: Correspondant;
  clair: Uint8Array;
  /** Identité de l'expéditeur : à comparer à celle déjà connue (changement de clés). */
  identite: IdentitePublique;
  /** Clé unique consommée par cette ouverture : à effacer une fois la session rangée. */
  cleUniqueUtilisee: number;
  nouvelleSession: boolean;
}

function encoderOuverture(o: OuvertureX3DH): Uint8Array {
  return assembler(o.identite.signature, o.identite.echange, o.identite.preuve, o.ephemere, entier32(o.cleSigneeId), entier32(o.cleUniqueId));
}

function lireOuverture(octets: Uint8Array, d: number): OuvertureX3DH {
  if (octets.length < d + TAILLE_OUVERTURE) throw new Error("Message tronqué.");
  const tranche = (debut: number, taille: number) => octets.slice(d + debut, d + debut + taille);
  return {
    identite: { signature: tranche(0, 32), echange: tranche(32, 32), preuve: tranche(64, 64) },
    ephemere: tranche(128, 32),
    cleSigneeId: lireEntier32(octets, d + 160),
    cleUniqueId: lireEntier32(octets, d + 164),
  };
}

/**
 * Chiffre pour un appareil. Sans session active, il faut son paquet de clés
 * (demandé au serveur) : la session s'ouvre par X3DH.
 */
export function chiffrer(
  correspondant: Correspondant | undefined,
  moi: IdentitePrivee,
  clair: Uint8Array,
  paquet?: Paquet,
): { correspondant: Correspondant; message: Uint8Array } {
  let sessions = correspondant?.sessions ?? [];
  let active = sessions[0];
  if (!active?.ratchet.cks) {
    if (!paquet) throw new Error("Aucune session avec cet appareil : son paquet de clés est nécessaire.");
    const { sk, ad, ouverture } = ouvrirX3DH(moi, paquet);
    active = { ratchet: initierEmetteur(sk, paquet.cleSignee.cle), ad, ephemere: ouverture.ephemere, ouverture, identite: paquet.identite };
    sessions = [active, ...sessions].slice(0, SESSIONS_MAX);
  }
  const { etat, entete, chiffre } = chiffrerRatchet(active.ratchet, clair, active.ad);
  const suite: Session = { ...active, ratchet: etat };
  const message = suite.ouverture
    ? assembler(Uint8Array.of(VERSION, TYPE_OUVERTURE), encoderOuverture(suite.ouverture), entete, chiffre)
    : assembler(Uint8Array.of(VERSION, TYPE_MESSAGE), entete, chiffre);
  return { correspondant: { sessions: [suite, ...sessions.slice(1)] }, message };
}

export function dechiffrer(correspondant: Correspondant | undefined, message: Uint8Array, cles: ClesLocales): Dechiffre {
  if (message.length < 2 || message[0] !== VERSION) throw new Error("Version de message inconnue.");
  const sessions = correspondant?.sessions ?? [];

  if (message[1] === TYPE_OUVERTURE) {
    const o = lireOuverture(message, 2);
    if (!verifierIdentite(o.identite)) throw new Error("Identité de l'expéditeur invalide.");
    const debut = 2 + TAILLE_OUVERTURE;
    const entete = message.subarray(debut, debut + TAILLE_ENTETE);
    const chiffre = message.subarray(debut + TAILLE_ENTETE);
    // L'émetteur n'a pas encore eu de réponse : la session existe déjà ici.
    const connue = sessions.findIndex((s) => egaux(s.ephemere, o.ephemere));
    if (connue >= 0) return dechiffrerSur(sessions, connue, entete, chiffre);

    const cleSignee = cles.cleSignee(o.cleSigneeId);
    if (!cleSignee) throw new Error("Clé signée inconnue ou trop ancienne.");
    const cleUnique = o.cleUniqueId ? cles.cleUnique(o.cleUniqueId) : undefined;
    if (o.cleUniqueId && !cleUnique) throw new Error("Clé unique déjà utilisée.");
    const { sk, ad } = accepterX3DH(cles.identite, cleSignee, cleUnique, o);
    const { etat, clair } = dechiffrerRatchet(initierRecepteur(sk, cleSignee.paire), entete, chiffre, ad);
    const nouvelle: Session = { ratchet: etat, ad, ephemere: o.ephemere, identite: o.identite };
    return {
      correspondant: { sessions: [nouvelle, ...sessions].slice(0, SESSIONS_MAX) },
      clair,
      identite: o.identite,
      cleUniqueUtilisee: o.cleUniqueId,
      nouvelleSession: true,
    };
  }

  if (message[1] !== TYPE_MESSAGE) throw new Error("Type de message inconnu.");
  const entete = message.subarray(2, 2 + TAILLE_ENTETE);
  const chiffre = message.subarray(2 + TAILLE_ENTETE);
  let raison = "aucune session avec cet appareil";
  for (let i = 0; i < sessions.length; i++) {
    try {
      return dechiffrerSur(sessions, i, entete, chiffre);
    } catch (erreur) {
      // On essaie la session suivante ; la raison retenue est celle de l'active.
      if (i === 0) raison = erreur instanceof Error ? erreur.message : String(erreur);
    }
  }
  throw new Error(`Message indéchiffrable : ${raison}`);
}

function dechiffrerSur(sessions: Session[], i: number, entete: Uint8Array, chiffre: Uint8Array): Dechiffre {
  const session = sessions[i]!;
  const { etat, clair } = dechiffrerRatchet(session.ratchet, entete, chiffre, session.ad);
  // Un message reçu sur la session prouve que l'autre l'a : plus besoin de l'ouverture.
  const { ouverture: _, ...reste } = session;
  const suite: Session = { ...reste, ratchet: etat };
  return {
    correspondant: { sessions: [suite, ...sessions.filter((_, j) => j !== i)] },
    clair,
    identite: session.identite,
    cleUniqueUtilisee: 0,
    nouvelleSession: false,
  };
}

/**
 * Clés locales que réclame un message d'ouverture (clé signée, clé unique),
 * lues avant de déchiffrer : l'application les cherche dans son stockage.
 * Null pour un message ordinaire.
 */
export function exigencesOuverture(message: Uint8Array): { cleSigneeId: number; cleUniqueId: number } | null {
  if (message.length < 2 + TAILLE_OUVERTURE || message[0] !== VERSION || message[1] !== TYPE_OUVERTURE) return null;
  const o = lireOuverture(message, 2);
  return { cleSigneeId: o.cleSigneeId, cleUniqueId: o.cleUniqueId };
}
