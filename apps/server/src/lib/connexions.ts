import type { Bindings } from "../types";

/**
 * Coupe les connexions temps réel de sessions fermées. Sans cela, un appareil
 * déconnecté à distance continuerait de recevoir les messages tant que sa
 * connexion reste ouverte.
 */
export async function fermerConnexions(env: Bindings, utilisateurId: string, sessionIds: string[]): Promise<void> {
  if (sessionIds.length === 0) return;
  const boite = env.BOITE.get(env.BOITE.idFromName(utilisateurId));
  for (const id of sessionIds) {
    try {
      await boite.fermerSession(id);
    } catch (erreur) {
      console.warn("connexion non fermée", String(erreur));
    }
  }
}
