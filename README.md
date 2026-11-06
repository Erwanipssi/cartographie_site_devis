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

## Tests

```powershell
corepack pnpm test
```

Les tests couvrent la normalisation d’URL, le refus des adresses privées, la classification du contenu, la lecture des sitemaps, l’extraction de liens, le crawl en mémoire (domaine, profondeur, plafond de pages, mode sitemap, robots.txt et Crawl-delay), la liste des PDF à traiter et la structure du classeur Excel.

Les tests d’intégration (`apps/api/tests/integration`) utilisent la vraie base et le vrai Redis de `pnpm start` : chaque exécution crée un schéma PostgreSQL jetable, y applique les migrations, déroule une analyse complète et la surveillance des analyses figées, puis supprime le schéma. Sans Docker, ils sont ignorés.

## PDF à traiter et accessibilité

Depuis une analyse, « PDF à traiter » propose deux vues, chacune exportable en CSV et reprise dans le classeur Excel :

- **Couche texte** : PDF non OCRisés, partiels ou illisibles, du plus urgent au moins urgent.
- **Accessibilité** (critères RGAA sur les documents bureautiques) : PDF non balisés, sans titre ou avec un titre non pertinent (« Microsoft Word - … », nom de fichier, champs de publipostage), ou sans langue déclarée.

Les contrôles d’accessibilité ne concernent que les PDF analysés après leur ajout : relancez l’analyse d’un site pour les obtenir.

## Analyses figées

Le worker vérifie chaque minute les analyses en cours. Un site dont le traitement a disparu de la file ou a échoué passe en échec, avec la raison affichée sur l’analyse ; un PDF dont l’analyse s’est perdue est clôturé en erreur pour que l’analyse se termine. Un traitement encore actif n’est jamais interrompu.

## Profil Docker complet

Postgres et Redis suffisent en développement. Pour tout lancer dans Docker :

```powershell
docker compose --profile full up --build
```

L’interface est alors servie sur http://localhost:8080. L’API applique les migrations au démarrage (`RUN_MIGRATIONS=true`).

## Limites de cette version

- Le crawl lit le HTML statique, `robots.txt` et les sitemaps. Il ne rend pas les pages avec un navigateur.
- La détection OCR constate une couche texte page par page. Elle ne lance pas de moteur OCR.
- L’outil est prévu pour un usage local, sans compte utilisateur. Ne l’exposez pas sur Internet sans contrôle d’accès : il peut crawler des sites et envoyer du mail.
