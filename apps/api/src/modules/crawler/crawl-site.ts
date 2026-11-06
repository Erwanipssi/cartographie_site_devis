import type { CrawlConfig } from '@cartographie/shared'
import { classifyContentType, looksLikePdf } from '../../lib/classify'
import { extractLinks } from '../../lib/links'
import { isInScope, normalizeUrl } from '../../lib/url'
import { createPacer, createTextReader, decodeBody } from './fetch-text'
import { loadRobots, type RobotsRules } from './robots'
import { readSitemaps, sitemapFailureMessage } from './sitemap-reader'
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

/**
 * Analyse d'un site : robots.txt, sitemap, puis file de pages et de PDF.
 * - mode « sitemap » : pages du sitemap, et seulement les liens PDF trouvés dessus ;
 * - mode « crawl », ou sitemap introuvable : tous les liens du site jusqu'à la profondeur réglée.
 */
export async function crawlSite(input: CrawlInput): Promise<CrawlStats> {
  const seed = normalizeUrl(input.seedUrl)
  if (!seed) throw new Error('URL de départ invalide')
  const seedUrl = new URL(seed)
  const seedHost = seedUrl.hostname
  const config: CrawlConfig = input.config
  const shouldCancel = input.shouldCancel ?? (async () => false)
  const inScope = (hostname: string) => isInScope(hostname, seedHost, input.includeSubdomains)

  const pacer = createPacer(config.delayMs)
  const readText = createTextReader(input.fetch, pacer.pace, input.retryDelayMs ?? 1500)
  const sitemapMode = config.mode === 'sitemap'
  const sitemapAttempts = sitemapMode ? 6 : 3

  let robots: RobotsRules = { isAllowed: () => true, sitemaps: [], crawlDelayMs: null }
  if (config.respectRobots) {
    robots = await loadRobots(readText, seedUrl.origin, input.userAgent)
    if (robots.crawlDelayMs) pacer.raiseDelay(robots.crawlDelayMs)
  }

  const sitemap = await readSitemaps({
    seeds: [...robots.sitemaps, `${seedUrl.origin}/sitemap.xml`],
    readText,
    attempts: sitemapAttempts,
    inScope,
    limit: config.maxPages + config.maxPdfs,
    known: input.knownSitemap,
    onComplete: input.onSitemapRead,
  })
  // Mode sitemap sans sitemap exploitable : on retombe sur le crawl complet plutôt que de ne rien trouver.
  const followLinks = !sitemapMode || sitemap.count === 0
  // Crawl de secours du mode sitemap : la profondeur réglée (inutile en mode sitemap) ne doit pas brider le parcours.
  const maxDepth = sitemapMode ? 8 : config.maxDepth
  try {
    await input.onSitemap?.(sitemap.count, sitemap.source)
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
  const allowed = (item: { url: string; rawUrl: string }) => !config.respectRobots || (robots.isAllowed(item.rawUrl) && robots.isAllowed(item.url))

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
    let host: string
    try {
      host = new URL(url).hostname
    } catch {
      return
    }
    if (!inScope(host)) return
    // Mode sitemap : on ne suit que les liens vers des PDF, pas les autres pages.
    if (!followLinks && !fromSitemap && !looksLikePdf(url)) return
    if (followLinks && !fromSitemap && depth > maxDepth) return
    const rawUrl = raw.split('#')[0] ?? raw
    // Filtré ici pour ne pas consommer le quota de pages avec des URL interdites (pagination, impression…).
    if (url !== seed && !allowed({ url, rawUrl })) return
    const guessPdf = looksLikePdf(url)
    if (guessPdf) {
      if (pdfCount + queuedPdf >= config.maxPdfs) return
      queuedPdf += 1
    } else {
      if (htmlCount + queuedHtml >= config.maxPages) return
      queuedHtml += 1
    }
    seen.add(url)
    const item = { url, rawUrl, depth, parentUrl, fromSitemap, guessPdf }
    // PDF enregistré sans requête : en tête de file, il part aussitôt à l'analyse, pendant que le crawl
    // continue, au lieu d'attendre la fin des 1 000+ pages du sitemap.
    if (guessPdf && input.deferPdfFetch) queue.unshift(item)
    else queue.push(item)
  }

  for (const failed of sitemap.failed) {
    await reportError({
      url: failed.url,
      errorType: 'sitemap',
      message: sitemapFailureMessage(failed, sitemapAttempts, sitemap.usedKnown, followLinks && sitemapMode),
      httpStatus: failed.status,
    })
  }
  // En mode sitemap, la page d'accueil n'est analysée que si le sitemap la liste : le décompte colle au sitemap.
  if (followLinks) enqueue(seed, 0, null, false)
  for (const loc of sitemap.urls) enqueue(loc, 0, null, true)

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
      if (!allowed(item)) {
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

      // Un lien .pdf est enregistré sans être demandé au site : le worker d'analyse le télécharge
      // de toute façon, et relève alors le code HTTP. Une requête de moins par PDF.
      if (item.guessPdf && input.deferPdfFetch) {
        if (pdfCount >= config.maxPdfs) return
        pdfCount += 1
        await input.onPdf({ url: item.url, httpStatus: null, depth: item.depth, parentUrl: item.parentUrl, contentType: null, sizeBytes: null })
        return
      }

      await pacer.pace()
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
      if (!inScope(new URL(finalUrl).hostname)) {
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

  return {
    htmlCount,
    pdfCount,
    otherCount,
    errorCount,
    sitemapUrlCount: sitemap.count,
    sitemapSource: sitemap.source,
    usedSitemap: !followLinks,
    usedKnownSitemap: sitemap.usedKnown !== null,
  }
}
