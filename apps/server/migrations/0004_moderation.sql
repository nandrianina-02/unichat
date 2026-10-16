-- Blocages et signalements.

-- Qui a bloqué qui. Effacé avec l'un ou l'autre compte.
CREATE TABLE blocages (
  bloqueur_id TEXT NOT NULL REFERENCES utilisateurs (id) ON DELETE CASCADE,
  bloque_id TEXT NOT NULL REFERENCES utilisateurs (id) ON DELETE CASCADE,
  bloque_le INTEGER NOT NULL,
  PRIMARY KEY (bloqueur_id, bloque_id)
);
CREATE INDEX blocages_inverse ON blocages (bloque_id);

-- Signalements, examinés à la main. La cible n'a pas de clé étrangère : un
-- compte supprimé pour échapper à un signalement reste examinable. Effacés
-- après six mois (lib/nettoyage.ts).
CREATE TABLE signalements (
  id TEXT PRIMARY KEY,
  auteur_id TEXT NOT NULL REFERENCES utilisateurs (id) ON DELETE CASCADE,
  type TEXT NOT NULL CHECK (type IN ('personne', 'groupe')),
  cible_id TEXT NOT NULL,
  -- Derniers messages de la cible, joints par l'application (JSON).
  messages TEXT NOT NULL,
  cree_le INTEGER NOT NULL,
  traite_le INTEGER
);
CREATE INDEX signalements_cible ON signalements (cible_id, cree_le);
CREATE INDEX signalements_date ON signalements (cree_le);
