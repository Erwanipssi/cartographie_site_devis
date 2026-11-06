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

Trois processus : l’API, le worker, l’interface.

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

Les tests couvrent la normalisation d’URL, le refus des adresses privées, la classification du contenu, la lecture des sitemaps, l’extraction de liens, le crawl en mémoire (domaine, profondeur, plafond de pages) et la structure du classeur Excel.

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
