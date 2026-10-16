import type { Bindings } from "../types";

/**
 * Suppression définitive d'un compte. La base efface en cascade la photo,
 * les sessions, les contacts (dans les deux sens) et le journal de sécurité ;
 * la boîte aux lettres efface les messages en attente. Les messages déjà
 * remis restent sur les appareils de leurs destinataires, comme une lettre
 * reçue.
 */
export async function supprimerCompte(env: Bindings, utilisateurId: string): Promise<void> {
  await env.DB.batch([
    // Ses fichiers cessent d'être servis ; le nettoyage les efface du stockage.
    env.DB.prepare("UPDATE medias SET expire_le = 0 WHERE proprietaire = ?1").bind(utilisateurId),
    env.DB.prepare("DELETE FROM utilisateurs WHERE id = ?1").bind(utilisateurId),
  ]);
  await env.BOITE.get(env.BOITE.idFromName(utilisateurId)).toutEffacer();
}
