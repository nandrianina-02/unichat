import { conversationGroupe, type ActionGroupe, type Groupe, type MembreGroupe, type RoleGroupe } from "@unichat/shared";
import type { Bindings } from "../types";
import { visible } from "./profils";

interface LigneMembre {
  id: string;
  nom: string;
  pseudo: string | null;
  photo_version: string | null;
  visibilite_photo: "tous" | "contacts" | "personne";
  role: RoleGroupe;
  relation: number;
}

/** Identifiants des membres d'un groupe (vide si le groupe n'existe pas). */
export async function membresDe(db: D1Database, groupeId: string): Promise<{ id: string; role: RoleGroupe }[]> {
  const { results } = await db
    .prepare("SELECT utilisateur_id AS id, role FROM membres WHERE groupe_id = ?1 ORDER BY ajoute_le")
    .bind(groupeId)
    .all<{ id: string; role: RoleGroupe }>();
  return results;
}

export async function groupePour(db: D1Database, groupeId: string, lecteurId: string): Promise<Groupe | null> {
  const g = await db
    .prepare("SELECT id, nom, description, cree_le, photo_version FROM groupes WHERE id = ?1")
    .bind(groupeId)
    .first<{ id: string; nom: string; description: string; cree_le: number; photo_version: string | null }>();
  if (!g) return null;
  const { results } = await db
    .prepare(
      `SELECT u.id, u.nom, u.pseudo, u.photo_version, u.visibilite_photo, m.role,
         EXISTS (SELECT 1 FROM contacts k WHERE k.proprietaire_id = u.id AND k.contact_id = ?2) AS relation
       FROM membres m JOIN utilisateurs u ON u.id = m.utilisateur_id
       WHERE m.groupe_id = ?1
       ORDER BY m.role = 'admin' DESC, u.nom COLLATE NOCASE`,
    )
    .bind(groupeId, lecteurId)
    .all<LigneMembre>();
  const moi = results.find((m) => m.id === lecteurId);
  // Un ancien membre garde le nom du groupe, mais ne voit plus qui en fait partie.
  const membres: MembreGroupe[] = moi
    ? results.map((m) => ({
        id: m.id,
        nom: m.nom,
        pseudo: m.pseudo,
        photo: visible(m.visibilite_photo, m.id === lecteurId, m.relation === 1) ? m.photo_version : null,
        role: m.role,
        estSoi: m.id === lecteurId,
      }))
    : [];
  return {
    id: g.id,
    nom: g.nom,
    description: g.description,
    creeLe: g.cree_le,
    membres,
    moiAdmin: moi?.role === "admin",
    moiMembre: Boolean(moi),
    photo: g.photo_version,
  };
}

/**
 * Événement de groupe (création, ajout, départ…) déposé dans la boîte de
 * chaque destinataire : il s'affiche dans la discussion et met à jour
 * l'application. Les personnes retirées le reçoivent aussi, pour savoir
 * qu'elles ne font plus partie du groupe.
 */
export async function annoncer(
  env: Bindings,
  destinataires: string[],
  e: { groupeId: string; action: ActionGroupe; par: string; cibles: string[]; nom?: string; le: number },
): Promise<void> {
  const evenement = {
    id: crypto.randomUUID(),
    conversation: conversationGroupe(e.groupeId),
    action: e.action,
    par: e.par,
    cibles: e.cibles,
    ...(e.nom !== undefined ? { nom: e.nom } : {}),
    le: e.le,
  };
  await Promise.allSettled(
    [...new Set(destinataires)].map((id) =>
      env.BOITE.get(env.BOITE.idFromName(id)).recevoir({ type: "groupe", evenement }),
    ),
  );
}

/**
 * Un groupe ne reste jamais sans administrateur : si le dernier part, le
 * membre le plus ancien le devient (comme dans les messageries de référence).
 */
export async function garantirAdmin(db: D1Database, groupeId: string): Promise<void> {
  const admin = await db.prepare("SELECT 1 FROM membres WHERE groupe_id = ?1 AND role = 'admin' LIMIT 1").bind(groupeId).first();
  if (admin) return;
  await db
    .prepare(
      `UPDATE membres SET role = 'admin'
       WHERE groupe_id = ?1 AND utilisateur_id = (SELECT utilisateur_id FROM membres WHERE groupe_id = ?1 ORDER BY ajoute_le LIMIT 1)`,
    )
    .bind(groupeId)
    .run();
}
