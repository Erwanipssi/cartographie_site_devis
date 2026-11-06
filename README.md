# Cartographie de sites web

Application pour cartographier une liste de sites : nombre de pages HTML, nombre de PDF, et présence d’une couche de texte exploitable dans chaque PDF (document natif ou OCRisé, par opposition à un scan image).

Le dépôt est un monorepo pnpm :

- `apps/web` — interface React
- `apps/api` — API Fastify, worker BullMQ, crawler, analyse PDF, Excel, mail
- `packages/shared` — schémas Zod partagés

## Prérequis

- Node.js 22 ou plus récent
- Docker Desktop, pour PostgreSQL et Redis
- pnpm 10, fourni par Corepack :

```powershell
corepack prepare pnpm@10.15.0 --activate
corepack pnpm -v
```

Si `pnpm` n’est pas dans le PATH, préfixez les commandes par `corepack` (`corepack pnpm …`).

## Installation

```powershell
corepack pnpm install
copy .env.example apps\api\.env
corepack pnpm infra
corepack pnpm db:migrate
```

`pnpm infra` démarre PostgreSQL et Redis. Le mot de passe local est celui de `apps/api/.env` (`cartographie` / `cartographie`).

Au premier `db:migrate`, donnez un nom à la migration si Prisma le demande (`init`).

## Lancement

Une seule commande s’occupe de tout : elle vérifie Docker (et lance Docker Desktop sous Windows s’il est arrêté), démarre PostgreSQL et Redis, crée `apps/api/.env` s’il manque, applique les migrations, puis lance l’API, le worker et l’interface.

```powershell
corepack pnpm start
```

Les journaux de l’API et du worker sont aussi écrits dans `apps/api/data/logs/` (`api.log`, `worker.log`) : la cause d’un arrêt du worker y reste lisible.

### Migrations bloquées sous Windows (EPERM)

Sur certains postes, une stratégie de sécurité empêche Prisma de lancer son moteur de migration (`spawn EPERM`). Pour appliquer une migration en attente à la main :

```bash
F=apps/api/prisma/migrations/<dossier>/migration.sql
docker exec -i cartographie_siteweb-postgres-1 psql -U cartographie -d cartographie -v ON_ERROR_STOP=1 <<SQL
BEGIN;
$(cat "$F")
INSERT INTO "_prisma_migrations" (id, checksum, finished_at, migration_name, started_at, applied_steps_count)
VALUES (gen_random_uuid()::text, '$(sha256sum "$F" | cut -d' ' -f1)', now(), '<dossier>', now(), 1);
COMMIT;
SQL
```

L’empreinte (`sha256` du fichier) est celle que Prisma vérifie : les fichiers de migration ne doivent pas être modifiés, ni convertis en fin de ligne (voir `.gitattributes`).

### Lancer les processus à la main

Sans le script, avec l’infrastructure déjà démarrée :

```powershell
corepack pnpm dev
```

Ou séparément :

```powershell
corepack pnpm dev:api
corepack pnpm dev:worker
corepack pnpm dev:web
```

- Interface : http://localhost:5173
- API : http://localhost:3001/api/health

Le worker est indispensable. Sans lui, l’accueil indique qu’il est arrêté et les analyses restent en cours.

## Utilisation

1. Collez une ou plusieurs URL sur l’accueil. Les adresses locales et les IP privées sont refusées.
2. Réglez si besoin la profondeur, le nombre de pages, le délai et les seuils OCR.
3. Lancez l’analyse. La page de suivi se met à jour en direct.
4. Ouvrez un site pour filtrer les pages, les PDF et les erreurs.
5. Téléchargez le classeur Excel (synthèse, pages, PDF, erreurs).
6. Envoyez le rapport par mail, ou planifiez une répétition (cron à 5 champs) depuis Planifications.

L’envoi de mail exige un SMTP dans `apps/api/.env` (`SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS`, `MAIL_FROM`). Sans cela, le bouton d’envoi explique que le serveur n’est pas configuré.

## Qualité du code

```powershell
corepack pnpm lint
corepack pnpm typecheck
corepack pnpm test
```

L’intégration continue (GitHub Actions, `.github/workflows/ci.yml`) lance à chaque push et pull request le lint, le typage, la construction de l’interface et tous les tests, avec un PostgreSQL et un Redis de test.

Sur un poste à court de mémoire, `npx vitest run --no-file-parallelism` (dans `apps/api`) exécute les tests un fichier à la fois.

## Tests

Les tests couvrent la normalisation d’URL, le refus des adresses privées, la classification du contenu, la lecture des sitemaps, l’extraction de liens, le crawl en mémoire (domaine, profondeur, plafond de pages, mode sitemap, robots.txt et Crawl-delay), la liste des PDF à traiter et la structure du classeur Excel.

