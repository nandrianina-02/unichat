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

## Chiffrement de bout en bout (étape 3)

Protocole Signal (X3DH ou PQXDH, puis Double Ratchet), clés par appareil.
Le serveur publie les paquets de clés publiques des appareils et ne voit que
des messages chiffrés. Les sessions sont déjà rattachées à un appareil pour
que cette étape n'oblige pas à revoir les comptes.

## Médias

Chiffrés sur l'appareil avant l'envoi. Le stockage reste à choisir :
Cloudflare R2 (10 Go gratuits, mais l'activation demande d'enregistrer un
moyen de paiement — à vérifier avant de l'adopter), ou Karaks Storage
(Google Drive). En attendant, les photos de profil, petites (640 px et
128 px, compressées dans le navigateur), sont rangées dans D1.

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
