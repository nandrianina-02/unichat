-- Socle : comptes Google, sessions par appareil, profils, contacts, sécurité.
-- Horodatages en millisecondes (Date.now()).

CREATE TABLE utilisateurs (
  id TEXT PRIMARY KEY,
  -- Identifiant Google stable ; l'adresse e-mail peut changer de titulaire.
  google_sub TEXT NOT NULL UNIQUE,
  email TEXT NOT NULL,
  nom TEXT NOT NULL,
  -- Nom d'utilisateur, en minuscules ; absent tant que l'accueil n'est pas fait.
  pseudo TEXT UNIQUE,
  infos TEXT NOT NULL,
  photo_version TEXT,
  visibilite_photo TEXT NOT NULL DEFAULT 'tous' CHECK (visibilite_photo IN ('tous', 'contacts', 'personne')),
  visibilite_infos TEXT NOT NULL DEFAULT 'tous' CHECK (visibilite_infos IN ('tous', 'contacts', 'personne')),
  trouvable_email INTEGER NOT NULL DEFAULT 1 CHECK (trouvable_email IN (0, 1)),
  cree_le INTEGER NOT NULL
);
CREATE INDEX utilisateurs_email ON utilisateurs (email);

-- Photos de profil, petites (640 et 128 px, préparées par le navigateur).
CREATE TABLE photos (
  utilisateur_id TEXT PRIMARY KEY REFERENCES utilisateurs (id) ON DELETE CASCADE,
  version TEXT NOT NULL,
  type TEXT NOT NULL,
  grande BLOB NOT NULL,
  petite BLOB NOT NULL,
  maj_le INTEGER NOT NULL
);

-- Une session par appareil. Les jetons ne sont stockés que sous forme d'empreinte.
CREATE TABLE sessions (
  id TEXT PRIMARY KEY,
  utilisateur_id TEXT NOT NULL REFERENCES utilisateurs (id) ON DELETE CASCADE,
  jeton_hash TEXT NOT NULL UNIQUE,
  jeton_precedent_hash TEXT,
  rotation_le INTEGER NOT NULL,
  plateforme TEXT NOT NULL CHECK (plateforme IN ('web', 'android', 'desktop')),
  appareil TEXT NOT NULL,
  ville TEXT,
  pays TEXT,
  cree_le INTEGER NOT NULL,
  vu_le INTEGER NOT NULL,
  expire_le INTEGER NOT NULL,
  alertes_vues_le INTEGER NOT NULL,
  revoquee_le INTEGER,
  motif_revocation TEXT
);
CREATE INDEX sessions_utilisateur ON sessions (utilisateur_id, revoquee_le);
CREATE INDEX sessions_jeton_precedent ON sessions (jeton_precedent_hash);

-- Connexions Google en cours (10 minutes au plus, usage unique).
CREATE TABLE etats_oauth (
  etat_hash TEXT PRIMARY KEY,
  verificateur TEXT NOT NULL,
  nonce TEXT NOT NULL,
  plateforme TEXT NOT NULL,
  cree_le INTEGER NOT NULL
);

CREATE TABLE contacts (
  proprietaire_id TEXT NOT NULL REFERENCES utilisateurs (id) ON DELETE CASCADE,
  contact_id TEXT NOT NULL REFERENCES utilisateurs (id) ON DELETE CASCADE,
  ajoute_le INTEGER NOT NULL,
  PRIMARY KEY (proprietaire_id, contact_id)
);
CREATE INDEX contacts_inverse ON contacts (contact_id);

CREATE TABLE evenements_securite (
  id TEXT PRIMARY KEY,
  utilisateur_id TEXT NOT NULL REFERENCES utilisateurs (id) ON DELETE CASCADE,
  type TEXT NOT NULL,
  session_id TEXT,
  appareil TEXT,
  ville TEXT,
  pays TEXT,
  cree_le INTEGER NOT NULL
);
CREATE INDEX evenements_utilisateur ON evenements_securite (utilisateur_id, cree_le);

-- Compteurs de limitation (fenêtre fixe).
CREATE TABLE limites (
  cle TEXT PRIMARY KEY,
  debut INTEGER NOT NULL,
  compte INTEGER NOT NULL
);
