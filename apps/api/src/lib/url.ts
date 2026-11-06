import { getDomain } from 'tldts'

const TRACKING_EXACT = new Set([
  'fbclid',
  'gclid',
  'gbraid',
  'wbraid',
  'mc_cid',
  'mc_eid',
  'igshid',
  '_ga',
  'yclid',
  'msclkid',
  'dclid',
])

export function isTrackingParam(key: string): boolean {
  const normalized = key.toLowerCase()
  return normalized.startsWith('utm_') || TRACKING_EXACT.has(normalized)
}

export function comparableHost(hostname: string): string {
  const host = hostname.toLowerCase().replace(/\.$/, '')
  return host.startsWith('www.') ? host.slice(4) : host
}

export function isInScope(candidateHost: string, seedHost: string, includeSubdomains: boolean): boolean {
  if (comparableHost(candidateHost) === comparableHost(seedHost)) return true
  if (!includeSubdomains) return false
  const candidateDomain = getDomain(candidateHost)
  const seedDomain = getDomain(seedHost)
  return Boolean(candidateDomain && seedDomain && candidateDomain === seedDomain)
}

export function normalizeUrl(input: string): string | null {
  let url: URL
  try {
    url = new URL(input.trim())
  } catch {
    return null
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return null
  if (!url.hostname) return null
  url.hash = ''
  url.hostname = url.hostname.toLowerCase().replace(/\.$/, '')
  if ((url.protocol === 'http:' && url.port === '80') || (url.protocol === 'https:' && url.port === '443')) {
    url.port = ''
  }
  const kept = [...url.searchParams.entries()].filter(([key]) => !isTrackingParam(key))
  url.search = ''
  for (const [key, value] of kept) url.searchParams.append(key, value)
  url.searchParams.sort()
  if (url.pathname !== '/' && url.pathname.endsWith('/')) {
    url.pathname = url.pathname.replace(/\/+$/, '') || '/'
  }
  return url.toString()
}

export function ensureHttpUrl(input: string): string | null {
  const trimmed = input.trim()
  if (!trimmed) return null
  const withScheme = /^[a-zA-Z][a-zA-Z\d+\-.]*:/.test(trimmed) ? trimmed : `https://${trimmed}`
  return normalizeUrl(withScheme)
}
