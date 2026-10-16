# Architecture d'UniChat

Ce document garde la trace des choix et de leurs raisons. Il est mis à jour à
chaque étape.

## Contraintes

- Budget nul, développeur seul : uniquement des offres gratuites, sans mise
  en veille et sans carte bancaire.
- Web, Android et desktop. Pas d'application iOS.
- Connexion par Google uniquement.

## Vue d'ensemble

```
                 navigateur / Android / desktop
                              |
                 https://unichat.<compte>.workers.dev
                              |
              +---------------+----------------+
              |        Cloudflare Worker       |
              |  /api/*  : API (Hono)          |
              |  le reste : application web    |
              |            (fichiers statiques)|
              +-------+---------------+--------+
                      |               |
                 D1 (SQLite)    Durable Objects (étape 2)
          comptes, sessions,    temps réel : un objet par
          contacts, sécurité    utilisateur, file d'attente
                                des messages par appareil
```

### Pourquoi Cloudflare

Une messagerie garde des connexions WebSocket ouvertes en permanence. Les
offres gratuites qui mettent le serveur en veille (Render, Koyeb) les coupent,
et les plateformes « serverless » classiques (Vercel) ne les gardent pas.
Les Durable Objects de Cloudflare tiennent des WebSocket sur l'offre gratuite,
avec mise en veille des connexions inactives (on ne paie pas l'attente), et
ne s'endorment pas.

### Pourquoi l'application web est servie par le Worker

L'API et l'interface partagent la même adresse. Le cookie de session reste
donc « first-party » : Safari et Firefox bloquent par défaut les cookies
envoyés à un autre domaine (`pages.dev` et `workers.dev` sont deux domaines
distincts pour les navigateurs). Les requêtes vers les fichiers statiques
sont gratuites et ne comptent pas dans le quota du Worker.

## Organisation du dépôt

```
apps/server     Worker Cloudflare : API, temps réel, tâches planifiées
apps/web        Application web (React, Vite, Tailwind)
apps/android    Application Android (Expo) — étape 2
apps/desktop    Application desktop (Tauri) — étape 6
packages/shared Schémas zod et types communs à toutes les applications
```

Espaces de travail npm plutôt que pnpm : React Native (Expo) s'y retrouve
sans réglage particulier.

## Connexion et sessions

1. `GET /api/auth/google` : le serveur tire un `state`, un `nonce` et un
   vérificateur PKCE, garde le vérificateur en base et lie le `state` au
   navigateur par un cookie de 10 minutes (protection contre l'injection
   d'une connexion étrangère).
2. Google renvoie vers `/api/auth/google/rappel`. Le serveur vérifie le
   `state`, échange le code avec le vérificateur PKCE et le secret client,
   puis vérifie le jeton d'identité : signature (clés publiques de Google),
   émetteur, audience, expiration, `nonce`, adresse vérifiée.
3. Le compte est retrouvé par l'identifiant Google (`sub`), jamais par
   l'adresse e-mail, qui peut changer de propriétaire.
4. Aucun jeton Google n'est conservé : UniChat n'a aucun accès au compte
   Google après la connexion.

Une session correspond à un appareil :

- jeton aléatoire de 256 bits, stocké en base sous forme d'empreinte SHA-256 ;
- renouvelé toutes les 12 heures ; l'ancien reste accepté 60 secondes pour
  les requêtes déjà parties, puis sa présentation ferme la session (vol de
  jeton probable) et l'événement est journalisé ;
- fermée après 30 jours d'inactivité, et au plus tard après 90 jours ;
- web : cookie `__Host-` HttpOnly, Secure, SameSite=Lax, et vérification de
  l'en-tête Origin sur toute requête qui modifie quelque chose ;
- Android (étape 2) : même jeton, envoyé dans l'en-tête Authorization et
  rangé dans le stockage chiffré du téléphone ; connexion par le navigateur
  système (Custom Tabs) avec PKCE et retour par lien profond.

Chaque nouvelle connexion est signalée sur les autres appareils, avec la
possibilité de la fermer à distance.

## Messagerie (étape 2)

Modèle « stocker puis transmettre », comme WhatsApp : le serveur ne garde un
message que jusqu'à sa remise à tous les appareils destinataires (30 jours
au plus). L'historique vit sur les appareils (IndexedDB sur le web, SQLite
sur Android). Deux raisons :

