# UniChat

Messagerie au fonctionnement de WhatsApp — web, Android, desktop — avec une
API d'intégration pour les autres plateformes. Les choix techniques et leurs
raisons sont dans `docs/ARCHITECTURE.md`.

## Contraintes du projet

- **Budget nul** : uniquement des offres gratuites (Cloudflare Workers, D1,
  Durable Objects, GitHub Actions…). Toute dépendance payante est signalée
  avant d'être ajoutée.
- **Plateformes** : web, Android, desktop (Tauri). Pas d'application iOS.
- **Connexion** : Google uniquement.
- **Identité propre** : jamais le nom, le logo, le vert ni les illustrations de
  WhatsApp. Le fonctionnement et l'ergonomie s'en inspirent, pas la marque.

## Règles de rendu

- Aucun emoji dans l'interface, le code ou les messages de commit ;
  pictogrammes `lucide-react`. Exception : le contenu écrit par les
  utilisateurs (messages, réactions), qui relève de la messagerie elle-même.
- Couleurs uniquement par les jetons de `apps/web/src/styles.css` ; couleur
  principale indigo `#4F46E5`.
- Animations : seulement les briques de `styles.css`, 150 à 400 ms, sans
  rebond ; elles accompagnent un changement d'état. La réduction de mouvement
  demandée par le système est respectée globalement.
- Ne jamais afficher « chiffré de bout en bout » tant que le chiffrement
  n'est pas réellement en place.

## Conventions

- Français partout : interface, commentaires, messages d'erreur.
- Les commentaires expliquent le pourquoi, pas le quoi.
- Logique dans `apps/server/src/lib`, routes minces ; schémas et types
  partagés dans `packages/shared` (validation serveur et formulaires web,
  puis application Android).
- Toute entrée venant d'un client est validée avec zod avant de toucher la
  base.
- Offre gratuite D1 : 100 000 écritures par jour. Pas d'écriture à chaque
  requête (voir la mise à jour espacée de `vu_le` dans `lib/sessions.ts`).
- Offre gratuite Workers : 10 ms de calcul par requête. Pas de traitement
  lourd côté serveur ; les images sont redimensionnées dans le navigateur.

## Sécurité

- Aucun jeton Google n'est conservé : seule l'identité vérifiée (signature,
  émetteur, audience, nonce, adresse vérifiée) sert à ouvrir la session.
- Jetons de session aléatoires, stockés sous forme d'empreinte SHA-256,
  renouvelés régulièrement ; la réutilisation d'un ancien jeton ferme la
  session.
- Cookie `__Host-`, HttpOnly, Secure, SameSite=Lax ; les requêtes qui
  modifient quelque chose vérifient l'en-tête Origin.
- Secrets dans `.dev.vars` (local) et `wrangler secret put` (production),
  jamais dans le dépôt ni dans une discussion.

## Vérifications avant de conclure

`npm run check` à la racine : types et tests.

## Après une modification fonctionnelle

Commit et push sans demander.
