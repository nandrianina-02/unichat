-- Groupes : métadonnées et membres. Les messages de groupe passent par les
-- boîtes aux lettres de chaque membre, comme les messages à deux.

CREATE TABLE groupes (
  id TEXT PRIMARY KEY,
  nom TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  cree_par TEXT REFERENCES utilisateurs (id) ON DELETE SET NULL,
  cree_le INTEGER NOT NULL
);

CREATE TABLE membres (
  groupe_id TEXT NOT NULL REFERENCES groupes (id) ON DELETE CASCADE,
  utilisateur_id TEXT NOT NULL REFERENCES utilisateurs (id) ON DELETE CASCADE,
  role TEXT NOT NULL DEFAULT 'membre' CHECK (role IN ('admin', 'membre')),
  ajoute_le INTEGER NOT NULL,
  PRIMARY KEY (groupe_id, utilisateur_id)
);
CREATE INDEX membres_utilisateur ON membres (utilisateur_id);