- c'est le modèle compatible avec le chiffrement de bout en bout ;
- le stockage serveur reste minime, ce qui tient dans les quotas gratuits.

### Boîte aux lettres (`apps/server/src/temps-reel/boite.ts`)

Un Durable Object par utilisateur. Il tient les WebSocket de ses appareils
(API d'hibernation : un appareil connecté mais silencieux ne coûte rien) et
un **journal numéroté** : messages reçus, copies de mes messages envoyés
(pour mes autres appareils), accusés de remise et de lecture.

- À l'ouverture, l'appareil envoie `bonjour` avec le dernier numéro reçu ;
  la boîte lui envoie la suite. Un appareil neuf reçoit ce qui est encore en
  attente, sans l'historique déjà remis ailleurs (comme un appareil lié sans
  synchronisation d'historique).
- L'appareil accuse réception (`recu`) jusqu'à un numéro ; le premier
  appareil qui reçoit un message déclenche l'accusé « remis » chez
  l'expéditeur, l'ouverture de la discussion l'accusé « lu ».
- Ce que tous les appareils ont reçu est effacé ; un appareil muet depuis
  30 jours ne retient plus rien.
- Un appareil déconnecté à distance voit sa connexion coupée (code 4001).

L'ouverture de la connexion vérifie la session et l'origine (le navigateur
joindrait sinon le cookie à une connexion ouverte depuis un autre site).

### Groupes, réponses, réactions, suppression

- Un groupe vit dans D1 (`groupes`, `membres`). Un message de groupe est
  relayé par la boîte de l'expéditeur à la boîte de chaque membre ; chacun
  accuse réception et lecture pour lui-même, et l'application de
  l'expéditeur affiche « remis » puis « lu » quand **tous** l'ont fait.
- **40 membres au plus** : sur l'offre gratuite, une opération ne peut pas
  faire plus de 50 sous-requêtes (appels aux autres boîtes compris). À
  relever avec une offre payante.
- Les créations, ajouts, retraits et départs sont des événements déposés
  dans la boîte de chaque membre concerné, y compris de la personne retirée :
  ils s'affichent dans la discussion. Un groupe garde toujours un
  administrateur ; vide, il disparaît.
- Une réponse transporte un extrait du message cité, lisible même si
  l'original n'est pas sur l'appareil.
- Les réactions sont des codes (`pouce`, `coeur`…) affichés en pictogrammes,
  pas en emoji.
- « Supprimer pour tout le monde » (48 heures, auteur seulement) envoie un
  événement ; chaque application vérifie que l'auteur de la suppression est
  bien celui du message avant de l'appliquer. « Supprimer pour moi » reste
  sur l'appareil.

Coût d'un message sur l'offre gratuite (100 000 requêtes Durable Objects
par jour) : environ trois requêtes (envoi, accusé de remise, accusé de
lecture), soit de l'ordre de 30 000 messages par jour.

Une sauvegarde chiffrée de l'historique pourra aller sur le Google Drive de
l'utilisateur (dossier privé de l'application), comme la sauvegarde Android
de WhatsApp.

### Blocage, signalement, réglages d'une discussion

- **Blocage** (table `blocages`) : vérifié dans la boîte de l'expéditeur. Le
  message d'une personne bloquée est accepté puis gardé chez elle seule : une
  coche, jamais remis, comme dans WhatsApp. « Écrit… », présence, accusés de
  lecture, réactions et suppressions ne traversent pas un blocage ; la carte
  de profil se présente comme si la personne avait choisi « Personne ». Les
  groupes ne sont pas concernés. Le cache de 10 s des boîtes est vidé des
  deux côtés au moment du blocage.
- **Signalement** (table `signalements`, six mois) : le serveur ne garde pas
  les messages, l'application joint les cinq derniers reçus de la personne ou
  des autres membres du groupe. Lecture à la main (README, « Modération »).
- **Réglages** (sourdine, favori, archive, épingle, effacement, suppression) :
  entrée `preference` du journal de ma seule boîte, appliquée par chacun de
  mes appareils ; personne d'autre n'en sait rien. Hors connexion, ils
  partent au retour du réseau.

### Modifier, épingler, transférer, important

