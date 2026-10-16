-- Étape 3 : annuaire des clés publiques du chiffrement de bout en bout.
-- Le serveur ne reçoit jamais de clé privée ; il publie ce que les appareils
-- déposent, et chaque application vérifie elle-même les signatures.

-- Identité d'un compte, partagée par ses appareils (modèle de Signal).
CREATE TABLE identites (
  utilisateur_id TEXT PRIMARY KEY REFERENCES utilisateurs (id) ON DELETE CASCADE,
  cle_signature TEXT NOT NULL,
  cle_echange TEXT NOT NULL,
  preuve TEXT NOT NULL,
  -- Augmente à chaque réinitialisation : les correspondants voient le changement.
  version INTEGER NOT NULL,
  -- Numéros d'appareil jamais réutilisés : une session ouverte avec un ancien
  -- appareil ne doit pas servir pour un nouveau.
  prochain_numero INTEGER NOT NULL,
  cree_le INTEGER NOT NULL
);

-- Appareils inscrits. Un appareil survit à sa session (reconnexion sur le
-- même navigateur, avec son jeton), pas à une déconnexion à distance.
CREATE TABLE appareils_cles (
  utilisateur_id TEXT NOT NULL REFERENCES identites (utilisateur_id) ON DELETE CASCADE,
  numero INTEGER NOT NULL,
  session_id TEXT REFERENCES sessions (id) ON DELETE SET NULL,
  jeton_hash TEXT NOT NULL,
  cle_signee_id INTEGER NOT NULL,
  cle_signee TEXT NOT NULL,
  signature TEXT NOT NULL,
  cle_signee_le INTEGER NOT NULL,
  cree_le INTEGER NOT NULL,
  vu_le INTEGER NOT NULL,
  PRIMARY KEY (utilisateur_id, numero)
);
CREATE UNIQUE INDEX appareils_cles_session ON appareils_cles (session_id);

-- Clés à usage unique : chacune est remise une seule fois, puis effacée.
CREATE TABLE cles_uniques (
  utilisateur_id TEXT NOT NULL,
  numero INTEGER NOT NULL,
  cle_id INTEGER NOT NULL,
  cle TEXT NOT NULL,
  PRIMARY KEY (utilisateur_id, numero, cle_id),
  FOREIGN KEY (utilisateur_id, numero) REFERENCES appareils_cles (utilisateur_id, numero) ON DELETE CASCADE
);
