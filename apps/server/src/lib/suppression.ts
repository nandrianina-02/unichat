import type { Bindings } from "../types";

/**
 * Suppression définitive d'un compte. La base efface en cascade la photo,
 * les sessions, les contacts (dans les deux sens) et le journal de sécurité ;
 * la boîte aux lettres efface les messages en attente. Les messages déjà
 * remis restent sur les appareils de leurs destinataires, comme une lettre
 * reçue.
 */
export async function supprimerCompte(env: Bindings, utilisateurId: string): Promise<void> {
  await env.DB.prepare("DELETE FROM utilisateurs WHERE id = ?1").bind(utilisateurId).run();
  await env.BOITE.get(env.BOITE.idFromName(utilisateurId)).toutEffacer();
}
