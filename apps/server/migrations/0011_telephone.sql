-- Numéro de téléphone du profil, vérifié par un code SMS envoyé par Mess.
-- Un numéro n'appartient qu'à un compte : celui qui prouve le détenir
-- aujourd'hui (les opérateurs réattribuent les numéros abandonnés).
ALTER TABLE utilisateurs ADD COLUMN telephone TEXT;
ALTER TABLE utilisateurs ADD COLUMN trouvable_telephone INTEGER NOT NULL DEFAULT 1 CHECK (trouvable_telephone IN (0, 1));
CREATE UNIQUE INDEX utilisateurs_telephone ON utilisateurs (telephone) WHERE telephone IS NOT NULL;

-- Vérification en cours : l'identifiant de la demande chez Mess, jamais le code.
CREATE TABLE verifications_telephone (
  utilisateur_id TEXT PRIMARY KEY REFERENCES utilisateurs (id) ON DELETE CASCADE,
  numero TEXT NOT NULL,
  demande_mess TEXT NOT NULL,
  expire_le INTEGER NOT NULL
);
