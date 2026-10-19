-- Historique transmis à un appareil relié (étape 3, lot 8). Juste après la
-- liaison, l'appareil donneur dépose une archive de ses discussions, chiffrée
-- sur l'appareil, en morceaux. Sa clé n'est déposée que scellée sous la clé
-- de la liaison, que le serveur n'a jamais eue : il ne garde ici que des
-- octets illisibles, effacés après la reprise ou avec la liaison (une heure).

ALTER TABLE liaisons ADD COLUMN historique_cle TEXT;
-- NULL : dépôt en cours ou pas commencé ; 0 : rien à transmettre ; n : prêt.
ALTER TABLE liaisons ADD COLUMN historique_morceaux INTEGER;

CREATE TABLE morceaux_historique (
  canal TEXT NOT NULL REFERENCES liaisons (canal) ON DELETE CASCADE,
  indice INTEGER NOT NULL,
  donnees TEXT NOT NULL,
  PRIMARY KEY (canal, indice)
);
