import { Agent, request } from 'undici'
import { looksLikePdf } from '../../lib/classify'
import { safeLookup } from '../../lib/ssrf'
import type { PublicFetchResult } from './types'

const agent = new Agent({
  connect: {
    lookup: safeLookup as never,
  },
})

const REDIRECT = new Set([301, 302, 303, 307, 308])

function header(headers: Record<string, string | string[] | undefined>, name: string): string | null {
  const value = headers[name]
  if (!value) return null
  return Array.isArray(value) ? (value[0] ?? null) : value
}

function mapError(error: unknown, finalUrl: string): PublicFetchResult {
  const err = error as { name?: string; code?: string; message?: string }
  if (err.code === 'ESSRF') {
    return { ok: false, finalUrl, errorType: 'ssrf', message: 'Adresse non autorisée' }
  }
  if (
    err.name === 'TimeoutError' ||
    err.name === 'AbortError' ||
    err.code === 'UND_ERR_HEADERS_TIMEOUT' ||
    err.code === 'UND_ERR_BODY_TIMEOUT' ||
    err.code === 'UND_ERR_CONNECT_TIMEOUT'
  ) {
    return { ok: false, finalUrl, errorType: 'timeout', message: 'Délai dépassé' }
  }
  return { ok: false, finalUrl, errorType: 'network', message: err.message || 'Erreur réseau' }
}

async function readLimited(body: AsyncIterable<Uint8Array> & { dump?: () => Promise<void> }, maxBytes: number) {
  const chunks: Buffer[] = []
  let total = 0
  for await (const chunk of body) {
    total += chunk.byteLength
    if (total > maxBytes) {
      await body.dump?.()
      return { bytes: new Uint8Array(), truncated: true }
    }
    chunks.push(Buffer.from(chunk))
  }
  return { bytes: new Uint8Array(Buffer.concat(chunks)), truncated: false }
}

export async function fetchPublic(
  url: string,
  options: { userAgent: string; timeoutMs: number; maxBytes: number; skipPdfBody?: boolean; maxRedirects?: number },
): Promise<PublicFetchResult> {
  const maxRedirects = options.maxRedirects ?? 5
  let current = url
  const seen = new Set<string>()
  for (let hop = 0; hop <= maxRedirects; hop += 1) {
    if (seen.has(current)) {
      return { ok: false, finalUrl: current, errorType: 'network', message: 'Boucle de redirection' }
    }
    seen.add(current)
    try {
      const response = await request(current, {
        method: 'GET',
        dispatcher: agent,
        headers: {
          'user-agent': options.userAgent,
          accept: 'text/html,application/xhtml+xml,application/pdf;q=0.9,*/*;q=0.8',
        },
        signal: AbortSignal.timeout(options.timeoutMs),
      })
      const status = response.statusCode
      if (REDIRECT.has(status)) {
        const location = header(response.headers, 'location')
        await response.body.dump()
        if (!location || hop === maxRedirects) {
          return { ok: false, finalUrl: current, status, errorType: 'network', message: 'Redirection invalide' }
        }
        const next = new URL(location, current)
        if (next.protocol !== 'http:' && next.protocol !== 'https:') {
          return { ok: false, finalUrl: next.toString(), status, errorType: 'ssrf', message: 'Redirection vers un schéma interdit' }
        }
        current = next.toString()
        continue
      }

      const contentType = header(response.headers, 'content-type')
      const lengthHeader = header(response.headers, 'content-length')
      const contentLength = lengthHeader ? Number(lengthHeader) : null
      const mime = contentType?.split(';')[0]?.trim().toLowerCase() ?? ''
      const skipBody = options.skipPdfBody === true && (mime === 'application/pdf' || mime === 'application/x-pdf' || looksLikePdf(current))
      if (skipBody) {
        await response.body.dump()
        return {
          ok: true,
          status,
          finalUrl: current,
          contentType,
          body: new Uint8Array(),
          sizeBytes: Number.isFinite(contentLength) ? contentLength : null,
        }
      }
      if (contentLength && contentLength > options.maxBytes) {
        await response.body.dump()
        return { ok: false, finalUrl: current, status, errorType: 'too_large', message: 'Réponse trop volumineuse' }
      }
      const read = await readLimited(response.body, options.maxBytes)
      if (read.truncated) {
        return { ok: false, finalUrl: current, status, errorType: 'too_large', message: 'Réponse trop volumineuse' }
      }
      return {
        ok: true,
        status,
        finalUrl: current,
        contentType,
        body: read.bytes,
        sizeBytes: read.bytes.byteLength,
      }
    } catch (error) {
      return mapError(error, current)
    }
  }
  return { ok: false, finalUrl: current, errorType: 'network', message: 'Trop de redirections' }
}
