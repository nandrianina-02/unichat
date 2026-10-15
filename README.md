# UniChat

Messagerie au fonctionnement de WhatsApp — web, Android et ordinateur — avec
une API d'intégration pour les autres plateformes. Hébergée entièrement sur
des offres gratuites (Cloudflare).

Les choix techniques et leurs raisons : [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).

## Où en est le projet

| Étape | Contenu | État |
|---|---|---|
| 1. Socle | Connexion Google sécurisée, sessions par appareil, profil, contacts, confidentialité, application web | Fait |
| 2. Discussions | Messages à deux et en groupe en temps réel, accusés de lecture, présence, médias, messages vocaux ; application Android | À venir |
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
   ```
5. **Déploiement** : `npm run deploy` (migrations, construction, envoi).
