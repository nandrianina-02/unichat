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
| 2 quinquies. Quotidien | Bloquer, signaler ; sourdine, favoris, archives, épingles, effacer, supprimer, exporter une discussion ; transférer, sélectionner, modifier, messages importants, épingler un message, rechercher dans une discussion ; emoji, liens cliquables et aperçus, mentions @ ; confidentialité de la présence et des confirmations de lecture, ajout aux groupes, photo et lien d'invitation des groupes | En cours (web) |
| 2 quater. Android | Application Android | À venir |
| 3. Sécurité | Chiffrement de bout en bout (protocole Signal), notifications, appareils liés | À venir |
| 4. Appels et statuts | Appels audio et vidéo (WebRTC), statuts | À venir |
| 5. API UniChat | Comptes entreprise et bots, REST, webhooks signés, documentation | À venir |
| 6. Ordinateur | Application Tauri, communautés, chaînes | À venir |

## Organisation

```
apps/server      Worker Cloudflare : API (Hono), base D1, tâches planifiées
apps/web         Application web (React, Vite, Tailwind)
packages/shared  Schémas zod et types communs
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
   ```
   La clé Karaks Storage se crée dans le projet « UniChat » du service
   (`KARAKS_STORAGE_URL` dans `wrangler.jsonc`) : préréglage « Application
   cliente », plus « Mettre à la corbeille et supprimer ». Sans elle, tout
   fonctionne sauf l'envoi de fichiers.
5. **Déploiement** : `npm run deploy` (migrations, construction, envoi).

## Modération

Les signalements arrivent dans la table `signalements` (six mois au plus),
avec les cinq derniers messages joints par l'application. Pour les lire :

```bash
cd apps/server
npx wrangler d1 execute unichat --remote --command "SELECT s.id, datetime(s.cree_le / 1000, 'unixepoch') AS le, s.type, s.cible_id, u.nom AS auteur, s.messages FROM signalements s JOIN utilisateurs u ON u.id = s.auteur_id WHERE s.traite_le IS NULL ORDER BY s.cree_le"
```

Une fois examiné : `UPDATE signalements SET traite_le = <horodatage en ms> WHERE id = '<id>'`.
