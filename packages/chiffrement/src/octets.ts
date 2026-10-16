/** Outils sur les octets : encodage pour le transport, assemblage, comparaison. */

const ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";
const VALEURS = new Map([...ALPHABET].map((c, i) => [c, i]));

/** Base64 « URL » sans remplissage : passe tel quel dans du JSON et dans une adresse. */
export function versBase64(octets: Uint8Array): string {
  let texte = "";
  for (let i = 0; i < octets.length; i += 3) {
    const a = octets[i]!;
    const b = octets[i + 1];
    const c = octets[i + 2];
    texte += ALPHABET[a >> 2]! + ALPHABET[((a & 3) << 4) | ((b ?? 0) >> 4)]!;
    if (b !== undefined) texte += ALPHABET[((b & 15) << 2) | ((c ?? 0) >> 6)]!;
    if (c !== undefined) texte += ALPHABET[c & 63]!;
  }
  return texte;
}

export function depuisBase64(texte: string): Uint8Array {
  if (texte.length % 4 === 1) throw new Error("Base64 invalide.");
  const octets = new Uint8Array(Math.floor((texte.length * 3) / 4));
  let tampon = 0;
  let bits = 0;
  let j = 0;
  for (const c of texte) {
    const v = VALEURS.get(c);
    if (v === undefined) throw new Error("Base64 invalide.");
    tampon = (tampon << 6) | v;
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      octets[j++] = (tampon >> bits) & 0xff;
    }
  }
  return octets;
}

export function assembler(...parties: Uint8Array[]): Uint8Array {
  const total = parties.reduce((n, p) => n + p.length, 0);
  const resultat = new Uint8Array(total);
  let decalage = 0;
  for (const p of parties) {
    resultat.set(p, decalage);
    decalage += p.length;
  }
  return resultat;
}

/** Comparaison en temps constant : la durée ne dit rien de l'endroit où les octets diffèrent. */
export function egaux(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  let difference = 0;
  for (let i = 0; i < a.length; i++) difference |= a[i]! ^ b[i]!;
  return difference === 0;
}

export const texteVersOctets = (texte: string) => new TextEncoder().encode(texte);
export const octetsVersTexte = (octets: Uint8Array) => new TextDecoder("utf-8", { fatal: true, ignoreBOM: false }).decode(octets);

export function entier32(n: number): Uint8Array {
  if (!Number.isInteger(n) || n < 0 || n > 0xffffffff) throw new Error("Entier hors limites.");
  const octets = new Uint8Array(4);
  new DataView(octets.buffer).setUint32(0, n);
  return octets;
}

export function lireEntier32(octets: Uint8Array, decalage: number): number {
  if (decalage + 4 > octets.length) throw new Error("Message tronqué.");
  return new DataView(octets.buffer, octets.byteOffset).getUint32(decalage);
}

export function versHex(octets: Uint8Array): string {
  return [...octets].map((o) => o.toString(16).padStart(2, "0")).join("");
}
