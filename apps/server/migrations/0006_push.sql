-- Abonnements Web Push : un par appareil connecté (session). Effacés avec la
-- session ou le compte ; le service du navigateur les invalide aussi (404, 410).

CREATE TABLE abonnements_push (
  endpoint TEXT PRIMARY KEY,
  session_id TEXT NOT NULL REFERENCES sessions (id) ON DELETE CASCADE,
  utilisateur_id TEXT NOT NULL REFERENCES utilisateurs (id) ON DELETE CASCADE,
  p256dh TEXT NOT NULL,
  auth TEXT NOT NULL,
  cree_le INTEGER NOT NULL
);
CREATE INDEX abonnements_push_utilisateur ON abonnements_push (utilisateur_id);
CREATE INDEX abonnements_push_session ON abonnements_push (session_id);
