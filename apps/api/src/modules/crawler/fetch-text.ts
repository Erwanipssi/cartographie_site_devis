import type { Fetcher } from './types'

export type ReadResult = { text: string | null; status: number | null; message: string | null }
export type TextReader = (url: string, attempts?: number) => Promise<ReadResult>

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

export function decodeBody(body: Uint8Array, contentType: string | null): string {
  const match = /charset=([^;]+)/i.exec(contentType ?? '')
  const charset = match?.[1]?.trim().replace(/["']/g, '') || 'utf-8'
  try {
    return new TextDecoder(charset).decode(body)
  } catch {
    return new TextDecoder().decode(body)
  }
}

/**
 * Cadence des requêtes vers un site : au plus une requête qui démarre par intervalle, même avec plusieurs
 * requêtes en parallèle. Le délai ne peut qu'augmenter (Crawl-delay de robots.txt).
 */
export function createPacer(initialDelayMs: number) {
  let delayMs = initialDelayMs
  let slot = Promise.resolve()
  return {
    async pace(): Promise<void> {
      if (delayMs <= 0) return
      const wait = slot.then(() => sleep(delayMs))
      slot = wait.catch(() => undefined)
      await wait
    },
    raiseDelay(ms: number): void {
      delayMs = Math.max(delayMs, ms)
    },
  }
}

/**
 * Lecture d'un texte (robots.txt, sitemap) avec nouvelles tentatives sur les erreurs passagères :
 * certains CMS (TYPO3 notamment) renvoient par intermittence une erreur 500 sur sitemap.xml.
 * Attente croissante entre deux essais, plafonnée à 20 s.
 */
export function createTextReader(fetch: Fetcher, pace: () => Promise<void>, retryDelayMs: number): TextReader {
  return async (url, attempts = 1) => {
    let last: ReadResult = { text: null, status: null, message: null }
    for (let attempt = 1; attempt <= attempts; attempt += 1) {
      await pace()
      const result = await fetch(url)
      if (result.ok && result.status < 400) {
        return { text: result.body.byteLength === 0 ? null : decodeBody(result.body, result.contentType), status: result.status, message: null }
      }
      last = result.ok
        ? { text: null, status: result.status, message: `HTTP ${result.status}` }
        : { text: null, status: result.status ?? null, message: result.message }
      const retryable = !result.ok ? result.errorType === 'network' || result.errorType === 'timeout' : result.status >= 500
      if (!retryable || attempt === attempts) return last
      await sleep(Math.min(retryDelayMs * 2 ** (attempt - 1), 20_000))
    }
    return last
  }
}
