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
apps/android    Application Android (Trusted Web Activity, générée par Bubblewrap)
apps/desktop    Application desktop (Tauri) — étape 6
packages/shared Schémas zod et types communs à toutes les applications
packages/chiffrement  X3DH et Double Ratchet, sans dépendance au navigateur ni au serveur
```

Espaces de travail npm plutôt que pnpm : un seul `npm install` pour tout le dépôt.

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

### Administration

- **Droit d'administration** : identifiants UniChat dans le secret `ADMINS`,
  vérifié à chaque requête de `/api/admin`. Rien dans la base ne le donne :
  ni une fuite ni une injection SQL ne suffit à créer un administrateur.
  Pour un compte ordinaire, `/api/admin` répond comme une adresse inconnue.
- **Suspension** (`utilisateurs.suspendu_le`, motif) : sessions fermées et
  connexions coupées, connexion Google refusée, recherche et nouveaux
  messages bloqués, ajout aux groupes impossible. Les clés de chiffrement des
  appareils restent : levée la suspension, ils reprennent leur place.
- **Signalements** : décision (`classe`, `suspendu`, `groupe_ferme`) appliquée
  à tous les signalements ouverts sur la même cible. Fermer un groupe
  dépose l'événement `fermeture` chez chaque membre, puis l'efface avec ses
  fichiers.
- **Garde-fous** : supprimer un compte ou fermer un groupe exige une session
  ouverte avec Google depuis moins de 24 heures ; un administrateur n'agit ni
  sur lui-même ni sur un autre ; chaque action va au journal
  (`actions_admin`, un an), sans clé étrangère pour survivre aux comptes.
- **Ce que l'administration voit** : profil, adresse, appareils, groupes,
  signalements. Ni photo, ni contacts un par un, ni messages, que le serveur
  ne garde pas ; seuls les messages joints à un signalement sont lisibles.

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

## Application installable et Android

Prévue d'abord avec Expo (React Native), l'application Android est
finalement l'application web installable (PWA), enveloppée dans une
**Trusted Web Activity** : la méthode de Google pour publier une PWA comme
application Android. Raisons, pour un développeur seul et sans budget :

- **Une seule base de code** : toutes les fonctions du web (fichiers,
  vocaux, groupes, sondages…) existent aussitôt sur Android, et chaque mise
  en ligne met l'application à jour sans nouvelle version à distribuer.
- **Le moteur de Chrome**, pas une WebView : la connexion Google fonctionne
  (Google la refuse dans les WebView), comme le micro, l'appareil photo, la
  position et les fichiers.
- **Notifications Web Push**, même application fermée, sans projet Firebase
  ni frais : une paire de clés VAPID suffit (voir plus bas).

Une réécriture native reste possible plus tard si un besoin l'impose
(appels en arrière-plan, accès aux contacts du téléphone).

- **Service worker** (`public/sw.js`) : coquille de l'application gardée
  pour s'ouvrir hors connexion (l'historique est déjà sur l'appareil, le
  profil aussi) ; fichiers de construction en cache (noms versionnés) ;
  l'API n'est jamais mise en cache.
- **Bouton Retour** (`lib/retour.ts`) : chaque couche ouverte (discussion,
  panneau, boîte de dialogue) ajoute une entrée d'historique ; Retour
  referme la plus récente au lieu de quitter l'application.

### Notifications (Web Push)

- Abonnement par appareil (table `abonnements_push`, liée à la session),
  envoyé quand la permission est accordée, retiré à la déconnexion.
- La boîte du destinataire envoie la notification (`ctx.waitUntil`, sans
  retarder l'expéditeur) : chiffrée pour l'appareil (RFC 8291) et signée
  VAPID (RFC 8292). Le service du navigateur (Google, Mozilla, Microsoft)
  ne peut pas la lire. Seuls les services connus sont acceptés comme
  adresse d'envoi.
- Une discussion en sourdine ne notifie pas (la boîte retient la sourdine
  depuis les réglages), sauf mention. Le service worker n'affiche rien si
  UniChat est déjà sous les yeux ; avec Web Push actif, la page ne notifie
  plus elle-même (pas de doublon).
- Secret `VAPID_PRIVEE` (clé privée JWK) ; sans lui, la page continue de
  notifier tant qu'elle est ouverte.

## Chiffrement de bout en bout (étape 3)

Spécifications de Signal : **X3DH** pour ouvrir une session entre deux
appareils, **Double Ratchet** ensuite (une clé par message, oubliée sitôt
servie). Implémentation propre, `packages/chiffrement`, sur les primitives
**noble** (X25519, Ed25519, HKDF et HMAC SHA-256, AES-256-GCM ; auditées,
licence MIT). Les bibliothèques de Signal ne conviennent pas : le portage
TypeScript est sous GPL-3.0, `libsignal-client` sous AGPL-3.0 et réservé à
Node ; elles imposeraient leur licence à toute l'application.

- **Écart avec la spécification** : l'identité porte deux clés (Ed25519 pour
  signer, X25519 pour l'échange, la seconde signée par la première) au lieu
  d'une seule clé XEdDSA. Étiquettes de séparation propres à UniChat.
- **Pas d'audit externe** de ce code : les primitives le sont, l'assemblage
  est couvert par les tests du paquet (ouverture, désordre, perte, rejeu,
  altération, signature forgée, ouvertures simultanées).

### Identité et appareils (lot 1)

- **Une identité par compte**, partagée par ses appareils comme dans
  Signal. Un nouvel appareil la reçoit d'un appareil déjà relié, jamais du
  serveur : celui-ci ne peut pas inscrire un faux appareil, il lui faudrait
  signer sa clé.
- **Par appareil** : un numéro jamais réutilisé, une clé signée renouvelée
  chaque mois (l'ancienne reste deux mois pour les sessions en cours
  d'ouverture) et une réserve de 100 clés uniques, refaite sous 40, 200 au
  plus. Une clé unique n'est remise qu'une fois ; réserve vide, X3DH s'en
  passe.
- **Annuaire** (`/api/cles`, tables `identites`, `appareils_cles`,
  `cles_uniques`) : le premier appareil du compte crée l'identité ; les
  suivants sont « à relier ». Les signatures sont vérifiées par les
  applications : le serveur ne fait que ranger et redonner.
- **Un appareil survit à sa session** : reconnecté sur le même navigateur, il
  reprend sa place avec un jeton (gardé en base sous forme d'empreinte).
  Déconnecté à distance ou jeton volé, il quitte l'annuaire et ne pourra plus
  revenir sans être relié de nouveau. Muet 90 jours, il en sort aussi.
- **Sur l'appareil** : clés privées dans IndexedDB (magasin `cles`,
  version 6), préparées sous verrou (Web Locks) pour que deux onglets ne
  créent pas deux identités. La bibliothèque est chargée à la demande.

### Relier un appareil (lot 2)

Comme WhatsApp Web : le nouvel appareil affiche un QR code, un appareil déjà
relié le lit et lui transmet l'identité. L'inverse marche aussi (ordinateur
sans appareil photo), et le code peut se copier-coller.

- **Le code** (`UC1.<canal>.<clé>.<secret>.<rôle>`) : canal du relais
  (`/api/cles/liaisons`, cinq minutes), clé X25519 éphémère et secret de
  128 bits. Il ne passe que par l'écran : le serveur ne voit ni le secret
  ni la clé privée.
- **La réponse** de l'appareil qui lit : sa propre clé éphémère et une preuve
  (HMAC sous le secret) que lui seul, ayant vu l'écran, peut produire. Un
  serveur qui substituerait sa clé ne saurait pas la forger.
- **L'identité** part scellée (AES-256-GCM) sous une clé tirée de l'échange
  X25519, salée par le secret, liée au canal. L'appareil qui la reçoit
  recalcule les clés publiques, vérifie la preuve d'identité et la compare à
  celle de l'annuaire avant de la ranger.
- **L'inscription** d'un appareil relié n'est acceptée qu'au nom d'une
  liaison achevée, une seule fois, et seulement si les clés ont été déposées
  par un appareil inscrit du même compte. Un code d'un autre compte répond
  comme un code inconnu : un QR code présenté par un tiers ne mène nulle part.
- **Lecture** : détecteur du navigateur s'il existe (Chrome sur Android,
  macOS), sinon jsQR chargé à la demande (Chrome sur Windows). Le QR code est
  dessiné en SVG depuis la matrice (uqr), sans balisage injecté.
- **Nouvelles clés** : sans plus aucun appareil pour transmettre l'identité,
  un appareil en crée une nouvelle (connexion Google de moins de 24 heures).
  La version de l'identité augmente, les autres appareils sortent de
  l'annuaire et devront être reliés ; l'événement figure dans l'activité du
  compte.

### Discussions à deux chiffrées (lot 3)

- **Enveloppe** (`t: "chiffre"`) : identifiant, destinataire, genre (message
  ou action), contenu scellé une fois (AES-256-GCM, données associées
  `identifiant|discussion|auteur` : il ne peut pas être déplacé), et pour
  chaque appareil la clé du contenu suivie de l'identifiant, chiffrée par sa
  session Double Ratchet. Chaque boîte ne reçoit que les clés de ses
  appareils ; mes autres appareils reçoivent la leur.
- **Contenu chiffré** : texte, réponse citée, aperçu de lien, transfert,
  durée éphémère, position, fiche de contact, sondage, caractéristiques du
  fichier joint. **Actions chiffrées** : réaction, modification, suppression
  pour tous, épingle, vote, réglage éphémère, vue unique ouverte. Le contenu
  déchiffré est vérifié par l'application (`schemaContenuMessage`,
  `schemaContenuAction`), puis traité comme l'entrée en clair qu'il aurait
  été : mêmes contrôles d'auteur et de délai.
- **Le serveur vérifie** ce qu'il peut : existence et blocage comme en clair,
  et que l'enveloppe vise exactement les appareils inscrits (refus
  `appareils` avec la bonne liste, l'application rechiffre et renvoie ; deux
  essais au plus). L'appareil qui envoie doit être inscrit (`non_relie`).
- **Côté appareil** (`lib/chiffrement.ts`) : listes d'appareils relues
  toutes les 5 minutes (`/api/cles/appareils`, sans consommer de clé
  unique), paquets demandés pour les seuls appareils sans session, état de
  session rangé avant que le message parte (une clé de message ne sert
  jamais deux fois), déchiffrement par lots sous le verrou des clés. Un
  message déjà lu n'est pas déchiffré deux fois (journal rejoué, autre
  onglet).
- **Identité épinglée** au premier contact ; un changement est retenu et
  noté, pour l'avertissement du lot 7.
- **Message illisible** sur un appareil relié après l'envoi : sa place est
  marquée (« Message illisible sur cet appareil »). L'historique d'avant la
  liaison viendra avec le lot 8.
- **Transition** : vers un compte qui n'a pas encore de clés, ou depuis un
  appareil pas encore relié, le message part en clair comme avant. Une
  erreur de chiffrement ne fait jamais partir un message en clair. Le lot 8
  mettra fin au clair.
- **Ce que le serveur voit encore**, comme chez WhatsApp : qui écrit à qui,
  quand, la taille, les accusés, « écrit… », la présence, les réglages de
  discussion, les groupes (nom, membres, photo). Les notifications d'un
  message chiffré disent « Nouveau message » jusqu'au lot 6, où l'appareil
  les déchiffrera lui-même.

### Suite

- **Groupes** (lot 4) : même enveloppe, une clé par appareil de chaque membre.
- **Fichiers** (lot 5) : chiffrés sur l'appareil avant l'envoi ; nom, type et
  vignette voyagent déjà dans le contenu chiffré, Karaks Storage ne verra
  plus que des octets.
- **Code de sécurité** (lot 7) à comparer de vive voix ou par QR code.

### Lots

1. Socle cryptographique, annuaire des clés, inscription du premier appareil (fait).
2. Relier un appareil (QR code), réinitialiser les clés du compte (fait).
3. Discussions à deux chiffrées : messages, réactions, modifications,
   suppressions, votes (fait).
4. Groupes.
5. Fichiers.
6. Notifications déchiffrées sur l'appareil.
7. Code de sécurité et avertissement de changement d'identité.
8. Historique transmis à un appareil relié ; fin des messages non chiffrés.

La mention « chiffré de bout en bout » n'apparaît dans l'application qu'à
la fin de l'étape.

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
