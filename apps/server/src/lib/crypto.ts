const encodeur = new TextEncoder();

export function base64url(octets: Uint8Array): string {
  let binaire = "";
  for (const octet of octets) binaire += String.fromCharCode(octet);
  return btoa(binaire).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/** Valeur aléatoire encodée en base64url ; 32 octets = 256 bits. */
export function aleatoire(octets = 32): string {
  const tampon = new Uint8Array(octets);
  crypto.getRandomValues(tampon);
  return base64url(tampon);
}

export function hex(octets: Uint8Array): string {
  return Array.from(octets, (o) => o.toString(16).padStart(2, "0")).join("");
}

async function sha256(donnees: BufferSource): Promise<Uint8Array> {
  return new Uint8Array(await crypto.subtle.digest("SHA-256", donnees));
}

/** Empreinte d'un secret avant stockage : une fuite de la base ne livre aucun jeton utilisable. */
export async function empreinte(texte: string): Promise<string> {
  return hex(await sha256(encodeur.encode(texte)));
}

export async function empreinteOctets(donnees: ArrayBuffer): Promise<string> {
  return hex(await sha256(donnees));
}

/** Défi PKCE (RFC 7636, méthode S256). */
export async function defiPkce(verificateur: string): Promise<string> {
  return base64url(await sha256(encodeur.encode(verificateur)));
}