Les tests d’intégration (`apps/api/tests/integration`) utilisent la vraie base et le vrai Redis de `pnpm start` : chaque exécution crée un schéma PostgreSQL jetable, y applique les migrations, déroule une analyse complète et la surveillance des analyses figées, puis supprime le schéma. Sans Docker, ils sont ignorés.

## PDF à traiter et accessibilité

Depuis une analyse, « PDF à traiter » propose deux vues, chacune exportable en CSV et reprise dans le classeur Excel :

- **Couche texte** : PDF non OCRisés, partiels ou illisibles, du plus urgent au moins urgent.
- **Accessibilité** (critères RGAA sur les documents bureautiques) : PDF non balisés, sans titre ou avec un titre non pertinent (« Microsoft Word - … », nom de fichier, champs de publipostage), ou sans langue déclarée.

Les contrôles d’accessibilité ne concernent que les PDF analysés après leur ajout : relancez l’analyse d’un site pour les obtenir.

## Suivi dans le temps

- **Tableau de bord** (menu) : la dernière analyse de chaque site, avec la part de PDF lisibles, les PDF à traiter et la part de PDF accessibles, et leur variation depuis l’analyse précédente.
- **Évolution** (lien sur chaque site d’une analyse terminée) : PDF publiés ou retirés, couche texte ajoutée ou dégradée, accessibilité améliorée ou dégradée, pages apparues ou disparues. La comparaison se fait par défaut avec l’analyse précédente du même mode (sitemap ou crawl) ; une autre peut être choisie.

Associé à une planification mensuelle avec envoi du rapport par mail, c’est un suivi régulier de chaque site.

## Analyses figées

Le worker vérifie chaque minute les analyses en cours. Un site dont le traitement a disparu de la file ou a échoué passe en échec, avec la raison affichée sur l’analyse ; un PDF dont l’analyse s’est perdue est clôturé en erreur pour que l’analyse se termine. Un traitement encore actif n’est jamais interrompu.

## Sécurité

- **Usage local (par défaut)** : l’API écoute sur `127.0.0.1`, PostgreSQL et Redis ne sont publiés que sur `127.0.0.1`. Rien n’est joignable depuis le réseau.
- **Usage partagé** : définissez `APP_PASSWORD` dans `apps/api/.env`. L’interface demande alors ce mot de passe ; la session est un cookie `HttpOnly`, `SameSite=Strict`, signé (`SESSION_SECRET`), valable 7 jours ; 10 essais ratés bloquent une adresse 15 minutes.
- L’API **refuse de démarrer** si elle est ouverte au réseau (`API_HOST` autre que `127.0.0.1`) sans `APP_PASSWORD`, sauf `ALLOW_OPEN_ACCESS=true` (déconseillé).
- Les exports CSV neutralisent les formules (`=`, `+`, `-`, `@`) : titres et adresses viennent de sites tiers.
- Les adresses locales et privées sont refusées comme cibles de crawl (protection SSRF).
- Dépendances : `corepack pnpm audit --prod`. Restent deux alertes qui demandent une migration majeure (zod 4, Prisma 7).

## Profil Docker complet

Postgres et Redis suffisent en développement. Pour déployer l’ensemble (serveur interne, poste partagé) :

1. Dans `apps/api/.env`, définissez `APP_PASSWORD` et `SESSION_SECRET` (obligatoire : sans mot de passe, l’API refuse de démarrer).
2. Pour un serveur partagé, choisissez aussi un mot de passe de base : variable `POSTGRES_PASSWORD` (dans un fichier `.env` à la racine du dépôt). À faire avant le premier démarrage : PostgreSQL ne l’applique qu’à la création de sa base.
3. Lancez :

```powershell
docker compose --profile full up -d --build
```

L’interface est servie sur http://localhost:8080 (seul port exposé ; l’API reste interne au réseau Docker). L’API applique les migrations au démarrage (`RUN_MIGRATIONS=true`). Les conteneurs de l’API et du worker tournent sans droits administrateur. Pour un accès hors du poste, placez un reverse proxy HTTPS devant le port 8080 : le cookie de session devient alors `Secure`.

## Limites de cette version

- Le crawl lit le HTML statique, `robots.txt` et les sitemaps. Il ne rend pas les pages avec un navigateur.
- La détection OCR constate une couche texte page par page. Elle ne lance pas de moteur OCR.
- L’outil est prévu pour un usage local, sans compte utilisateur. Ne l’exposez pas sur Internet sans contrôle d’accès : il peut crawler des sites et envoyer du mail.
