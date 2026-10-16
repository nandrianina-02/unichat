export type Theme = "clair" | "sombre" | "systeme";

const CLE = "unichat.theme";

export function themeActuel(): Theme {
  try {
    const valeur = localStorage.getItem(CLE);
    return valeur === "clair" || valeur === "sombre" ? valeur : "systeme";
  } catch {
    return "systeme";
  }
}

export function appliquerTheme(theme: Theme): void {
  const racine = document.documentElement;
  if (theme === "systeme") delete racine.dataset.theme;
  else racine.dataset.theme = theme;
  try {
    if (theme === "systeme") localStorage.removeItem(CLE);
    else localStorage.setItem(CLE, theme);
  } catch {
    // Stockage bloqué : le thème s'applique pour cette visite seulement.
  }
}

export const FONDS = ["defaut", "brume", "sable", "sauge", "lavande"] as const;
export type Fond = (typeof FONDS)[number];
const CLE_FOND = "unichat.fond";
const CLE_MOTIF = "unichat.motif";

export function fondActuel(): { fond: Fond; motif: boolean } {
  try {
    const fond = localStorage.getItem(CLE_FOND);
    return { fond: (FONDS as readonly string[]).includes(fond ?? "") ? (fond as Fond) : "defaut", motif: localStorage.getItem(CLE_MOTIF) !== "non" };
  } catch {
    return { fond: "defaut", motif: true };
  }
}

/** Fond des discussions : propre à cet appareil, comme le thème. */
export function appliquerFond(fond: Fond, motif: boolean): void {
  const racine = document.documentElement;
  if (fond === "defaut") delete racine.dataset.fond;
  else racine.dataset.fond = fond;
  if (motif) delete racine.dataset.motif;
  else racine.dataset.motif = "non";
  try {
    if (fond === "defaut") localStorage.removeItem(CLE_FOND);
    else localStorage.setItem(CLE_FOND, fond);
    if (motif) localStorage.removeItem(CLE_MOTIF);
    else localStorage.setItem(CLE_MOTIF, "non");
  } catch {
    // Stockage bloqué : le fond s'applique pour cette visite seulement.
  }
}
