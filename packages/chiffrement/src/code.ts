import { sha512 } from "@noble/hashes/sha2.js";
import { encoderIdentite, type IdentitePublique } from "./identite";
import { assembler, depuisBase64, egaux, texteVersOctets, versBase64 } from "./octets";

/**
 * Code de sécurité (étape 3, lot 7), sur le modèle du numéro de sécurité de
 * Signal. Chaque personne a une empreinte calculée sur son identité et son
 * compte ; le code réunit les deux, la plus petite d'abord, pour que chacun
 * lise les mêmes 60 chiffres sur son écran. Les 5 200 tours de SHA-512
 * rendent très coûteuse la fabrication d'une autre identité qui donnerait
 * les mêmes chiffres.
 */

const VERSION = 0;
const TOURS = 5200;
const TAILLE_EMPREINTE = 32;
/** Préfixe du QR code : un autre QR code (liaison d'appareil, lien) est reconnu comme tel. */
const PREFIXE_QR = "unichat-code:";

export interface Partie {
  compte: string;
  identite: IdentitePublique;
}

export interface CodeSecurite {
  /** 60 chiffres, identiques des deux côtés. */
  chiffres: string;
  /** Contenu du QR code : version, mon empreinte, puis la sienne. */
  qr: string;
}

export type ResultatScan = "identique" | "different" | "invalide";

function empreinte(p: Partie): Uint8Array {
  const cle = encoderIdentite(p.identite);
  let h = sha512(assembler(new Uint8Array([0, VERSION]), cle, texteVersOctets(p.compte)));
  for (let i = 0; i < TOURS; i++) h = sha512(assembler(h, cle));
  return h.subarray(0, TAILLE_EMPREINTE);
}

/** Six blocs de 5 octets, chacun ramené à 5 chiffres : 30 chiffres par personne. */
function chiffres(e: Uint8Array): string {
  let texte = "";
  for (let i = 0; i < 30; i += 5) {
    // 40 bits tiennent exactement dans un nombre JavaScript (moins de 2^53).
    let n = 0;
    for (let j = 0; j < 5; j++) n = n * 256 + e[i + j]!;
    texte += String(n % 100000).padStart(5, "0");
  }
  return texte;
}

export function codeSecurite(moi: Partie, autre: Partie): CodeSecurite {
  const a = empreinte(moi);
  const b = empreinte(autre);
  const [ca, cb] = [chiffres(a), chiffres(b)];
  return {
    chiffres: ca < cb ? ca + cb : cb + ca,
    qr: PREFIXE_QR + versBase64(assembler(new Uint8Array([VERSION]), a, b)),
  };
}

/** Le code affiché par l'autre porte son empreinte puis la mienne : l'inverse du mien. */
export function comparerCodeScanne(scanne: string, mien: CodeSecurite): ResultatScan {
  if (!scanne.startsWith(PREFIXE_QR)) return "invalide";
  let lu: Uint8Array;
  try {
    lu = depuisBase64(scanne.slice(PREFIXE_QR.length));
  } catch {
    return "invalide";
  }
  if (lu.length !== 1 + 2 * TAILLE_EMPREINTE || lu[0] !== VERSION) return "invalide";
  const m = depuisBase64(mien.qr.slice(PREFIXE_QR.length));
  const sien = (o: Uint8Array) => o.subarray(1, 1 + TAILLE_EMPREINTE);
  const autre = (o: Uint8Array) => o.subarray(1 + TAILLE_EMPREINTE);
  return egaux(sien(lu), autre(m)) && egaux(autre(lu), sien(m)) ? "identique" : "different";
}
