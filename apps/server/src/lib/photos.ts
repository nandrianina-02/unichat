import { LIMITES } from "@unichat/shared";
import { lireCorpsBorne } from "./corps";
import { empreinteOctets } from "./crypto";
import { refus } from "./erreurs";
import { photoGoogle } from "./google";
import { typeImage, type TypeImage } from "./images";

function tampon(octets: Uint8Array): ArrayBuffer {
  return octets.buffer.slice(octets.byteOffset, octets.byteOffset + octets.byteLength) as ArrayBuffer;
}

export async function enregistrerPhoto(
  db: D1Database,
  utilisateurId: string,
  grande: Uint8Array,
  petite: Uint8Array,
  type: TypeImage,
  maintenant: number,
): Promise<string> {
  // La version change avec le contenu : les navigateurs gardent la photo en
  // cache indéfiniment, et une nouvelle photo a une nouvelle adresse.
  const version = (await empreinteOctets(tampon(grande))).slice(0, 16);
  await db.batch([
    db
      .prepare(
        `INSERT INTO photos (utilisateur_id, version, type, grande, petite, maj_le)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6)
         ON CONFLICT (utilisateur_id) DO UPDATE SET
           version = excluded.version, type = excluded.type, grande = excluded.grande,
           petite = excluded.petite, maj_le = excluded.maj_le`,
      )
      .bind(utilisateurId, version, type, tampon(grande), tampon(petite), maintenant),
    db.prepare("UPDATE utilisateurs SET photo_version = ?1 WHERE id = ?2").bind(version, utilisateurId),
  ]);
  return version;
}

/** Photo préparée par le navigateur (640 et 128 px), envoyée en formulaire : vérifiée avant d'être gardée. */
export async function lirePhotoEnvoyee(requete: Request): Promise<{ grande: Uint8Array; petite: Uint8Array; type: TypeImage }> {
  const brut = await lireCorpsBorne(requete, LIMITES.photoGrande + LIMITES.photoPetite + 4096);
  if (!brut) throw refus.requete("Photo trop lourde.");
  let corps: FormData;
  try {
    corps = await new Response(brut, { headers: { "Content-Type": requete.headers.get("Content-Type") ?? "" } }).formData();
  } catch {
    throw refus.requete("Envoi de photo invalide.");
  }
  const fichiers = [corps.get("grande"), corps.get("petite")];
  if (!fichiers.every((f): f is File => f instanceof File)) throw refus.requete("Photo manquante.");
  const [grande, petite] = await Promise.all(fichiers.map(async (f) => new Uint8Array(await f.arrayBuffer())));
  if (grande!.length > LIMITES.photoGrande || petite!.length > LIMITES.photoPetite) throw refus.requete("Photo trop lourde.");
  const type = typeImage(grande!);
  if (!type || typeImage(petite!) !== type) throw refus.requete("Format d'image non pris en charge.");
  return { grande: grande!, petite: petite!, type };
}

/** Photo d'un groupe : même préparation et même adresse versionnée que les photos de profil. */
export async function enregistrerPhotoGroupe(
  db: D1Database,
  groupeId: string,
  grande: Uint8Array,
  petite: Uint8Array,
  type: TypeImage,
  maintenant: number,
): Promise<string> {
  const version = (await empreinteOctets(tampon(grande))).slice(0, 16);
  await db.batch([
    db
      .prepare(
        `INSERT INTO photos_groupes (groupe_id, version, type, grande, petite, maj_le)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6)
         ON CONFLICT (groupe_id) DO UPDATE SET
           version = excluded.version, type = excluded.type, grande = excluded.grande,
           petite = excluded.petite, maj_le = excluded.maj_le`,
      )
      .bind(groupeId, version, type, tampon(grande), tampon(petite), maintenant),
    db.prepare("UPDATE groupes SET photo_version = ?1 WHERE id = ?2").bind(version, groupeId),
  ]);
  return version;
}

export async function supprimerPhotoGroupe(db: D1Database, groupeId: string): Promise<void> {
  await db.batch([
    db.prepare("DELETE FROM photos_groupes WHERE groupe_id = ?1").bind(groupeId),
    db.prepare("UPDATE groupes SET photo_version = NULL WHERE id = ?1").bind(groupeId),
  ]);
}

export async function supprimerPhoto(db: D1Database, utilisateurId: string): Promise<void> {
  await db.batch([
    db.prepare("DELETE FROM photos WHERE utilisateur_id = ?1").bind(utilisateurId),
    db.prepare("UPDATE utilisateurs SET photo_version = NULL WHERE id = ?1").bind(utilisateurId),
  ]);
}

async function telecharger(recuperer: typeof fetch, url: string, maximum: number): Promise<Uint8Array | null> {
  const reponse = await recuperer(url, { signal: AbortSignal.timeout(5000) });
  if (!reponse.ok) return null;
  const octets = new Uint8Array(await reponse.arrayBuffer());
  return octets.length > 0 && octets.length <= maximum ? octets : null;
}

/**
 * Photo Google reprise à la création du compte, puis servie par UniChat :
 * les contacts n'interrogent pas les serveurs de Google à chaque affichage.
 * Sans succès, le compte est créé sans photo.
 */
export async function importerPhotoGoogle(
  db: D1Database,
  recuperer: typeof fetch,
  utilisateurId: string,
  url: string,
  maintenant: number,
): Promise<void> {
  const urlGrande = photoGoogle(url, 640);
  const urlPetite = photoGoogle(url, 128);
  if (!urlGrande || !urlPetite) return;
  const [grande, petite] = await Promise.all([
    telecharger(recuperer, urlGrande, LIMITES.photoGrande),
    telecharger(recuperer, urlPetite, LIMITES.photoPetite),
  ]);
  if (!grande || !petite) return;
  const type = typeImage(grande);
  if (!type || typeImage(petite) !== type) return;
  await enregistrerPhoto(db, utilisateurId, grande, petite, type, maintenant);
}
