import cors from '@fastify/cors'
import { Prisma } from '@prisma/client'
import Fastify from 'fastify'
import { serializerCompiler, validatorCompiler } from 'fastify-type-provider-zod'
import { ZodError } from 'zod'
import { env } from './env'
import { ApiError } from './lib/http'
import { registerAnalyses } from './routes/analyses'
import { registerAuth } from './routes/auth'
import { registerHealth } from './routes/health'
import { registerRecipients } from './routes/recipients'
import { registerSchedules } from './routes/schedules'
import { registerSites } from './routes/sites'

export async function buildApp() {
  const app = Fastify({ logger: { level: process.env.LOG_LEVEL ?? 'info' }, trustProxy: env.TRUST_PROXY === 'true', bodyLimit: 256 * 1024 })
  // En-têtes de sécurité sur toutes les réponses de l'API : pas d'interprétation du type de contenu,
  // pas d'affichage dans un cadre tiers, pas de fuite d'adresse vers les sites liés, pas de mise en cache des données.
  app.addHook('onSend', async (request, reply) => {
    reply.header('X-Content-Type-Options', 'nosniff')
    reply.header('X-Frame-Options', 'DENY')
    reply.header('Referrer-Policy', 'no-referrer')
    if (request.url.startsWith('/api/')) reply.header('Cache-Control', 'no-store')
  })
  app.setValidatorCompiler(validatorCompiler)
  app.setSerializerCompiler(serializerCompiler)
  app.setErrorHandler((error, request, reply) => {
    if (error instanceof ApiError) {
      return reply.status(error.statusCode).send({ error: { code: error.code, message: error.message, details: error.details } })
    }
    if (error instanceof ZodError) {
      return reply.status(400).send({
        error: { code: 'VALIDATION', message: error.issues[0]?.message ?? 'Données invalides', details: error.issues },
      })
    }
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2025') {
      return reply.status(404).send({ error: { code: 'NOT_FOUND', message: 'Ressource introuvable', details: null } })
    }
    const known = error as { statusCode?: unknown; message?: unknown }
    const statusCode = typeof known.statusCode === 'number' ? known.statusCode : 500
    if (statusCode >= 500) request.log.error({ err: error }, 'erreur interne')
    const message = error instanceof Error ? error.message : 'Erreur interne'
    return reply.status(statusCode).send({
      error: {
        code: statusCode === 400 ? 'VALIDATION' : 'INTERNAL',
        message: statusCode >= 500 ? 'Erreur interne' : message,
        details: null,
      },
    })
  })
  await app.register(cors, { origin: env.WEB_ORIGIN, credentials: true })
  await registerAuth(app)
  await registerHealth(app)
  await registerSites(app)
  await registerAnalyses(app)
  await registerRecipients(app)
  await registerSchedules(app)
  return app
}
