-- Liaison d'un appareil (étape 3, lot 2) : relais de quelques minutes entre
-- deux appareils du même compte. Le serveur n'y voit que des clés éphémères,
-- une preuve et une identité scellée qu'il ne peut pas ouvrir : le secret
-- qui les protège reste sur l'écran, dans le QR code.

CREATE TABLE liaisons (
  canal TEXT PRIMARY KEY,
  utilisateur_id TEXT NOT NULL REFERENCES utilisateurs (id) ON DELETE CASCADE,
  createur_session TEXT NOT NULL,
  createur_role TEXT NOT NULL CHECK (createur_role IN ('donneur', 'receveur')),
  reponse_session TEXT,
  reponse_cle TEXT,
  reponse_preuve TEXT,
  -- Identité scellée pour le receveur, déposée par un appareil inscrit.
  cles TEXT,
  utilise_le INTEGER,
  cree_le INTEGER NOT NULL,
  expire_le INTEGER NOT NULL
);
CREATE INDEX liaisons_utilisateur ON liaisons (utilisateur_id);
