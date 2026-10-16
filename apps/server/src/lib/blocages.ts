import { conversationDirecte } from "@unichat/shared";
import type { Bindings } from "../types";

/** Les deux sens d'un blocage entre deux personnes, en une seule lecture. */
export async function blocageEntre(db: D1Database, moi: string, autre: string): Promise<{ jeBloque: boolean; ilBloque: boolean }> {
  const ligne = await db
    .prepare(
      `SELECT EXISTS (SELECT 1 FROM blocages WHERE bloqueur_id = ?1 AND bloque_id = ?2) AS je,
              EXISTS (SELECT 1 FROM blocages WHERE bloqueur_id = ?2 AND bloque_id = ?1) AS il`,
    )
    .bind(moi, autre)
    .first<{ je: number; il: number }>();
  return { jeBloque: ligne?.je === 1, ilBloque: ligne?.il === 1 };
}

/** Prévient mes appareils d'un blocage ou d'un déblocage fait sur l'un d'eux. */
export async function annoncerBlocage(env: Bindings, moi: string, personne: string, bloque: boolean, le: number): Promise<void> {
  const boite = env.BOITE.get(env.BOITE.idFromName(moi));
  await Promise.all([
    boite.recevoir({ type: "blocage", conversation: conversationDirecte(moi, personne), personne, bloque, le }),
    // La boîte de l'autre ne l'apprend pas par un message : on lui demande d'oublier son cache.
    env.BOITE.get(env.BOITE.idFromName(personne)).oublierBlocage(moi),
  ]);
}
