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
