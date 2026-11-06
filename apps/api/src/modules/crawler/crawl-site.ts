import robotsParser from 'robots-parser'
import type { CrawlConfig } from '@cartographie/shared'
import { classifyContentType, looksLikePdf } from '../../lib/classify'
import { extractLinks } from '../../lib/links'
import { parseSitemapLocs } from '../../lib/sitemap'
import { isInScope, normalizeUrl } from '../../lib/url'
import type { CrawlInput, CrawlStats, DiscoveredError } from './types'

type QueueItem = {
  url: string
  /** URL telle qu'écrite dans le lien : robots.txt s'applique à cet ordre de paramètres, pas à l'URL normalisée. */
  rawUrl: string
  depth: number
  parentUrl: string | null
  fromSitemap: boolean
  guessPdf: boolean
}

function decodeBody(body: Uint8Array, contentType: string | null): string {
  const match = /charset=([^;]+)/i.exec(contentType ?? '')
  const charset = match?.[1]?.trim().replace(/["']/g, '') || 'utf-8'
  try {
    return new TextDecoder(charset).decode(body)
  } catch {
    return new TextDecoder().decode(body)
  }
}

export async function crawlSite(input: CrawlInput): Promise<CrawlStats> {
  const seed = normalizeUrl(input.seedUrl)
  if (!seed) throw new Error('URL de départ invalide')
  const seedUrl = new URL(seed)
  const seedHost = seedUrl.hostname
  const origin = seedUrl.origin
  const config: CrawlConfig = input.config
  const shouldCancel = input.shouldCancel ?? (async () => false)

  let slot = Promise.resolve()
  const pace = async () => {
    if (config.delayMs <= 0) return
    const wait = slot.then(() => sleep(config.delayMs))
    slot = wait.catch(() => undefined)
    await wait
  }

  // Certains CMS (TYPO3 notamment) renvoient par intermittence une erreur 500 sur sitemap.xml :
  // on retente les erreurs serveur et réseau, avec une attente croissante, avant d'abandonner.
  const retryDelayMs = input.retryDelayMs ?? 1500
  const sitemapMode = config.mode === 'sitemap'
  const sitemapAttempts = sitemapMode ? 6 : 3
  type ReadResult = { text: string | null; status: number | null; message: string | null }
  const readText = async (url: string, attempts = 1): Promise<ReadResult> => {
    let last: ReadResult = { text: null, status: null, message: null }
    for (let attempt = 1; attempt <= attempts; attempt += 1) {
      await pace()
      const result = await input.fetch(url)
      if (result.ok && result.status < 400) {
        return { text: result.body.byteLength === 0 ? null : decodeBody(result.body, result.contentType), status: result.status, message: null }
      }
      last = result.ok ? { text: null, status: result.status, message: `HTTP ${result.status}` } : { text: null, status: result.status ?? null, message: result.message }
      const retryable = !result.ok ? result.errorType === 'network' || result.errorType === 'timeout' : result.status >= 500
      if (!retryable || attempt === attempts) return last
      await sleep(Math.min(retryDelayMs * 2 ** (attempt - 1), 20_000))
    }
    return last
  }

  let isAllowed = (_url: string) => true
  const sitemapSeeds: string[] = [`${origin}/sitemap.xml`]
  if (config.respectRobots) {
    const robotsBody = (await readText(`${origin}/robots.txt`)).text
    if (robotsBody) {
      const robots = robotsParser(`${origin}/robots.txt`, robotsBody)
      isAllowed = (url) => robots.isAllowed(url, input.userAgent) !== false
      sitemapSeeds.unshift(...robots.getSitemaps())
    }
  }

  const seenSitemaps = new Set<string>()
  const discovered: string[] = []
  // Sitemaps qui n'ont jamais répondu : le sitemap obtenu est alors incomplet, on le signale.
  const failedSitemaps: Array<{ url: string; status: number | null; message: string }> = []
  const walkSitemap = async (rawUrl: string, depth = 0): Promise<void> => {
    const url = normalizeUrl(rawUrl)
    if (!url || seenSitemaps.has(url) || depth > 4 || seenSitemaps.size >= 50) return
    if (!isInScope(new URL(url).hostname, seedHost, input.includeSubdomains)) return
    seenSitemaps.add(url)
    const read = await readText(url, sitemapAttempts)
    const xml = read.text
    if (!xml) {
      // Le sitemap.xml racine absent (404) est courant : seule une erreur serveur ou un sous-sitemap manquant compte.
      if (depth > 0 || (read.status ?? 500) >= 500) failedSitemaps.push({ url, status: read.status, message: read.message ?? 'Réponse vide' })
      return
    }
    const parsed = parseSitemapLocs(xml)
    if (parsed.index) {
      for (const loc of parsed.locs) {
        if (discovered.length >= config.maxPages + config.maxPdfs) return
        await walkSitemap(loc, depth + 1)
      }
      return
    }
    for (const loc of parsed.locs) {
      discovered.push(loc)
      if (discovered.length >= config.maxPages + config.maxPdfs) return
    }
  }
  for (const sitemapUrl of sitemapSeeds) await walkSitemap(sitemapUrl)

  // Lecture complète : on la mémorise. Lecture ratée ou partielle : on complète avec la dernière version connue.
  const liveComplete = discovered.length > 0 && failedSitemaps.length === 0
  const known = input.knownSitemap && input.knownSitemap.urls.length > 0 ? input.knownSitemap : null
  const usedKnownSitemap = !liveComplete && known !== null
  if (liveComplete) {
    try {
      await input.onSitemapRead?.([...new Set(discovered)])
    } catch {
      /* mémorisation facultative */
    }
  } else if (known) {
    const present = new Set(discovered)
    for (const loc of known.urls) if (!present.has(loc)) discovered.push(loc)
  }
  const sitemapUrlCount = new Set(discovered.map((loc) => normalizeUrl(loc) ?? loc)).size
  // Mode sitemap sans sitemap exploitable : on retombe sur le crawl complet plutôt que de ne rien trouver.
  const followLinks = !sitemapMode || sitemapUrlCount === 0
  // Crawl de secours du mode sitemap : la profondeur réglée (inutile en mode sitemap) ne doit pas brider le parcours.
  const maxDepth = sitemapMode ? 8 : config.maxDepth
  try {
    await input.onSitemap?.(sitemapUrlCount)
  } catch {
    /* compteur indicatif */
  }

  const queue: QueueItem[] = []
  const seen = new Set<string>()
  const done = new Set<string>()
  let queuedHtml = 0
  let queuedPdf = 0
  let htmlCount = 0
  let pdfCount = 0
  let otherCount = 0
  let errorCount = 0
  let stopped = false

  // Un échec d'enregistrement (base saturée, etc.) ne doit jamais faire tomber le crawl.
  const reportError = async (error: DiscoveredError) => {
    errorCount += 1
    try {
      await input.onError(error)
    } catch {
      /* erreur déjà comptée ; on poursuit */
    }
  }

  const enqueue = (raw: string, depth: number, parentUrl: string | null, fromSitemap: boolean) => {
    const url = normalizeUrl(raw)
    if (!url || seen.has(url)) return
    let host = ''
    try {
      host = new URL(url).hostname
    } catch {
      return
    }
    if (!isInScope(host, seedHost, input.includeSubdomains)) return
    // Mode sitemap : on ne suit que les liens vers des PDF, pas les autres pages.
    if (!followLinks && !fromSitemap && !looksLikePdf(url)) return
    if (followLinks && !fromSitemap && depth > maxDepth) return
    const rawUrl = raw.split('#')[0] ?? raw
    // Filtré ici pour ne pas consommer le quota de pages avec des URL interdites (pagination, impression…).
    if (config.respectRobots && url !== seed && (!isAllowed(rawUrl) || !isAllowed(url))) return
    const guessPdf = looksLikePdf(url)
    if (guessPdf) {
      if (pdfCount + queuedPdf >= config.maxPdfs) return
      queuedPdf += 1
    } else {
      if (htmlCount + queuedHtml >= config.maxPages) return
      queuedHtml += 1
    }
    seen.add(url)
    queue.push({ url, rawUrl, depth, parentUrl, fromSitemap, guessPdf })
  }

  for (const failed of failedSitemaps) {
    await reportError({
      url: failed.url,
      errorType: 'sitemap',
      message: `Sitemap illisible après ${sitemapAttempts} essais (${failed.message})${
        usedKnownSitemap && known
          ? ` : dernière version lue le ${known.readAt.toLocaleDateString('fr-FR')} à ${known.readAt.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })} utilisée (${known.urls.length} URL)`
          : followLinks && sitemapMode
            ? ' : crawl complet utilisé'
            : ''
      }`,
      httpStatus: failed.status,
    })
  }
  // En mode sitemap, la page d'accueil n'est analysée que si le sitemap la liste : le décompte colle au sitemap.
  if (followLinks) enqueue(seed, 0, null, false)
  for (const loc of discovered) enqueue(loc, 0, null, true)

  const handle = async (item: QueueItem) => {
    if (item.guessPdf) queuedPdf = Math.max(0, queuedPdf - 1)
    else queuedHtml = Math.max(0, queuedHtml - 1)
    try {
      if (stopped || (await shouldCancel())) {
        stopped = true
        return
      }
      if (done.has(item.url)) return
      done.add(item.url)
      if (config.respectRobots && (!isAllowed(item.rawUrl) || !isAllowed(item.url))) {
        if (item.url === seed) {
          stopped = true
          await reportError({
            url: item.url,
            errorType: 'robots',
            message: 'URL de départ interdite par robots.txt',
            httpStatus: null,
          })
        }
        return
      }

      await pace()
      const result = await input.fetch(item.url)
      if (!result.ok) {
        await reportError({
          url: item.url,
          errorType: result.errorType,
          message: result.message,
          httpStatus: result.status ?? null,
        })
        return
      }
      if (result.status < 200 || result.status >= 300) {
        await reportError({
          url: item.url,
          errorType: 'http',
          message: `HTTP ${result.status}`,
          httpStatus: result.status,
        })
        return
      }

      const finalUrl = normalizeUrl(result.finalUrl) ?? result.finalUrl
      const finalHost = new URL(finalUrl).hostname
      if (!isInScope(finalHost, seedHost, input.includeSubdomains)) {
        await reportError({
          url: finalUrl,
          errorType: 'redirect_out_of_scope',
          message: 'Redirection hors du domaine autorisé',
          httpStatus: result.status,
        })
        return
      }
      done.add(finalUrl)
      seen.add(finalUrl)

      const kind = classifyContentType(result.contentType, finalUrl)
      const record = {
        url: finalUrl,
        httpStatus: result.status,
        depth: item.depth,
        parentUrl: item.parentUrl,
        contentType: result.contentType,
        sizeBytes: result.sizeBytes,
      }
      if (kind === 'html') {
        if (htmlCount >= config.maxPages) return
        htmlCount += 1
        await input.onPage(record)
        if (!followLinks || item.depth + 1 <= maxDepth) {
          const html = decodeBody(result.body, result.contentType)
          for (const link of extractLinks(html, finalUrl)) enqueue(link, item.depth + 1, finalUrl, false)
        }
        return
      }
      if (kind === 'pdf') {
        if (pdfCount >= config.maxPdfs) return
        pdfCount += 1
        await input.onPdf(record)
        return
      }
      otherCount += 1
      await input.onOther()
    } catch (error) {
      await reportError({
        url: item.url,
        errorType: 'network',
        message: error instanceof Error ? error.message : 'Erreur de crawl',
        httpStatus: null,
      })
    }
  }

  let active = 0
  await new Promise<void>((resolve) => {
    const pump = () => {
      while (!stopped && active < config.concurrency && queue.length > 0) {
        const item = queue.shift()
        if (!item) break
        active += 1
        // Sans ce catch, un rejet tue le processus (unhandledRejection) et l'analyse reste bloquée.
        void handle(item)
          .catch(() => undefined)
          .finally(() => {
            active -= 1
            pump()
          })
      }
      if (active === 0 && (queue.length === 0 || stopped)) resolve()
    }
    pump()
  })

  return { htmlCount, pdfCount, otherCount, errorCount, sitemapUrlCount, usedSitemap: !followLinks, usedKnownSitemap }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}
