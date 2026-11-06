import { parseSitemapLocs } from '../../lib/sitemap'
import { normalizeUrl } from '../../lib/url'
import type { TextReader } from './fetch-text'
import type { SitemapSource } from './types'

export type FailedSitemap = { url: string; status: number | null; message: string }
export type KnownSitemap = { urls: string[]; readAt: Date }

export type SitemapRead = {
  /** URL de pages et documents à analyser (lecture en ligne, complétée par la version connue si besoin). */
  urls: string[]
  /** Nombre d'URL distinctes une fois normalisées. */
  count: number
  failed: FailedSitemap[]
  source: SitemapSource
  /** Version mémorisée utilisée (sitemap en panne ou incomplet). */
  usedKnown: KnownSitemap | null
}

type Options = {
  seeds: string[]
  readText: TextReader
  attempts: number
  inScope: (hostname: string) => boolean
  /** Au-delà, on arrête de lire : inutile de recenser plus d'URL qu'on ne peut en analyser. */
  limit: number
  known?: KnownSitemap
  /** Appelé quand le sitemap a été lu en entier, pour le mémoriser. */
  onComplete?: (urls: string[]) => Promise<void>
}

/**
 * Lit le sitemap (index et sous-sitemaps, 4 en parallèle), avec nouvelles tentatives sur les erreurs passagères.
 * Une lecture complète est mémorisée ; une lecture ratée ou partielle est complétée par la dernière version connue.
 */
export async function readSitemaps(options: Options): Promise<SitemapRead> {
  const seen = new Set<string>()
  const urls: string[] = []
  const failed: FailedSitemap[] = []

  const walk = async (rawUrl: string, depth = 0): Promise<void> => {
    const url = normalizeUrl(rawUrl)
    if (!url || seen.has(url) || depth > 4 || seen.size >= 50) return
    if (!options.inScope(new URL(url).hostname)) return
    seen.add(url)
    const read = await options.readText(url, options.attempts)
    if (!read.text) {
      // Le sitemap.xml racine absent (404) est courant : seule une erreur serveur ou un sous-sitemap manquant compte.
      if (depth > 0 || (read.status ?? 500) >= 500) failed.push({ url, status: read.status, message: read.message ?? 'Réponse vide' })
      return
    }
    const parsed = parseSitemapLocs(read.text)
    if (parsed.index) {
      // Sous-sitemaps lus 4 par 4 : un sous-sitemap en panne (et ses nouvelles tentatives) ne bloque pas les autres.
      const children = [...parsed.locs]
      const worker = async () => {
        for (let loc = children.shift(); loc !== undefined; loc = children.shift()) {
          if (urls.length >= options.limit) return
          await walk(loc, depth + 1)
        }
      }
      await Promise.all(Array.from({ length: Math.min(4, children.length) }, worker))
      return
    }
    for (const loc of parsed.locs) {
      urls.push(loc)
      if (urls.length >= options.limit) return
    }
  }
  for (const seed of options.seeds) await walk(seed)

  const liveCount = urls.length
  const liveComplete = liveCount > 0 && failed.length === 0
  const known = options.known && options.known.urls.length > 0 ? options.known : null
  const usedKnown = !liveComplete && known ? known : null
  if (liveComplete) {
    try {
      await options.onComplete?.([...new Set(urls)])
    } catch {
      /* mémorisation facultative */
    }
  } else if (known) {
    const present = new Set(urls)
    for (const loc of known.urls) if (!present.has(loc)) urls.push(loc)
  }

  return {
    urls,
    count: new Set(urls.map((loc) => normalizeUrl(loc) ?? loc)).size,
    failed,
    source: liveComplete ? 'live' : liveCount > 0 ? 'partial' : usedKnown ? 'cache' : 'none',
    usedKnown,
  }
}

/** Message d'erreur d'un sitemap resté illisible, avec ce que l'analyse a fait à la place. */
export function sitemapFailureMessage(failed: FailedSitemap, attempts: number, usedKnown: KnownSitemap | null, fellBackToCrawl: boolean): string {
  const fallback = usedKnown
    ? ` : dernière version lue le ${usedKnown.readAt.toLocaleDateString('fr-FR')} à ${usedKnown.readAt.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })} utilisée (${usedKnown.urls.length} URL)`
    : fellBackToCrawl
      ? ' : crawl complet utilisé'
      : ''
  return `Sitemap illisible après ${attempts} essais (${failed.message})${fallback}`
}
