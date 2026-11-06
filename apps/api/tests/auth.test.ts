import { describe, expect, it } from 'vitest'
import {
  authEnabled,
  checkPassword,
  clearLoginFailures,
  createSession,
  isLoopbackHost,
  loginBlocked,
  readCookie,
  recordLoginFailure,
  SESSION_TTL_MS,
  sessionCookie,
  verifySession,
} from '../src/lib/auth'
import { csvCell } from '../src/lib/pdf-triage'

describe('authentification', () => {
  it('n’est active que si un mot de passe est défini', () => {
    expect(authEnabled('')).toBe(false)
    expect(authEnabled('secret')).toBe(true)
  })

  it('vérifie le mot de passe, jamais vide', () => {
    expect(checkPassword('secret', 'secret')).toBe(true)
    expect(checkPassword('Secret', 'secret')).toBe(false)
    expect(checkPassword('', '')).toBe(false)
  })

  it('accepte une session signée et valide, refuse une session falsifiée ou expirée', () => {
    const now = 1_000_000
    const session = createSession(now, 'cle')
    expect(verifySession(session, now + 1000, 'cle')).toBe(true)
    expect(verifySession(session, now + SESSION_TTL_MS + 1, 'cle')).toBe(false)
    expect(verifySession(session, now, 'autre-cle')).toBe(false)
    const [, signature] = session.split('.')
    expect(verifySession(`${now + SESSION_TTL_MS * 100}.${signature}`, now, 'cle')).toBe(false)
    expect(verifySession(undefined)).toBe(false)
    expect(verifySession('pas-une-session')).toBe(false)
  })

  it('pose un cookie HttpOnly et SameSite=Strict, Secure en HTTPS', () => {
    expect(sessionCookie('abc', false)).toMatch(/^carto_session=abc; Path=\/; HttpOnly; SameSite=Strict; Max-Age=\d+$/)
    expect(sessionCookie('abc', true)).toMatch(/; Secure$/)
    expect(readCookie('a=1; carto_session=x.y%3D; b=2', 'carto_session')).toBe('x.y=')
  })

  it('bloque une adresse après 10 échecs, puis la libère', () => {
    const ip = '203.0.113.7'
    for (let i = 0; i < 9; i += 1) recordLoginFailure(ip, 0)
    expect(loginBlocked(ip, 0)).toBe(false)
    recordLoginFailure(ip, 0)
    expect(loginBlocked(ip, 0)).toBe(true)
    expect(loginBlocked(ip, 16 * 60 * 1000)).toBe(false)
    clearLoginFailures(ip)
  })

  it('reconnaît les adresses locales', () => {
    expect(isLoopbackHost('127.0.0.1')).toBe(true)
    expect(isLoopbackHost('localhost')).toBe(true)
    expect(isLoopbackHost('0.0.0.0')).toBe(false)
    expect(isLoopbackHost('192.168.1.10')).toBe(false)
  })
})

describe('CSV', () => {
  it('neutralise les formules venues de sites tiers', () => {
    expect(csvCell('=HYPERLINK("http://x","clic")')).toBe(`"'=HYPERLINK(""http://x"",""clic"")"`)
    expect(csvCell('+33 1 23')).toBe(`'+33 1 23`)
    expect(csvCell('@SUM(A1)')).toBe(`'@SUM(A1)`)
    expect(csvCell(-3)).toBe('-3')
    expect(csvCell('Compte rendu')).toBe('Compte rendu')
  })
})
