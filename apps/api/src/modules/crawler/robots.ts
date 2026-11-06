import robotsParser from 'robots-parser'
import type { TextReader } from './fetch-text'

/** Crawl-delay plafonné : une valeur aberrante ne doit pas figer l'analyse. */
export const MAX_CRAWL_DELAY_MS = 30_000

export type RobotsRules = {
  isAllowed: (url: string) => boolean
  /** Sitemaps déclarés par la directive « Sitemap: ». */
  sitemaps: string[]
  /** Délai demandé entre deux requêtes, en ms (null si aucun). */
  crawlDelayMs: number | null
}

const OPEN: RobotsRules = { isAllowed: () => true, sitemaps: [], crawlDelayMs: null }

/** Lit robots.txt ; absent ou illisible, tout est autorisé. */
export async function loadRobots(readText: TextReader, origin: string, userAgent: string): Promise<RobotsRules> {
  const body = (await readText(`${origin}/robots.txt`)).text
  if (!body) return OPEN
  const robots = robotsParser(`${origin}/robots.txt`, body)
  const crawlDelay = robots.getCrawlDelay(userAgent)
  return {
    isAllowed: (url) => robots.isAllowed(url, userAgent) !== false,
    sitemaps: robots.getSitemaps(),
    crawlDelayMs:
      crawlDelay && Number.isFinite(crawlDelay) && crawlDelay > 0 ? Math.min(Math.round(crawlDelay * 1000), MAX_CRAWL_DELAY_MS) : null,
  }
}
