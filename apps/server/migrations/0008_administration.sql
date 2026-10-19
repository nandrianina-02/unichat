-- Administration : suspension des comptes, suite donnée aux signalements,
-- journal des actions. Les administrateurs sont désignés hors de la base
-- (secret ADMINS) : ni une fuite ni une injection dans la base ne suffit à
-- en créer un.

ALTER TABLE utilisateurs ADD COLUMN suspendu_le INTEGER;
ALTER TABLE utilisateurs ADD COLUMN motif_suspension TEXT;
CREATE INDEX utilisateurs_suspendus ON utilisateurs (suspendu_le) WHERE suspendu_le IS NOT NULL;

ALTER TABLE signalements ADD COLUMN decision TEXT;
ALTER TABLE signalements ADD COLUMN traite_par TEXT;

-- Chaque action d'administration, gardée un an. Sans clé étrangère : la trace
-- reste après la suppression du compte visé, ou de celui de l'administrateur.
CREATE TABLE actions_admin (
  id TEXT PRIMARY KEY,
  admin_id TEXT NOT NULL,
  admin_nom TEXT NOT NULL,
  action TEXT NOT NULL,
  cible_type TEXT NOT NULL CHECK (cible_type IN ('utilisateur', 'groupe', 'signalement')),
  cible_id TEXT NOT NULL,
  cible_nom TEXT,
  detail TEXT,
  cree_le INTEGER NOT NULL
);
CREATE INDEX actions_admin_date ON actions_admin (cree_le);
