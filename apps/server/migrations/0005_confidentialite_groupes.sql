-- Confidentialité (dernière connexion, en ligne, confirmations de lecture,
-- ajout aux groupes), photo et lien d'invitation des groupes.

ALTER TABLE utilisateurs ADD COLUMN visibilite_vu TEXT NOT NULL DEFAULT 'tous'
  CHECK (visibilite_vu IN ('tous', 'contacts', 'personne'));
-- « comme_vu » : « en ligne » suit le réglage de la dernière connexion.
ALTER TABLE utilisateurs ADD COLUMN en_ligne TEXT NOT NULL DEFAULT 'tous'
  CHECK (en_ligne IN ('tous', 'comme_vu'));
ALTER TABLE utilisateurs ADD COLUMN confirmations_lecture INTEGER NOT NULL DEFAULT 1
  CHECK (confirmations_lecture IN (0, 1));
ALTER TABLE utilisateurs ADD COLUMN ajout_groupes TEXT NOT NULL DEFAULT 'tous'
  CHECK (ajout_groupes IN ('tous', 'contacts'));

ALTER TABLE groupes ADD COLUMN photo_version TEXT;
-- Code du lien d'invitation (aléatoire, 128 bits) ; NULL tant qu'aucun lien n'a été créé.
ALTER TABLE groupes ADD COLUMN invitation TEXT;
CREATE UNIQUE INDEX groupes_invitation ON groupes (invitation);

CREATE TABLE photos_groupes (
  groupe_id TEXT PRIMARY KEY REFERENCES groupes (id) ON DELETE CASCADE,
  version TEXT NOT NULL,
  type TEXT NOT NULL,
  grande BLOB NOT NULL,
  petite BLOB NOT NULL,
  maj_le INTEGER NOT NULL
);
