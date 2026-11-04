-- Inscription et connexion par numéro de téléphone (code SMS envoyé par Mess).
--
-- Un compte créé par numéro n'a pas d'identité Google : google_sub reçoit
-- « telephone:<id du compte> », qui ne peut jamais égaler un identifiant
-- Google (toujours numérique), et email reste vide. Reconstruire la table
-- pour rendre ces colonnes facultatives effacerait en cascade tout ce qui
-- la référence : on garde ses contraintes, avec ces valeurs documentées.

-- Demande de connexion en cours : l'identifiant de la demande chez Mess,
-- jamais le code. Rien n'y dit si le numéro a déjà un compte.
CREATE TABLE connexions_telephone (
  id TEXT PRIMARY KEY,
  numero TEXT NOT NULL,
  demande_mess TEXT NOT NULL,
  expire_le INTEGER NOT NULL
);
