/**
 * Fichier chiffré sur l'appareil avant l'envoi (étape 3, lot 5) : une clé
 * propre au fichier, AES-256-GCM par le chiffrement natif de la plateforme
 * (WebCrypto, rapide même pour une vidéo de 64 Mo), le nonce devant le
 * texte chiffré. La clé ne voyage que dans le message chiffré qui
 * accompagne le fichier ; le stockage ne voit que des octets.
 */

const TAILLE_NONCE = 12;
/** Nonce devant, étiquette d'authentification derrière. */
export const SURCOUT_FICHIER = TAILLE_NONCE + 16;

const tampon = (o: Uint8Array) => o as Uint8Array<ArrayBuffer>;

export async function chiffrerOctets(clair: Uint8Array): Promise<{ scelle: Uint8Array; cle: Uint8Array }> {
  const cle = crypto.getRandomValues(new Uint8Array(32));
  const nonce = crypto.getRandomValues(new Uint8Array(TAILLE_NONCE));
  const k = await crypto.subtle.importKey("raw", cle, "AES-GCM", false, ["encrypt"]);
  const chiffre = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv: nonce }, k, tampon(clair)));
  const scelle = new Uint8Array(TAILLE_NONCE + chiffre.length);
  scelle.set(nonce);
  scelle.set(chiffre, TAILLE_NONCE);
  return { scelle, cle };
}

/** Un fichier altéré, tronqué ou ouvert avec une autre clé est refusé (étiquette GCM). */
export async function dechiffrerOctets(scelle: Uint8Array, cle: Uint8Array): Promise<Uint8Array> {
  if (scelle.length < SURCOUT_FICHIER || cle.length !== 32) throw new Error("Fichier chiffré invalide.");
  const k = await crypto.subtle.importKey("raw", tampon(cle), "AES-GCM", false, ["decrypt"]);
  try {
    return new Uint8Array(await crypto.subtle.decrypt({ name: "AES-GCM", iv: tampon(scelle.subarray(0, TAILLE_NONCE)) }, k, tampon(scelle.subarray(TAILLE_NONCE))));
  } catch {
    throw new Error("Fichier altéré ou clé incorrecte.");
  }
}
