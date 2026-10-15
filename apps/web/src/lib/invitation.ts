import { schemaPseudo } from "@unichat/shared";

const CLE = "unichat.invitation";

/**
 * Lien de contact `/@pseudo` : retenu le temps de la connexion Google (qui
 * repasse par la page d'accueil), puis repris par l'application.
 */
export function lireLienContact(): void {
  const correspondance = /^\/@([^/]+)\/?$/.exec(window.location.pathname);
  if (!correspondance) return;
  const pseudo = schemaPseudo.safeParse(decodeURIComponent(correspondance[1]!));
  try {
    if (pseudo.success) sessionStorage.setItem(CLE, pseudo.data);
  } catch {
    // Stockage indisponible : l'invitation est simplement ignorée.
  }
  window.history.replaceState(null, "", "/");
}

export function invitationEnAttente(): string | null {
  try {
    return sessionStorage.getItem(CLE);
  } catch {
    return null;
  }
}

export function oublierInvitation(): void {
  try {
    sessionStorage.removeItem(CLE);
  } catch {
    // rien à faire
  }
}

export function lienContact(pseudo: string): string {
  return `${window.location.origin}/@${pseudo}`;
}