- **Modifier** (15 minutes) et **épingler** (24 h, 7 ou 30 jours, trois par
  discussion) passent comme les réactions : à chaque participant. Chaque
  application vérifie que la modification vient de l'auteur et dans le délai.
- **Important** : comme les réglages, seulement dans ma boîte ; index
  `important` d'IndexedDB (version 4) pour la liste.
- **Transférer** : cinq discussions au plus à la fois. Le message porte le
  nombre de transferts (« Transféré », « Transféré plusieurs fois » à partir
  de cinq). Un fichier n'est pas renvoyé : `POST /api/medias/:id/transfert`
  crée une ligne qui pointe vers le même fichier, effacé chez Karaks Storage
  seulement quand la dernière ligne a expiré.
- **Rechercher** : sur l'appareil, sans accents ni casse ; le serveur n'a pas
  l'historique.

### Emoji, liens, mentions

- **Emoji** : liste Unicode limitée à Emoji 12.0 (Windows 10 n'affiche pas
  au-delà), sans teintes ni drapeaux, chargée à la première ouverture du
  panneau. `lib/emoji.ts` est généré et ne contient que des points de code :
  le code source reste sans emoji.
- **Aperçu de lien** : demandé par l'expéditeur pendant la saisie
  (`GET /api/apercu`), comme WhatsApp ; le Worker lit les 128 premiers Ko de
  la page (4 s au plus), refuse adresses IP, noms locaux et identifiants dans
  l'URL, et ne garde que du texte. Aucune image extérieure n'est chargée :
  la politique de sécurité (`img-src 'self'`) reste fermée.
- **Mentions** : identifiants des membres joints au message (groupes
  seulement) ; une mention fait sonner une discussion en sourdine.

### Confidentialité de la présence, groupes

- **Dernière connexion, en ligne, confirmations de lecture** : réglages du
  compte (colonnes de `utilisateurs`), appliqués par la boîte de celui qui
  demande la présence ou qui lit. Réciprocité de WhatsApp : qui cache sa
  dernière connexion ne voit plus celle des autres ; les confirmations ne
  circulent que si les deux les ont gardées (toujours dans les groupes).
  Relus à chaque demande, sans cache : un réglage vaut tout de suite.
- **Ajout aux groupes** : « Mes contacts » refuse l'ajout direct par
  quelqu'un que la personne n'a pas ajouté ; reste le lien d'invitation.
- **Photo de groupe** : table `photos_groupes`, mêmes tailles et même adresse
  versionnée que les photos de profil, servie aux seuls membres.
- **Lien d'invitation** : code aléatoire de 128 bits dans `groupes`,
  `/g/<code>` dans l'application, réinitialisable par un administrateur.
  Un groupe sans membre est effacé par la tâche horaire.

### Éphémères, vue unique, position, contact, sondage

- **Messages éphémères** (24 h, 7 ou 90 jours) : réglage partagé de la
  discussion (entrée `ephemere`), joint à chaque nouveau message ; chaque
  application efface à l'échéance (index `expire` d'IndexedDB, version 5).
  Les messages marqués importants restent chez qui les a marqués.
- **Vue unique** : fichier téléchargé, montré sans bouton d'enregistrement,
  effacé de l'appareil à la fermeture ; l'auteur reçoit `ouvert` et, à deux,
  retire le fichier du serveur. Ni transfert, ni galerie, ni export.
- **Position** : envoyée une fois, sans fond de carte (aucun serveur tiers
  contacté) ; lien vers OpenStreetMap. `Permissions-Policy: geolocation=(self)`.
- **Contact** : seul l'identifiant part ; le serveur refait nom et pseudo
  depuis la base, l'expéditeur ne peut pas les inventer.
- **Sondage** : 2 à 12 options, une ou plusieurs réponses ; votes partagés
  comme les réactions, vérifiés par chaque application.
- **Fond des discussions** : jetons `--fond-*` déclinés par thème, réglage de
  l'appareil appliqué avant le premier affichage (`theme.js`).

## Chiffrement de bout en bout (étape 3)

Protocole Signal (X3DH ou PQXDH, puis Double Ratchet), clés par appareil.
Le serveur publie les paquets de clés publiques des appareils et ne voit que
des messages chiffrés. Les sessions sont déjà rattachées à un appareil pour
que cette étape n'oblige pas à revoir les comptes.

