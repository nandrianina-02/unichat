export type TypeImage = "image/jpeg" | "image/png" | "image/webp";

/**
 * Type réel d'une image d'après ses premiers octets. Le type annoncé par le
 * client n'est pas une garantie : seul le contenu fait foi.
 */
export function typeImage(octets: Uint8Array): TypeImage | null {
  if (octets.length >= 3 && octets[0] === 0xff && octets[1] === 0xd8 && octets[2] === 0xff) return "image/jpeg";
  if (octets.length >= 8 && [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a].every((o, i) => octets[i] === o)) {
    return "image/png";
  }
  if (
    octets.length >= 12 &&
    String.fromCharCode(...octets.slice(0, 4)) === "RIFF" &&
    String.fromCharCode(...octets.slice(8, 12)) === "WEBP"
  ) {
    return "image/webp";
  }
  return null;
}

/** D1 rend les BLOB sous forme de tableau de nombres (ou d'ArrayBuffer selon la version). */
export function versOctets(valeur: ArrayBuffer | number[] | Uint8Array): Uint8Array<ArrayBuffer> {
  if (valeur instanceof ArrayBuffer) return new Uint8Array(valeur);
  return Uint8Array.from(valeur);
}
