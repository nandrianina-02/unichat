import type { CarteProfil, Moi, Visibilite } from "@unichat/shared";

export interface LigneUtilisateur {
  id: string;
  google_sub: string;
  email: string;
  nom: string;
  pseudo: string | null;
  infos: string;
  photo_version: string | null;
  visibilite_photo: Visibilite;
  visibilite_infos: Visibilite;
  trouvable_email: number;
  cree_le: number;
}

export function versMoi(u: LigneUtilisateur, sessionId: string): Moi {
  return {
    id: u.id,
    email: u.email,
    nom: u.nom,
    pseudo: u.pseudo,
    infos: u.infos,
    photo: u.photo_version,
    visibilitePhoto: u.visibilite_photo,
    visibiliteInfos: u.visibilite_infos,
    trouvableParEmail: u.trouvable_email === 1,
    sessionId,
  };
}

/**
 * Ce qu'un lecteur a le droit de voir, selon les réglages de la personne :
 * « mes contacts » signifie les personnes que *elle* a ajoutées, comme dans
 * WhatsApp — pas celles qui l'ont ajoutée.
 */
export function visible(reglage: Visibilite, estSoi: boolean, lecteurEstSonContact: boolean): boolean {
  if (estSoi) return true;
  if (reglage === "tous") return true;
  return reglage === "contacts" && lecteurEstSonContact;
}

// Colonnes calculées pour un lecteur donné (?1) : la relation dans les deux sens.
const SELECTION_CARTE = `
  u.id, u.nom, u.pseudo, u.infos, u.photo_version, u.visibilite_photo, u.visibilite_infos,
  EXISTS (SELECT 1 FROM contacts c WHERE c.proprietaire_id = u.id AND c.contact_id = ?1) AS lecteur_est_son_contact,
  EXISTS (SELECT 1 FROM contacts c WHERE c.proprietaire_id = ?1 AND c.contact_id = u.id) AS est_contact,
  EXISTS (SELECT 1 FROM blocages b WHERE b.bloqueur_id = ?1 AND b.bloque_id = u.id) AS bloque,
  EXISTS (SELECT 1 FROM blocages b WHERE b.bloqueur_id = u.id AND b.bloque_id = ?1) AS lecteur_bloque`;

interface LigneCarte {
  id: string;
  nom: string;
  pseudo: string | null;
  infos: string;
  photo_version: string | null;
  visibilite_photo: Visibilite;
  visibilite_infos: Visibilite;
  lecteur_est_son_contact: number;
  est_contact: number;
  bloque: number;
  lecteur_bloque: number;
}

function versCarte(l: LigneCarte, lecteurId: string): CarteProfil {
  const estSoi = l.id === lecteurId;
  const relation = l.lecteur_est_son_contact === 1;
  // Bloqué par la personne : on la voit comme si elle avait choisi « Personne »,
  // sans autre indice — c'est ce que voit quiconque n'y a pas droit.
  const masque = l.lecteur_bloque === 1;
  return {
    id: l.id,
    nom: l.nom,
    pseudo: l.pseudo,
    infos: !masque && visible(l.visibilite_infos, estSoi, relation) ? l.infos : null,
    photo: !masque && visible(l.visibilite_photo, estSoi, relation) ? l.photo_version : null,
    estContact: l.est_contact === 1,
    estSoi,
    bloque: l.bloque === 1,
  };
}

export async function carte(db: D1Database, cibleId: string, lecteurId: string): Promise<CarteProfil | null> {
  const l = await db
    .prepare(`SELECT ${SELECTION_CARTE} FROM utilisateurs u WHERE u.id = ?2 AND u.pseudo IS NOT NULL`)
    .bind(lecteurId, cibleId)
    .first<LigneCarte>();
  return l ? versCarte(l, lecteurId) : null;
}

export async function rechercher(
  db: D1Database,
  critere: { type: "email" | "pseudo"; valeur: string },
  lecteurId: string,
): Promise<CarteProfil[]> {
  // Correspondance exacte uniquement : on ne laisse pas parcourir l'annuaire.
  const condition = critere.type === "email" ? "u.email = ?2 AND u.trouvable_email = 1" : "u.pseudo = ?2";
  const l = await db
    .prepare(`SELECT ${SELECTION_CARTE} FROM utilisateurs u WHERE ${condition} AND u.pseudo IS NOT NULL LIMIT 1`)
    .bind(lecteurId, critere.valeur)
    .first<LigneCarte>();
  return l ? [versCarte(l, lecteurId)] : [];
}

export async function contactsDe(db: D1Database, proprietaireId: string): Promise<CarteProfil[]> {
  const { results } = await db
    .prepare(
      `SELECT ${SELECTION_CARTE}
       FROM contacts k JOIN utilisateurs u ON u.id = k.contact_id
       WHERE k.proprietaire_id = ?1
       ORDER BY u.nom COLLATE NOCASE`,
    )
    .bind(proprietaireId)
    .all<LigneCarte>();
  return results.map((l) => versCarte(l, proprietaireId));
}

export async function bloquesDe(db: D1Database, bloqueurId: string): Promise<CarteProfil[]> {
  const { results } = await db
    .prepare(
      `SELECT ${SELECTION_CARTE}
       FROM blocages b JOIN utilisateurs u ON u.id = b.bloque_id
       WHERE b.bloqueur_id = ?1
       ORDER BY b.bloque_le DESC`,
    )
    .bind(bloqueurId)
    .all<LigneCarte>();
  return results.map((l) => versCarte(l, bloqueurId));
}
