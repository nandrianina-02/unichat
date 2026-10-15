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

export function initiales(nom: string): string {
  return nom
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((m) => m[0]!.toUpperCase())
    .join("");
}
