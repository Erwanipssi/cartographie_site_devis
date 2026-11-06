import { config as loadEnv } from 'dotenv'
import { existsSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { z } from 'zod'

const here = dirname(fileURLToPath(import.meta.url))
for (const path of [resolve(here, '../.env'), resolve(here, '../../../.env'), resolve(process.cwd(), '.env')]) {
  if (existsSync(path)) loadEnv({ path })
}

const schema = z.object({
  DATABASE_URL: z.string().min(1),
  REDIS_URL: z.string().default('redis://127.0.0.1:6379'),
  // Local par défaut : l'API n'est pas joignable depuis le réseau sans configuration explicite.
  API_HOST: z.string().default('127.0.0.1'),
  API_PORT: z.coerce.number().default(3001),
  WEB_ORIGIN: z.string().default('http://localhost:5173'),
  CARTOGRAPHIE_USER_AGENT: z.string().default('CartographieBot/0.1 (+local; audit de contenus)'),
  CRAWL_SITE_CONCURRENCY: z.coerce.number().int().min(1).max(8).default(2),
  PDF_CONCURRENCY: z.coerce.number().int().min(1).max(8).default(4),
  PDF_MAX_BYTES: z.coerce.number().int().positive().default(52_428_800),
  EXPORT_DIR: z.string().default('./data/exports'),
  SMTP_HOST: z.string().default(''),
  SMTP_PORT: z.coerce.number().default(587),
  SMTP_SECURE: z.enum(['true', 'false']).default('false'),
  SMTP_USER: z.string().default(''),
  SMTP_PASS: z.string().default(''),
  MAIL_FROM: z.string().default('cartographie@localhost'),
  RUN_MIGRATIONS: z.enum(['true', 'false']).default('false'),
  /** Mot de passe d'accès à l'interface et à l'API. Vide : pas d'authentification (usage local uniquement). */
  APP_PASSWORD: z.string().default(''),
  /** Clé de signature des sessions. Vide : clé aléatoire à chaque démarrage (il faut alors se reconnecter). */
  SESSION_SECRET: z.string().default(''),
  /** Autorise une API joignable depuis le réseau sans mot de passe. À éviter. */
  ALLOW_OPEN_ACCESS: z.enum(['true', 'false']).default('false'),
  /** true derrière un proxy (nginx du déploiement Docker) : l'adresse du visiteur est lue dans X-Forwarded-For. */
  TRUST_PROXY: z.enum(['true', 'false']).default('false'),
})

export const env = schema.parse(process.env)
export const smtpConfigured = env.SMTP_HOST.length > 0
