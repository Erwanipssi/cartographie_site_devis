import { execSync } from 'node:child_process'
import { mkdir } from 'node:fs/promises'
import { dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { buildApp } from './app'
import { env } from './env'
import { authEnabled, isLoopbackHost } from './lib/auth'
import { logger } from './lib/logger'
import { prisma } from './lib/prisma'
import { closeQueues } from './lib/queues'
import { redis } from './lib/redis'

const apiRoot = dirname(dirname(fileURLToPath(import.meta.url)))

async function main(): Promise<void> {
  // Une API joignable depuis le réseau sans mot de passe laisserait n'importe qui lancer des crawls ou lire les résultats.
  if (!isLoopbackHost(env.API_HOST) && !authEnabled() && env.ALLOW_OPEN_ACCESS !== 'true') {
    logger.fatal(
      { host: env.API_HOST },
      `API_HOST=${env.API_HOST} rend l’API joignable depuis le réseau : définissez APP_PASSWORD dans apps/api/.env ` +
        '(ou API_HOST=127.0.0.1 pour un usage local).',
    )
    process.exit(1)
  }
  if (env.RUN_MIGRATIONS === 'true') {
    execSync('pnpm exec prisma migrate deploy', { stdio: 'inherit', cwd: apiRoot })
  }
  try {
    await prisma.$connect()
    await redis.ping()
  } catch (error) {
    logger.error({ err: error }, 'Postgres ou Redis indisponible. Lancez « pnpm infra » puis réessayez.')
    process.exit(1)
  }
  await mkdir(env.EXPORT_DIR, { recursive: true })
  const app = await buildApp()
  const shutdown = async () => {
    await app.close()
    await closeQueues()
    await prisma.$disconnect()
    redis.disconnect()
    process.exit(0)
  }
  process.on('SIGINT', () => void shutdown())
  process.on('SIGTERM', () => void shutdown())
  await app.listen({ port: env.API_PORT, host: env.API_HOST })
}

void main().catch((error: unknown) => {
  logger.error({ err: error }, 'API arrêtée')
  process.exit(1)
})
