/**
 * Forme d'onde d'un message vocal, calculée sur l'appareil à partir du son
 * lui-même : rien à faire voyager avec le message (chiffré ou non), et les
 * messages déjà reçus en profitent aussi.
 */

/** Ce qui tient dans une bulle de 300 px avec le micro et le bouton de lecture. */
export const BARRES = 40;

/**
 * Au-delà, le décodage coûterait trop de mémoire sur un téléphone (un long
 * morceau de musique) ; la piste reste alors une rangée de barres égales.
 */
const OCTETS_MAX = 6 * 1024 * 1024;

/** Barres égales : avant le téléchargement, ou quand le son n'a pas pu être décodé. */
export const ONDE_NEUTRE: readonly number[] = Array.from({ length: BARRES }, () => 0.15);

const calculees = new Map<string, Promise<number[]>>();
let decodeur: OfflineAudioContext | null = null;

/**
 * Une seule fois par message et par session, même si la bulle est affichée
 * plusieurs fois. Le son vient de la copie de l'appareil, pas de son adresse
 * blob: que la politique de sécurité (connect-src 'self') interdit de lire.
 */
export function ondeDuSon(cle: string, taille: number, charger: () => Promise<Blob>): Promise<number[]> {
  if (taille > OCTETS_MAX) return Promise.resolve([...ONDE_NEUTRE]);
  let onde = calculees.get(cle);
  if (!onde) {
    onde = calculer(charger);
    calculees.set(cle, onde);
    onde.catch(() => calculees.delete(cle));
  }
  return onde;
}

async function calculer(charger: () => Promise<Blob>): Promise<number[]> {
  const octets = await (await charger()).arrayBuffer();
  // Le son est rééchantillonné à la fréquence du contexte : 8 kHz suffisent à
  // dessiner une onde et divisent la mémoire par six (un vocal de 15 minutes
  // tient en 29 Mo au lieu de 170).
  decodeur ??= new OfflineAudioContext(1, 1, 8000);
  const son = await decodeur.decodeAudioData(octets);
  return niveaux(son.getChannelData(0), BARRES);
}

/**
 * Énergie moyenne (RMS) de chaque tranche, rapportée à la plus forte : une
 * voix basse remplit la hauteur comme une voix forte, et un silence garde
 * une barre minimale.
 */
export function niveaux(echantillons: Float32Array, n: number): number[] {
  const tranche = Math.max(1, Math.floor(echantillons.length / n));
  const rms: number[] = [];
  for (let i = 0; i < n; i++) {
    let somme = 0;
    const debut = i * tranche;
    const fin = Math.min(echantillons.length, debut + tranche);
    for (let j = debut; j < fin; j++) somme += echantillons[j]! * echantillons[j]!;
    rms.push(fin > debut ? Math.sqrt(somme / (fin - debut)) : 0);
  }
  const max = Math.max(...rms);
  if (max === 0) return [...ONDE_NEUTRE];
  return rms.map((v) => Math.max(0.08, v / max));
}

/** Niveau instantané du micro, de 0 à 1, pour l'onde qui défile pendant l'enregistrement. */
export function niveauInstantane(analyseur: AnalyserNode, tampon: Float32Array<ArrayBuffer>): number {
  analyseur.getFloatTimeDomainData(tampon);
  let somme = 0;
  for (const v of tampon) somme += v * v;
  // Une voix normale donne un RMS de 0,05 à 0,2 : on l'étire pour qu'elle remplisse la barre.
  return Math.min(1, Math.sqrt(somme / tampon.length) * 6);
}
