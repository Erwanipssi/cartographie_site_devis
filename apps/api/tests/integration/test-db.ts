/**
 * Base de test jetable pour les tests d'intégration : un schéma PostgreSQL dédié, où sont appliquées
 * les migrations du projet. Fonctionne sur une base vierge (CI) comme sur la base de développement.
 */
import { randomBytes } from 'node:crypto'
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { config as loadEnv } from 'dotenv'
import { PrismaClient } from '@prisma/client'

loadEnv({ path: join(__dirname, '..', '..', '.env') })

export const baseUrl = process.env.DATABASE_URL ?? ''

export async function databaseReachable(): Promise<boolean> {
  if (!baseUrl) return false
  const probe = new PrismaClient({ datasourceUrl: baseUrl })
  try {
    await probe.$queryRaw`SELECT 1`
    return true
  } catch {
    return false
  } finally {
    await probe.$disconnect()
  }
}

/** Crée un schéma neuf, y applique les migrations, et renvoie son URL de connexion. */
export async function createTestSchema(): Promise<{ schema: string; url: string }> {
  const schema = `it_${randomBytes(4).toString('hex')}`
  const url = `${baseUrl}${baseUrl.includes('?') ? '&' : '?'}schema=${schema}`
  const client = new PrismaClient({ datasourceUrl: url })
  try {
    await client.$executeRawUnsafe(`CREATE SCHEMA "${schema}"`)
    const dir = join(__dirname, '..', '..', 'prisma', 'migrations')
    for (const name of readdirSync(dir).filter((entry) => /^\d+_/.test(entry)).sort()) {
      const sql = readFileSync(join(dir, name, 'migration.sql'), 'utf8')
      const statements = sql
        .split(/;\s*(?:\r?\n|$)/)
        .map((statement) => statement.replace(/^\s*--.*$/gm, '').trim())
        .filter(Boolean)
      for (const statement of statements) await client.$executeRawUnsafe(statement)
    }
  } finally {
    await client.$disconnect()
  }
  return { schema, url }
}

export async function dropTestSchema(client: PrismaClient, schema: string): Promise<void> {
  await client.$executeRawUnsafe(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`)
}
