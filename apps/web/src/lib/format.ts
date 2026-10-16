const heure = new Intl.DateTimeFormat("fr-FR", { hour: "2-digit", minute: "2-digit" });
const date = new Intl.DateTimeFormat("fr-FR", { day: "numeric", month: "long", year: "numeric" });
let regions: Intl.DisplayNames | null = null;

/** « à l'instant », « il y a 5 min », « aujourd'hui à 14:05 », « hier à 09:12 », « 3 mars 2026 ». */
export function quand(horodatage: number, maintenant = Date.now()): string {
  const ecart = maintenant - horodatage;
  if (ecart < 60_000) return "à l'instant";
  if (ecart < 3_600_000) return `il y a ${Math.floor(ecart / 60_000)} min`;
  const jour = new Date(horodatage);
  const aujourdhui = new Date(maintenant);
  const hier = new Date(maintenant - 86_400_000);
  const memeJour = (a: Date, b: Date) => a.toDateString() === b.toDateString();
  if (memeJour(jour, aujourdhui)) return `aujourd'hui à ${heure.format(jour)}`;
  if (memeJour(jour, hier)) return `hier à ${heure.format(jour)}`;
  return date.format(jour);
}

/** « Antananarivo, Madagascar » à partir de la ville et du code pays. */
export function lieu(ville: string | null, pays: string | null): string | null {
  let nomPays: string | null = null;
  if (pays) {
    try {
      regions ??= new Intl.DisplayNames(["fr"], { type: "region" });
      nomPays = regions.of(pays) ?? pays;
    } catch {
      nomPays = pays;
    }
  }
  return [ville, nomPays].filter(Boolean).join(", ") || null;
}

const jourSemaine = new Intl.DateTimeFormat("fr-FR", { weekday: "long" });
const dateCourte = new Intl.DateTimeFormat("fr-FR", { day: "2-digit", month: "2-digit", year: "numeric" });
const jourMois = new Intl.DateTimeFormat("fr-FR", { day: "numeric", month: "long" });

function debutJour(t: number): number {
  const d = new Date(t);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

const majuscule = (texte: string) => texte.charAt(0).toUpperCase() + texte.slice(1);

export const heureCourte = (le: number) => heure.format(new Date(le));

/** Séparateur de jour dans une discussion : « Aujourd'hui », « Hier », « Lundi », « 3 mars 2026 ». */
export function jourMessage(le: number, maintenant = Date.now()): string {
  const ecart = Math.round((debutJour(maintenant) - debutJour(le)) / 86_400_000);
  if (ecart === 0) return "Aujourd'hui";
  if (ecart === 1) return "Hier";
  if (ecart < 7) return majuscule(jourSemaine.format(new Date(le)));
  return date.format(new Date(le));
}

/** Heure affichée dans la liste des discussions : « 14:05 », « Hier », « lundi », « 03/03/2026 ». */
export function dateListe(le: number, maintenant = Date.now()): string {
  const ecart = Math.round((debutJour(maintenant) - debutJour(le)) / 86_400_000);
  if (ecart === 0) return heure.format(new Date(le));
  if (ecart === 1) return "Hier";
  if (ecart < 7) return jourSemaine.format(new Date(le));
  return dateCourte.format(new Date(le));
}

/** « vu aujourd'hui à 14:05 », « vu hier à 09:12 », « vu le 3 mars à 10:00 ». */
export function vuLe(le: number, maintenant = Date.now()): string {
  const ecart = Math.round((debutJour(maintenant) - debutJour(le)) / 86_400_000);
  if (ecart === 0) return `vu aujourd'hui à ${heure.format(new Date(le))}`;
  if (ecart === 1) return `vu hier à ${heure.format(new Date(le))}`;
  return `vu le ${jourMois.format(new Date(le))} à ${heure.format(new Date(le))}`;
}

/** « Bob », « Bob et Lova », « Bob, Lova et Hery ». */
export function enumeration(noms: string[]): string {
  if (noms.length <= 1) return noms[0] ?? "";
  return `${noms.slice(0, -1).join(", ")} et ${noms[noms.length - 1]}`;
}

/** Ligne système d'un groupe : « Ana a ajouté Bob et Lova ». `nom` donne « Vous » pour soi. */
export function texteEvenement(
  ev: { action: string; par: string; cibles: string[]; nom?: string },
  nom: (id: string) => string,
): string {
  const qui = nom(ev.par);
  const noms = ev.cibles.map(nom);
  // « Ana vous a ajouté », « Ana a ajouté Bob et vous » : le pronom suit la grammaire.
  const seulementMoi = noms.length === 1 && noms[0] === "Vous";
  const cibles = enumeration(noms.map((n) => (n === "Vous" ? "vous" : n)));
  const verbe = (participe: string) =>
    seulementMoi ? `${qui} vous a ${participe}` : `${qui} ${qui === "Vous" ? "avez" : "a"} ${participe} ${cibles}`;
  switch (ev.action) {
    case "creation":
      return `${qui} ${qui === "Vous" ? "avez" : "a"} créé le groupe « ${ev.nom ?? ""} »`;
    case "ajout":
      return verbe("ajouté");
    case "retrait":
      return verbe("retiré");
    case "depart":
      return `${qui} ${qui === "Vous" ? "êtes parti du groupe" : "est parti du groupe"}`;
    case "renommage":
      return `${qui} ${qui === "Vous" ? "avez" : "a"} renommé le groupe en « ${ev.nom ?? ""} »`;
    case "description":
      return `${qui} ${qui === "Vous" ? "avez" : "a"} modifié la description du groupe`;
    default:
      return "Le groupe a changé";
  }
}

export function initiales(nom: string): string {
  return nom
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((m) => m[0]!.toUpperCase())
    .join("");
}

/** Nom d'un fichier joint quand il n'a pas de légende : « Photo », « Message vocal », ou le nom du document. */
export function libelleMedia(media: { type: string; nom: string; vocal?: boolean }): string {
  switch (media.type) {
    case "image":
      return "Photo";
    case "video":
      return "Vidéo";
    case "audio":
      return media.vocal ? "Message vocal" : "Audio";
    default:
      return media.nom;
  }
}

/** Texte qui résume un message ailleurs que dans sa bulle : citation, notification, liste. */
export const resumeMessage = (m: { texte: string; media?: { type: string; nom: string; vocal?: boolean } }) =>
  m.texte || (m.media ? libelleMedia(m.media) : "");

/** « 0:07 », « 12:40 », « 1:02:03 ». */
export function dureeCourte(secondes: number): string {
  const s = Math.max(0, Math.round(secondes));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const reste = String(s % 60).padStart(2, "0");
  return h > 0 ? `${h}:${String(m).padStart(2, "0")}:${reste}` : `${m}:${reste}`;
}

const nombre = new Intl.NumberFormat("fr-FR", { maximumFractionDigits: 1 });

/** « 820 o », « 34 ko », « 2,4 Mo ». */
export function tailleFichier(octets: number): string {
  if (octets < 1024) return `${octets} o`;
  if (octets < 1024 * 1024) return `${Math.round(octets / 1024)} ko`;
  return `${nombre.format(octets / (1024 * 1024))} Mo`;
}
