# UniChat

Messagerie au fonctionnement de WhatsApp — web, Android et ordinateur — avec
une API d'intégration pour les autres plateformes. Hébergée entièrement sur
des offres gratuites (Cloudflare).

Les choix techniques et leurs raisons : [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).

## Où en est le projet

| Étape | Contenu | État |
|---|---|---|
| 1. Socle | Connexion Google sécurisée, sessions par appareil, profil, contacts, confidentialité, application web | Fait |
| 2. Discussions | Messages à deux en temps réel, envoi hors connexion, coches (envoyé, remis, lu), « écrit… », présence et dernière connexion, synchronisation entre mes appareils, notifications du navigateur | Fait (web) |
| 2 bis. Discussions | Groupes (jusqu'à 40 membres, administrateurs, ajout, retrait, départ), réponses citées, réactions, suppression pour tous ou pour soi | Fait (web) |
| 2 ter. Médias | Photos, vidéos, documents et messages vocaux (Karaks Storage, 30 jours), aperçu avec légende, visionneuse | Fait (web) |
| 2 quinquies. Quotidien | Bloquer, signaler ; sourdine, favoris, archives, épingles, effacer, supprimer, exporter une discussion ; transférer, sélectionner, modifier, messages importants, épingler un message, rechercher dans une discussion ; emoji, liens cliquables et aperçus, mentions @ ; confidentialité de la présence et des confirmations de lecture, ajout aux groupes, photo et lien d'invitation des groupes ; médias, liens et documents, infos du message, marquer comme non lu, fond des discussions ; messages éphémères, vue unique, position, contact, sondages | Fait (web) |
| 2 quater. Android | Application installée depuis Chrome (PWA, hors connexion, bouton Retour, appui long et glissement), notifications Web Push même fermée, animations d'ouverture et de fermeture | Fait |
| 3. Sécurité | Chiffrement de bout en bout (spécifications de Signal), appareils reliés, code de sécurité | En cours (lots 1 à 3 sur 8 : clés, appareils reliés par QR code, discussions à deux chiffrées) |
| 4. Appels et statuts | Appels audio et vidéo (WebRTC), statuts | À venir |
| 5. API UniChat | Comptes entreprise et bots, REST, webhooks signés, documentation | À venir |
| 6. Ordinateur | Application Tauri, communautés, chaînes | À venir |

## Organisation

```
apps/server      Worker Cloudflare : API (Hono), base D1, tâches planifiées
apps/web         Application web (React, Vite, Tailwind)
packages/shared  Schémas zod et types communs
packages/chiffrement  X3DH et Double Ratchet (chiffrement de bout en bout)
```

## Développement local

Prérequis : Node.js 20 ou plus récent.

```bash
npm install
cp apps/server/.dev.vars.example apps/server/.dev.vars   # identifiants Google
npm run dev        # http://localhost:8787
npm run check      # types et tests
```

`npm run dev` applique les migrations à la base locale, construit
l'application web et la sert avec l'API, à la même adresse. Les tests de
l'API tournent dans le moteur des Workers (workerd) avec un faux Google qui
signe de vrais jetons.

## Mise en ligne (gratuite)

1. **Cloudflare** : créer un compte gratuit, puis se connecter :
   `npx wrangler login`.
2. **Base de données** : `npx wrangler d1 create unichat` (dans
   `apps/server`), puis reporter l'identifiant affiché dans
   `apps/server/wrangler.jsonc` (`database_id`).
3. **Google** : dans Google Cloud Console, créer un client OAuth de type
   « Application Web » avec ces URI de redirection :
   - `https://unichat.<votre-sous-domaine>.workers.dev/api/auth/google/rappel`
   - `http://localhost:8787/api/auth/google/rappel` (développement)

   Écran de consentement : publier l'application (« En production ») ; les
   seules permissions demandées (`openid`, `email`, `profile`) ne
   nécessitent aucune validation de Google.
4. **Secrets** (jamais dans le dépôt) :
   ```bash
   cd apps/server
   npx wrangler secret put GOOGLE_CLIENT_ID
   npx wrangler secret put GOOGLE_CLIENT_SECRET
   npx wrangler secret put KARAKS_STORAGE_CLE
   npx wrangler secret put VAPID_PRIVEE   # clé privée VAPID (JWK) pour les notifications
   ```
   Une clé VAPID se crée avec
   `node -e "crypto.subtle.generateKey({name:'ECDSA',namedCurve:'P-256'},true,['sign']).then(p=>crypto.subtle.exportKey('jwk',p.privateKey)).then(k=>console.log(JSON.stringify(k)))"`
   (à coller directement dans `wrangler secret put`, sans la garder ailleurs).
   La clé Karaks Storage se crée dans le projet « UniChat » du service
   (`KARAKS_STORAGE_URL` dans `wrangler.jsonc`) : préréglage « Application
   cliente », plus « Mettre à la corbeille et supprimer ». Sans elle, tout
   fonctionne sauf l'envoi de fichiers.
5. **Déploiement** : `npm run deploy` (migrations, construction, envoi).

## Application Android

**Installation recommandée** : ouvrir le site dans Chrome sur Android, puis
« Installer l'application » (proposé par UniChat, ou menu ⋮ de Chrome).
Chrome fabrique et signe lui-même l'application sur les serveurs de Google
(WebAPK) : icône, plein écran, notifications, mises à jour avec le site.

**APK à distribuer soi-même** (facultatif) : la même application enveloppée
dans une Trusted Web Activity (outil Bubblewrap). À construire sur un poste
sain uniquement. Prérequis : Android Studio (JDK et SDK, avec Android 36 et
les build-tools 36.1.0).

```bash
cd apps/android
npm install
npm run construire   # sortie/UniChat.apk (installation directe) et sortie/UniChat.aab (Play Store)
node publier.mjs     # met l'APK en ligne sur les versions GitHub du dépôt
```

La clé de signature est créée au premier lancement dans `~/.unichat-android`
(hors du dépôt). **Sauvegardez ce dossier** : sans lui, aucune mise à jour de
l'application installée n'est possible. Son empreinte SHA-256, publique,
figure dans `ANDROID_EMPREINTES` (`wrangler.jsonc`) et dans
`/.well-known/assetlinks.json` : c'est ce lien qui ouvre l'application en
plein écran, sans barre d'adresse.

Publication sur le Play Store : facultative (inscription de 25 $, une seule
fois) ; elle utilise `UniChat.aab`.

## Administration

Espace réservé, ouvert depuis Paramètres, Administration :

- **Tableau de bord** : comptes, activité sur 24 heures et 7 jours, inscriptions
  des 14 derniers jours, groupes, fichiers stockés, place occupée dans la base
  (offre gratuite de D1 : 500 Mo).
- **Comptes** : recherche par nom, nom d'utilisateur ou adresse ; fiche avec
  appareils connectés, groupes et signalements reçus. Actions : déconnecter
  ses appareils, suspendre (motif obligatoire) ou lever la suspension,
  supprimer le compte.
- **Signalements** : file des signalements avec les messages joints par la
  personne qui signale. Classer sans suite, suspendre le compte, ou fermer le
  groupe ; les autres signalements ouverts sur la même cible suivent.
- **Journal** : chaque action, son auteur et son motif, gardés un an.

Un compte suspendu ne peut plus se connecter, ses appareils sont déconnectés
et on ne peut plus lui écrire ; il disparaît de la recherche. Supprimer un
compte ou fermer un groupe demande une connexion Google de moins de 24 heures.
Un administrateur n'agit ni sur lui-même ni sur un autre administrateur. Le
contenu des messages n'est jamais visible, sauf les messages joints à un
signalement.

**Désigner les administrateurs** : identifiants UniChat (pas les adresses
e-mail, qui peuvent changer de titulaire), séparés par des virgules, dans le
secret `ADMINS` du Worker :

```bash
cd apps/server
npx wrangler secret put ADMINS
```

Rien dans la base ne donne ce droit : le serveur le vérifie à chaque requête.
