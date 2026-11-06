/**
 * Authentification de bout en bout : l'API réelle (Fastify, sans réseau) avec un mot de passe défini,
 * sur un schéma de test migré (la base peut être vierge, comme en CI). Ignoré si PostgreSQL ne répond pas.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { FastifyInstance } from 'fastify'
import { createTestSchema, databaseReachable, dropTestSchema } from './test-db'

process.env.APP_PASSWORD = 'mot-de-passe-de-test'
process.env.SESSION_SECRET = 'cle-de-test-cle-de-test-cle-de-test'

const reachable = await databaseReachable()

describe.skipIf(!reachable)('accès protégé par mot de passe', () => {
  let app: FastifyInstance
  let schema = ''

  beforeAll(async () => {
    // Le client Prisma de l'application lit DATABASE_URL à l'import : on le pointe sur le schéma de test d'abord.
    const test = await createTestSchema()
    schema = test.schema
    process.env.DATABASE_URL = test.url
    const { buildApp } = await import('../../src/app')
    app = await buildApp()
    await app.ready()
  })

  afterAll(async () => {
    await app?.close()
    const { closeQueues } = await import('../../src/lib/queues')
    const { redis } = await import('../../src/lib/redis')
    const { prisma } = await import('../../src/lib/prisma')
    if (schema) await dropTestSchema(prisma, schema)
    await closeQueues()
    redis.disconnect()
    await prisma.$disconnect()
  })

  it('refuse les routes protégées sans session, laisse passer la santé et la connexion', async () => {
    const sites = await app.inject({ method: 'GET', url: '/api/sites' })
    expect(sites.statusCode).toBe(401)
    expect(sites.json().error.code).toBe('AUTH_REQUIRED')
    expect((await app.inject({ method: 'GET', url: '/api/health' })).statusCode).toBe(200)
    expect((await app.inject({ method: 'GET', url: '/api/auth/session' })).json()).toEqual({ required: true, authenticated: false })
  })

  it('refuse un mauvais mot de passe, accepte le bon et ouvre la session', async () => {
    const wrong = await app.inject({ method: 'POST', url: '/api/auth/login', payload: { password: 'faux' } })
    expect(wrong.statusCode).toBe(401)
    expect(wrong.headers['set-cookie']).toBeUndefined()

    const login = await app.inject({ method: 'POST', url: '/api/auth/login', payload: { password: 'mot-de-passe-de-test' } })
    expect(login.statusCode).toBe(200)
    const cookie = String(login.headers['set-cookie'])
    expect(cookie).toMatch(/^carto_session=\d+\.[\w-]+; Path=\/; HttpOnly; SameSite=Strict/)

    const session = cookie.split(';')[0]!
    const sites = await app.inject({ method: 'GET', url: '/api/sites', headers: { cookie: session } })
    expect(sites.statusCode).toBe(200)
    expect((await app.inject({ method: 'GET', url: '/api/auth/session', headers: { cookie: session } })).json()).toEqual({
      required: true,
      authenticated: true,
    })
  })

  it('refuse une session falsifiée', async () => {
    const forged = await app.inject({ method: 'GET', url: '/api/sites', headers: { cookie: `carto_session=${Date.now() + 1e9}.signature-inventee` } })
    expect(forged.statusCode).toBe(401)
  })

  it('pose les en-têtes de sécurité', async () => {
    const response = await app.inject({ method: 'GET', url: '/api/health' })
    expect(response.headers['x-content-type-options']).toBe('nosniff')
    expect(response.headers['x-frame-options']).toBe('DENY')
    expect(response.headers['referrer-policy']).toBe('no-referrer')
    expect(response.headers['cache-control']).toBe('no-store')
  })
})
