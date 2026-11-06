import type { CrawlConfig } from '@cartographie/shared'

export type PublicFetchResult =
  | {
      ok: true
      status: number
      finalUrl: string
      contentType: string | null
      body: Uint8Array
      sizeBytes: number | null
    }
  | {
      ok: false
      status?: number
      finalUrl: string
      errorType: 'timeout' | 'network' | 'ssrf' | 'too_large'
      message: string
    }

export type Fetcher = (url: string) => Promise<PublicFetchResult>

export type DiscoveredPage = {
  url: string
  /** null pour un PDF enregistré sans requête : le code HTTP arrive avec l’analyse. */
  httpStatus: number | null
  depth: number
  parentUrl: string | null
  contentType: string | null
  sizeBytes: number | null
}

export type DiscoveredError = {
  url: string
  errorType: string
  message: string
  httpStatus: number | null
}

export type CrawlHooks = {
  fetch: Fetcher
  shouldCancel?: () => Promise<boolean>
  onPage: (page: DiscoveredPage) => Promise<void>
  onPdf: (page: DiscoveredPage) => Promise<void>
  onOther: () => Promise<void>
  onError: (error: DiscoveredError) => Promise<void>
  /** Sitemap lu lors d’une analyse précédente, utilisé si le sitemap est indisponible ou incomplet. */
  knownSitemap?: { urls: string[]; readAt: Date }
  /** Appelé quand le sitemap a été lu en entier, pour le mémoriser. */
  onSitemapRead?: (urls: string[]) => Promise<void>
  /** Appelé une fois le sitemap lu, avec le nombre d’URL distinctes trouvées. */
  onSitemap?: (urlCount: number) => Promise<void>
}

export type CrawlStats = {
  htmlCount: number
  pdfCount: number
  otherCount: number
  errorCount: number
  /** URL distinctes lues dans le sitemap (0 si absent ou illisible). */
  sitemapUrlCount: number
  /** Vrai si l’analyse s’est limitée au sitemap (+ PDF liés). */
  usedSitemap: boolean
  /** Vrai si le sitemap en ligne a échoué et que la dernière version connue a servi. */
  usedKnownSitemap: boolean
}

export type CrawlInput = CrawlHooks & {
  seedUrl: string
  includeSubdomains: boolean
  config: CrawlConfig
  userAgent: string
  /** Attente avant de retenter un sitemap en erreur serveur (ms, multipliée par la tentative). */
  retryDelayMs?: number
  /** Enregistre les liens .pdf sans les télécharger (le worker PDF s’en charge). */
  deferPdfFetch?: boolean
}
