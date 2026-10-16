-- Fichiers joints aux messages, stockés dans Karaks Storage.
-- Pas de clé étrangère vers utilisateurs : à la suppression d'un compte, la
-- ligne doit survivre le temps d'effacer le fichier chez Karaks Storage.

CREATE TABLE medias (
  id TEXT PRIMARY KEY,
  conversation TEXT NOT NULL,
  proprietaire TEXT NOT NULL,
  type TEXT NOT NULL CHECK (type IN ('image', 'video', 'audio', 'document')),
  mime TEXT NOT NULL,
  nom TEXT NOT NULL,
  taille INTEGER NOT NULL,
  -- Session d'envoi reprenable chez Karaks Storage, puis fichier une fois complet.
  envoi_id TEXT NOT NULL,
  fichier_id TEXT,
  cree_le INTEGER NOT NULL,
  termine_le INTEGER,
  expire_le INTEGER NOT NULL
);
CREATE INDEX medias_expiration ON medias (expire_le);
CREATE INDEX medias_proprietaire ON medias (proprietaire);