## Médias

Photos, vidéos, documents et messages vocaux sont stockés dans **Karaks
Storage** (projet « UniChat »), le service de fichiers déjà en ligne pour
Karaks : gratuit, sans moyen de paiement à enregistrer, contrairement à R2.
Les photos de profil, petites (640 px et 128 px), restent dans D1.

- **La clé ne quitte pas le Worker.** Le navigateur envoie le fichier à
  `/api/medias` par morceaux de 4 Mo ; le Worker vérifie la session, la
  participation à la discussion, le type et la taille, puis relaie chaque
  morceau à l'envoi reprenable de Karaks Storage. La politique de sécurité
  du site reste `connect-src 'self'`.
- **Préparation dans le navigateur** (10 ms de calcul par requête côté
  serveur) : photos réduites à 1 600 px en WebP, vignette de 24 px jointe au
  message pour l'affichage flou avant téléchargement, durée et dimensions
  des vidéos lues par le navigateur.
- **Lecture** : `GET /api/medias/:id`, réservé aux membres de la
  discussion. Le Worker demande à Karaks Storage un lien signé de 5 minutes
  et relaie le contenu (avec `Range`), servi en `Content-Security-Policy:
  sandbox` et `nosniff` : un fichier piégé ne peut rien exécuter sous
  l'origine d'UniChat. Pas de SVG.
- **Message** : l'application envoie l'identifiant du média avec le message ;
  la boîte de l'expéditeur relit en base le type, le nom et la taille (seuls
  les dimensions, la durée et la vignette sont déclarés par le client) et
  refuse un média qui n'est pas le sien ou pas dans cette discussion.
- **Sur l'appareil** : chaque fichier envoyé ou reçu est gardé dans
  IndexedDB (magasin `fichiers`), comme l'historique. Photos et messages
  vocaux se téléchargent quand ils approchent de l'écran ; vidéos et
  documents à la demande.
- **Durée** : 30 jours sur le serveur, puis effacement (tâche horaire,
  15 fichiers par passage pour rester sous les 50 sous-requêtes). Une
  suppression pour tout le monde ou du compte rend les fichiers
  inaccessibles aussitôt (`expire_le = 0`) ; l'effacement suit.
- **Clé** : préréglage « Application cliente » de Karaks Storage, plus le
  droit « Mettre à la corbeille et supprimer ». Secret `KARAKS_STORAGE_CLE` ;
  sans lui, l'envoi répond `503 stockage_indisponible`.

Le chiffrement de bout en bout (étape 3) chiffrera les fichiers sur
l'appareil avant l'envoi ; Karaks Storage ne verra alors que des octets
opaques.

## API d'intégration (étape 5)

Sur le modèle de la WhatsApp Business API :

- comptes « Entreprise » et « Bot », clés d'API stockées sous forme
  d'empreinte, droits limités et révocables ;
- REST versionnée (`/v1/messages`, médias, modèles de messages) ;
- webhooks signés (HMAC) pour les messages reçus et les accusés, avec
  nouvelles tentatives ;
- une entreprise n'écrit qu'aux personnes qui l'ont contactée ou l'ont
  accepté, fenêtre de 24 heures, modèles validés au-delà ;
- connexion OAuth « Se connecter avec UniChat » pour les applications tierces ;
- documentation OpenAPI générée, SDK TypeScript.

## Quotas gratuits à surveiller

| Service | Quota gratuit (ordre de grandeur) | Conséquence dans le code |
|---|---|---|
| Workers | 100 000 requêtes par jour, 10 ms de calcul par requête | Pas de calcul lourd ; images préparées dans le navigateur |
| D1 | 5 millions de lignes lues et 100 000 écrites par jour, 500 Mo par base | Écritures espacées (`vu_le` toutes les 5 min) ; photos limitées en taille |
| Durable Objects | 100 000 requêtes par jour, stockage SQLite | WebSocket en veille ; messages effacés après remise |
| Fichiers statiques | Gratuits, illimités | Application web servie par le Worker |
| Karaks Storage | Espace du Google Drive relié | Fichiers effacés après 30 jours ; 64 Mo au plus par vidéo ou document, 16 Mo par photo ou audio |
