import { LIMITES } from "@unichat/shared";

function versBlob(canvas: HTMLCanvasElement, type: string, qualite: number): Promise<Blob> {
  return new Promise((resoudre, rejeter) =>
    canvas.toBlob((blob) => (blob ? resoudre(blob) : rejeter(new Error("encodage impossible"))), type, qualite),
  );
}

async function encoder(source: ImageBitmap, cote: number, taille: number, qualite: number): Promise<Blob> {
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = taille;
  const contexte = canvas.getContext("2d");
  if (!contexte) throw new Error("dessin impossible");
  contexte.imageSmoothingQuality = "high";
  // Recadrage carré centré, comme une photo de profil.
  const x = (source.width - cote) / 2;
  const y = (source.height - cote) / 2;
  contexte.drawImage(source, x, y, cote, cote, 0, 0, taille, taille);
  const webp = await versBlob(canvas, "image/webp", qualite);
  // Certains navigateurs n'encodent pas le WebP et rendent du PNG, bien plus lourd.
  return webp.type === "image/webp" ? webp : versBlob(canvas, "image/jpeg", qualite);
}

/**
 * Prépare une photo de profil dans le navigateur : 640 px et 128 px. Le
 * serveur gratuit n'a pas le temps de calcul nécessaire pour redimensionner,
 * et l'envoi est ainsi beaucoup plus léger.
 */
export async function preparerPhoto(fichier: File): Promise<{ grande: Blob; petite: Blob }> {
  if (!fichier.type.startsWith("image/")) throw new Error("Choisissez une image (JPEG, PNG ou WebP).");
  let source: ImageBitmap;
  try {
    source = await createImageBitmap(fichier);
  } catch {
    throw new Error("Cette image ne peut pas être lue.");
  }
  try {
    const cote = Math.min(source.width, source.height);
    let grande = await encoder(source, cote, 640, 0.84);
    if (grande.size > LIMITES.photoGrande) grande = await encoder(source, cote, 640, 0.6);
    const petite = await encoder(source, cote, 128, 0.8);
    if (grande.size > LIMITES.photoGrande || petite.size > LIMITES.photoPetite) {
      throw new Error("Cette image reste trop lourde, même compressée.");
    }
    return { grande, petite };
  } finally {
    source.close();
  }
}
