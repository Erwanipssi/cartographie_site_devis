import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto'
import { env } from '../env'

/**
 * Authentification par mot de passe partagé (APP_PASSWORD), sans dépendance :
 * - la session est un cookie HttpOnly « expiration.signature » signé par HMAC-SHA256 ;
 * - SameSite=Strict : le navigateur ne l'envoie pas depuis un autre site, ce qui protège des requêtes forgées (CSRF) ;
 * - les essais de mot de passe sont limités par adresse IP.
 * Sans APP_PASSWORD, tout est ouvert : réservé à l'usage local (l'API écoute alors sur 127.0.0.1).
 */

export const SESSION_COOKIE = 'carto_session'
export const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000
const secret = env.SESSION_SECRET || randomBytes(32).toString('hex')

export function authEnabled(password = env.APP_PASSWORD): boolean {
  return password.length > 0
}

function sign(value: string, key = secret): string {
  return createHmac('sha256', key).update(value).digest('base64url')
}

function sameText(a: string, b: string): boolean {
  // Comparaison en temps constant sur des empreintes de même longueur : ne révèle ni le contenu ni la taille.
  return timingSafeEqual(createHash('sha256').update(a).digest(), createHash('sha256').update(b).digest())
}

export function checkPassword(candidate: string, expected = env.APP_PASSWORD): boolean {
  return expected.length > 0 && sameText(candidate, expected)
}

export function createSession(now = Date.now(), key = secret): string {
  const expires = String(now + SESSION_TTL_MS)
  return `${expires}.${sign(expires, key)}`
}

export function verifySession(value: string | undefined, now = Date.now(), key = secret): boolean {
  if (!value) return false
  const [expires, signature] = value.split('.')
  if (!expires || !signature || !/^\d+$/.test(expires)) return false
  if (!sameText(signature, sign(expires, key))) return false
  return Number(expires) > now
}

export function readCookie(header: string | undefined, name: string): string | undefined {
  for (const part of (header ?? '').split(';')) {
    const [key, ...rest] = part.trim().split('=')
    if (key === name) return decodeURIComponent(rest.join('='))
  }
  return undefined
}

export function sessionCookie(value: string, secure: boolean, maxAgeMs = SESSION_TTL_MS): string {
  const parts = [`${SESSION_COOKIE}=${value}`, 'Path=/', 'HttpOnly', 'SameSite=Strict', `Max-Age=${Math.floor(maxAgeMs / 1000)}`]
  if (secure) parts.push('Secure')
  return parts.join('; ')
}

/** Limite des essais de connexion : 10 échecs par adresse sur 15 minutes. */
const MAX_FAILURES = 10
const WINDOW_MS = 15 * 60 * 1000
const failures = new Map<string, { count: number; since: number }>()

export function loginBlocked(ip: string, now = Date.now()): boolean {
  const entry = failures.get(ip)
  if (!entry) return false
  if (now - entry.since > WINDOW_MS) {
    failures.delete(ip)
    return false
  }
  return entry.count >= MAX_FAILURES
}

export function recordLoginFailure(ip: string, now = Date.now()): void {
  const entry = failures.get(ip)
  if (!entry || now - entry.since > WINDOW_MS) failures.set(ip, { count: 1, since: now })
  else entry.count += 1
}

export function clearLoginFailures(ip: string): void {
  failures.delete(ip)
}

/** Adresses qui n'exposent l'API qu'au poste local. */
export function isLoopbackHost(host: string): boolean {
  return host === 'localhost' || host === '::1' || /^127\./.test(host)
}
