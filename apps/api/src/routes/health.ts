import type { FastifyInstance } from 'fastify'
import { prisma } from '../lib/prisma'
import { redis } from '../lib/redis'
import { smtpConfigured } from '../env'

export async function registerHealth(app: FastifyInstance): Promise<void> {
  app.get('/api/health', async () => {
    let db = true
    try {
      await prisma.$queryRaw`SELECT 1`
    } catch {
      db = false
    }
    let redisOk = true
    try {
      await redis.ping()
    } catch {
      redisOk = false
    }
    const beat = redisOk ? await redis.get('worker:heartbeat').catch(() => null) : null
    return { ok: db && redisOk, db, redis: redisOk, worker: Boolean(beat), smtp: smtpConfigured }
  })

  app.get('/', async () => ({ service: 'cartographie-api' }))
}
