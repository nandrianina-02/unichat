/**
 * Nom lisible d'un appareil à partir de son User-Agent : « Chrome sur
 * Windows ». Sert à la liste des appareils connectés et aux alertes de
 * connexion ; une approximation suffit, l'ordre des tests compte (Edge et
 * Opera se déclarent aussi « Chrome »).
 */
export function nomAppareil(userAgent: string | undefined): string {
  const ua = userAgent ?? "";
  const navigateur =
    /Edg(A|iOS)?\//.test(ua) ? "Edge"
    : /OPR\/|Opera/.test(ua) ? "Opera"
    : /SamsungBrowser\//.test(ua) ? "Samsung Internet"
    : /Firefox\/|FxiOS\//.test(ua) ? "Firefox"
    : /Chrome\/|CriOS\//.test(ua) ? "Chrome"
    : /Safari\//.test(ua) && /Version\//.test(ua) ? "Safari"
    : null;
  const systeme =
    /Windows/.test(ua) ? "Windows"
    : /Android/.test(ua) ? "Android"
    : /iPhone|iPad|iPod/.test(ua) ? "iOS"
    : /Mac OS X|Macintosh/.test(ua) ? "macOS"
    : /CrOS/.test(ua) ? "ChromeOS"
    : /Linux/.test(ua) ? "Linux"
    : null;
  if (navigateur && systeme) return `${navigateur} sur ${systeme}`;
  return navigateur ?? systeme ?? "Navigateur inconnu";
}
