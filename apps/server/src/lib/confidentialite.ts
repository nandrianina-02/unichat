import type { Visibilite, VisibiliteEnLigne } from "@unichat/shared";
import { visible } from "./profils";

export interface Visibilites {
  /** Le lecteur peut voir la dernière connexion de la personne. */
  vu: boolean;
  /** … et quand elle est en ligne. */
  enLigne: boolean;
  /** Confirmations de lecture échangées entre eux (discussion à deux). */
  lectures: boolean;
}

/**
 * Ce que le lecteur peut voir de la présence d'une personne, comme dans
 * WhatsApp : la dernière connexion suit le réglage de la personne (« mes
 * contacts » : celles qu'elle a ajoutées), et qui cache la sienne ne voit
 * plus celle des autres. Les confirmations de lecture ne circulent que si
 * les deux les ont gardées.
 */
export async function visibilites(db: D1Database, lecteur: string, personne: string): Promise<Visibilites> {
  const l = await db
    .prepare(
      `SELECT p.visibilite_vu AS vu, p.en_ligne, p.confirmations_lecture AS lectures,
         EXISTS (SELECT 1 FROM contacts k WHERE k.proprietaire_id = p.id AND k.contact_id = ?1) AS relation,
         m.visibilite_vu AS mon_vu, m.confirmations_lecture AS mes_lectures
       FROM utilisateurs p, utilisateurs m
       WHERE p.id = ?2 AND m.id = ?1`,
    )
    .bind(lecteur, personne)
    .first<{ vu: Visibilite; en_ligne: VisibiliteEnLigne; lectures: number; relation: number; mon_vu: Visibilite; mes_lectures: number }>();
  if (!l) return { vu: false, enLigne: false, lectures: false };
  const vu = visible(l.vu, false, l.relation === 1) && l.mon_vu !== "personne";
  return {
    vu,
    enLigne: l.en_ligne === "tous" || vu,
    lectures: l.lectures === 1 && l.mes_lectures === 1,
  };
}
