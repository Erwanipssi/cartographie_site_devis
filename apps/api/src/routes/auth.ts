import type { FastifyInstance, FastifyRequest } from 'fastify'
import type { ZodTypeProvider } from 'fastify-type-provider-zod'
import { z } from 'zod'
import {
  authEnabled,
  checkPassword,
  clearLoginFailures,
  createSession,
  loginBlocked,
  readCookie,
  recordLoginFailure,
  SESSION_COOKIE,
  sessionCookie,
  verifySession,
} from '../lib/auth'
import { ApiError } from '../lib/http'

/** Routes accessibles sans session : état de santé et connexion. */
const PUBLIC_ROUTES = new Set(['/api/health', '/api/auth/session', '/api/auth/login', '/api/auth/logout'])

function isSecure(request: FastifyRequest): boolean {
  return request.protocol === 'https' || request.headers['x-forwarded-proto'] === 'https'
}

function isAuthenticated(request: FastifyRequest): boolean {
  return verifySession(readCookie(request.headers.cookie, SESSION_COOKIE))
}

export async function registerAuth(app: FastifyInstance): Promise<void> {
  app.addHook('onRequest', async (request, reply) => {
    if (!authEnabled()) return
    const path = request.url.split('?')[0] ?? ''
    if (!path.startsWith('/api/') || PUBLIC_ROUTES.has(path)) return
    if (isAuthenticated(request)) return
    return reply.status(401).send({ error: { code: 'AUTH_REQUIRED', message: 'Connexion requise', details: null } })
  })

  const route = app.withTypeProvider<ZodTypeProvider>()

  route.get('/api/auth/session', async (request) => ({
    required: authEnabled(),
    authenticated: !authEnabled() || isAuthenticated(request),
  }))

  route.post('/api/auth/login', { schema: { body: z.object({ password: z.string().max(200) }) } }, async (request, reply) => {
    if (!authEnabled()) return { authenticated: true }
    if (loginBlocked(request.ip)) {
      throw new ApiError(429, 'Trop d’essais : réessayez dans quelques minutes', 'TOO_MANY_ATTEMPTS')
    }
    if (!checkPassword(request.body.password)) {
      recordLoginFailure(request.ip)
      request.log.warn({ ip: request.ip }, 'mot de passe refusé')
      throw new ApiError(401, 'Mot de passe incorrect', 'BAD_PASSWORD')
    }
    clearLoginFailures(request.ip)
    reply.header('Set-Cookie', sessionCookie(createSession(), isSecure(request)))
    return { authenticated: true }
  })

  route.post('/api/auth/logout', async (request, reply) => {
    reply.header('Set-Cookie', sessionCookie('', isSecure(request), 0))
    return { authenticated: false }
  })
}
