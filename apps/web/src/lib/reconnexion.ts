import { ErreurApi, api } from "./api";

/** Le serveur demande une connexion Google de moins de 24 heures pour cette action. */
export const reconnexionRequise = (e: unknown) => e instanceof ErreurApi && e.code === "reconnexion_requise";

/**
 * On ferme cette session (l'appareil garde ses clés et son historique), puis
 * on repasse par Google : la nouvelle session est fraîche.
 */
export async function reconnecter(): Promise<void> {
  await api.deconnexion().catch(() => {});
  location.assign("/api/auth/google");
}
