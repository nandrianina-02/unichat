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

export function initiales(nom: string): string {
  return nom
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((m) => m[0]!.toUpperCase())
    .join("");
}
