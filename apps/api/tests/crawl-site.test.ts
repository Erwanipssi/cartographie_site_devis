import { crawlConfigSchema } from '@cartographie/shared'
import { describe, expect, it } from 'vitest'
import { crawlSite } from '../src/modules/crawler/crawl-site'
import type { Fetcher, PublicFetchResult } from '../src/modules/crawler/types'
import { normalizeUrl } from '../src/lib/url'

function memoryFetcher(routes: Record<string, { status?: number; contentType: string; body: string }>): Fetcher {
  return async (url) => {
    const key = normalizeUrl(url) ?? url
    const hit = routes[key]
    if (!hit) {
      const missing: PublicFetchResult = {
        ok: true,
        status: 404,
        finalUrl: key,
        contentType: 'text/html',
        body: new Uint8Array(),
        sizeBytes: 0,
      }
      return missing
    }
    const body = new TextEncoder().encode(hit.body)
    return {
      ok: true,
      status: hit.status ?? 200,
      finalUrl: key,
      contentType: hit.contentType,
      body,
      sizeBytes: body.byteLength,
    }
  }
}

const home = `
  <a href="/a#frag">a</a>
  <a href="https://example.com/a/">a2</a>
  <a href="https://example.com/a?utm_source=nl">a3</a>
  <a href="/area-page">area</a>
  <a href="/doc.pdf">pdf</a>
  <a href="/notes.txt">notes</a>
  <a href="/blocked">non</a>
  <a href="/boom">boom</a>
  <a href="https://www.example.com/www-page">www</a>
  <a href="https://evil.example/no">hors site</a>
`

describe('crawlSite', () => {
  it('découvre les pages, les PDF, et reste dans le domaine', async () => {
    const pages: string[] = []
    const pdfs: string[] = []
    const errors: string[] = []
    const stats = await crawlSite({
      seedUrl: 'https://example.com/',
      includeSubdomains: false,
      userAgent: 'CartographieTest',
      config: crawlConfigSchema.parse({ maxDepth: 1, maxPages: 20, maxPdfs: 5, concurrency: 2, delayMs: 0 }),
      fetch: memoryFetcher({
        'https://example.com/robots.txt': {
          contentType: 'text/plain',
          body: 'User-agent: *\nDisallow: /blocked\n',
        },
        'https://example.com/sitemap.xml': {
          contentType: 'application/xml',
          body: '<urlset><url><loc>https://example.com/from-map</loc></url><url><loc>https://example.com/files/guide.pdf</loc></url></urlset>',
        },
        'https://example.com/': { contentType: 'text/html', body: home },
        'https://example.com/a': { contentType: 'text/html', body: '<p>a</p>' },
        'https://example.com/area-page': { contentType: 'text/html', body: '<p>area</p>' },
        'https://example.com/from-map': { contentType: 'text/html', body: '<p>map</p>' },
        'https://www.example.com/www-page': { contentType: 'text/html', body: '<p>www</p>' },
        'https://example.com/doc.pdf': { contentType: 'application/pdf', body: '' },
        'https://example.com/files/guide.pdf': { contentType: 'application/pdf', body: '' },
        'https://example.com/notes.txt': { contentType: 'text/plain', body: 'hello' },
        'https://example.com/boom': { status: 500, contentType: 'text/html', body: 'nope' },
      }),
      onPage: async (page) => {
        pages.push(page.url)
      },
      onPdf: async (page) => {
        pdfs.push(page.url)
      },
      onOther: async () => undefined,
      onError: async (error) => {
        errors.push(`${error.errorType}:${error.url}`)
      },
    })

    expect(pages.sort()).toEqual(
      [
        'https://example.com/',
        'https://example.com/a',
        'https://example.com/area-page',
        'https://example.com/from-map',
        'https://www.example.com/www-page',
      ].sort(),
    )
    expect(pdfs.sort()).toEqual(['https://example.com/doc.pdf', 'https://example.com/files/guide.pdf'].sort())
    expect(stats.otherCount).toBe(1)
    expect(pages).not.toContain('https://example.com/blocked')
    expect(errors.some((line) => line.startsWith('http:'))).toBe(true)
  })

  it('laisse passer les URL de sitemap au-delà de la profondeur, pas les liens', async () => {
    const pages: string[] = []
    await crawlSite({
      seedUrl: 'https://example.com/',
      includeSubdomains: false,
      userAgent: 'CartographieTest',
      config: crawlConfigSchema.parse({ maxDepth: 0, maxPages: 10, maxPdfs: 2, concurrency: 1, delayMs: 0, respectRobots: false }),
      fetch: memoryFetcher({
        'https://example.com/sitemap.xml': {
          contentType: 'application/xml',
          body: '<urlset><url><loc>https://example.com/from-map</loc></url></urlset>',
        },
        'https://example.com/': { contentType: 'text/html', body: '<a href="/only-link">lien</a>' },
        'https://example.com/from-map': { contentType: 'text/html', body: '<p>map</p>' },
        'https://example.com/only-link': { contentType: 'text/html', body: '<p>lien</p>' },
      }),
      onPage: async (page) => {
        pages.push(page.url)
      },
      onPdf: async () => undefined,
      onOther: async () => undefined,
      onError: async () => undefined,
    })
    expect(pages).toContain('https://example.com/')
    expect(pages).toContain('https://example.com/from-map')
    expect(pages).not.toContain('https://example.com/only-link')
  })

  it('s’arrête au nombre maximal de pages HTML', async () => {
    const pages: string[] = []
    await crawlSite({
      seedUrl: 'https://example.com/',
      includeSubdomains: false,
      userAgent: 'CartographieTest',
      config: crawlConfigSchema.parse({ maxDepth: 2, maxPages: 1, maxPdfs: 5, concurrency: 1, delayMs: 0, respectRobots: false }),
      fetch: memoryFetcher({
        'https://example.com/': { contentType: 'text/html', body: '<a href="/a">a</a><a href="/doc.pdf">p</a>' },
        'https://example.com/a': { contentType: 'text/html', body: '<p>a</p>' },
        'https://example.com/doc.pdf': { contentType: 'application/pdf', body: '' },
      }),
      onPage: async (page) => {
        pages.push(page.url)
      },
      onPdf: async () => undefined,
      onOther: async () => undefined,
      onError: async () => undefined,
    })
    expect(pages).toEqual(['https://example.com/'])
  })

  it('applique robots.txt à l’URL du lien, avant le tri des paramètres', async () => {
    const pages: string[] = []
    await crawlSite({
      seedUrl: 'https://example.com/',
      includeSubdomains: false,
      userAgent: 'CartographieTest',
      config: crawlConfigSchema.parse({ maxDepth: 2, maxPages: 20, concurrency: 1, delayMs: 0 }),
      fetch: memoryFetcher({
        'https://example.com/robots.txt': { contentType: 'text/plain', body: 'User-agent: *\nDisallow: /*?page=*\n' },
        // TYPO3 : ?page=…&cHash=… ; une fois normalisée, l’URL devient ?cHash=…&page=…
        'https://example.com/': { contentType: 'text/html', body: '<a href="/liste.htm?page=2&amp;cHash=abc">p2</a><a href="/liste.htm">liste</a>' },
        'https://example.com/liste.htm': { contentType: 'text/html', body: '<p>liste</p>' },
        'https://example.com/liste.htm?cHash=abc&page=2': { contentType: 'text/html', body: '<p>page 2</p>' },
      }),
      onPage: async (page) => void pages.push(page.url),
      onPdf: async () => undefined,
      onOther: async () => undefined,
      onError: async () => undefined,
    })
    expect(pages).toEqual(expect.arrayContaining(['https://example.com/', 'https://example.com/liste.htm']))
    expect(pages.some((url) => url.includes('page=2'))).toBe(false)
  })

  it('termine le crawl même si l’enregistrement en base échoue', async () => {
    const stats = await crawlSite({
      seedUrl: 'https://example.com/',
      includeSubdomains: false,
      userAgent: 'CartographieTest',
      config: crawlConfigSchema.parse({ maxDepth: 1, maxPages: 20, concurrency: 2, delayMs: 0, respectRobots: false }),
      fetch: memoryFetcher({
        'https://example.com/': { contentType: 'text/html', body: '<a href="/a">a</a><a href="/b">b</a><a href="/absente">x</a>' },
        'https://example.com/a': { contentType: 'text/html', body: '<p>a</p>' },
        'https://example.com/b': { contentType: 'text/html', body: '<p>b</p>' },
      }),
      onPage: async (page) => {
        if (page.url.endsWith('/a')) throw new Error('base saturée')
      },
      onPdf: async () => undefined,
      onOther: async () => undefined,
      onError: async () => {
        throw new Error('base saturée')
      },
    })
    expect(stats.htmlCount).toBe(3)
    expect(stats.errorCount).toBeGreaterThan(0)
  })

  it('retente un sitemap en erreur 500 intermittente', async () => {
    const pages: string[] = []
    let sitemapCalls = 0
    const base = memoryFetcher({
      'https://example.com/': { contentType: 'text/html', body: '<p>accueil</p>' },
      'https://example.com/depuis-sitemap': { contentType: 'text/html', body: '<p>ok</p>' },
    })
    await crawlSite({
      seedUrl: 'https://example.com/',
      includeSubdomains: false,
      userAgent: 'CartographieTest',
      retryDelayMs: 0,
      config: crawlConfigSchema.parse({ maxDepth: 1, maxPages: 20, concurrency: 1, delayMs: 0, respectRobots: false }),
      fetch: async (url) => {
        if (url.endsWith('/sitemap.xml')) {
          sitemapCalls += 1
          const ok = sitemapCalls >= 2
          const body = new TextEncoder().encode(ok ? '<urlset><url><loc>https://example.com/depuis-sitemap</loc></url></urlset>' : 'Oops')
          return { ok: true, status: ok ? 200 : 500, finalUrl: url, contentType: ok ? 'application/xml' : 'text/html', body, sizeBytes: body.byteLength }
        }
        return base(url)
      },
      onPage: async (page) => void pages.push(page.url),
      onPdf: async () => undefined,
      onOther: async () => undefined,
      onError: async () => undefined,
    })
    expect(sitemapCalls).toBe(2)
    expect(pages).toContain('https://example.com/depuis-sitemap')
  })

  it('mode sitemap : n’ouvre que les pages du sitemap et ne suit que les liens PDF', async () => {
    const pages: string[] = []
    const pdfs: string[] = []
    const stats = await crawlSite({
      seedUrl: 'https://example.com/',
      includeSubdomains: false,
      userAgent: 'CartographieTest',
      retryDelayMs: 0,
      config: crawlConfigSchema.parse({ mode: 'sitemap', maxDepth: 0, maxPages: 50, concurrency: 2, delayMs: 0, respectRobots: false }),
      fetch: memoryFetcher({
        'https://example.com/sitemap.xml': {
          contentType: 'application/xml',
          body: '<sitemapindex><sitemap><loc>https://example.com/sitemap.xml?sitemap=pages</loc></sitemap></sitemapindex>',
        },
        'https://example.com/sitemap.xml?sitemap=pages': {
          contentType: 'application/xml',
          body: '<urlset><url><loc>https://example.com/a</loc></url><url><loc>https://example.com/b</loc></url></urlset>',
        },
        'https://example.com/': { contentType: 'text/html', body: '<a href="/hors-sitemap">x</a>' },
        'https://example.com/a': { contentType: 'text/html', body: '<a href="/hors-sitemap">x</a><a href="/docs/rapport.pdf">pdf</a>' },
        'https://example.com/b': { contentType: 'text/html', body: '<a href="/a">a</a><a href="/img.png">img</a>' },
        'https://example.com/hors-sitemap': { contentType: 'text/html', body: '<p>non suivie</p>' },
        'https://example.com/docs/rapport.pdf': { contentType: 'application/pdf', body: '' },
      }),
      onPage: async (page) => void pages.push(page.url),
      onPdf: async (pdf) => void pdfs.push(pdf.url),
      onOther: async () => undefined,
      onError: async () => undefined,
    })
    expect(pages.sort()).toEqual(['https://example.com/a', 'https://example.com/b'])
    expect(pdfs).toEqual(['https://example.com/docs/rapport.pdf'])
    expect(stats.sitemapUrlCount).toBe(2)
    expect(stats.usedSitemap).toBe(true)
    expect(stats.otherCount).toBe(0)
  })

  it('mode sitemap : bascule sur le crawl et signale l’erreur si le sitemap reste indisponible', async () => {
    const pages: string[] = []
    const errors: Array<{ type: string; url: string }> = []
    let sitemapCalls = 0
    const base = memoryFetcher({
      'https://example.com/': { contentType: 'text/html', body: '<a href="/a">a</a>' },
      'https://example.com/a': { contentType: 'text/html', body: '<p>a</p>' },
    })
    const stats = await crawlSite({
      seedUrl: 'https://example.com/',
      includeSubdomains: false,
      userAgent: 'CartographieTest',
      retryDelayMs: 0,
      config: crawlConfigSchema.parse({ mode: 'sitemap', maxDepth: 2, maxPages: 50, concurrency: 1, delayMs: 0, respectRobots: false }),
      fetch: async (url) => {
        if (url.includes('sitemap')) {
          sitemapCalls += 1
          const body = new TextEncoder().encode('Oops')
          return { ok: true, status: 500, finalUrl: url, contentType: 'text/html', body, sizeBytes: body.byteLength }
        }
        return base(url)
      },
      onPage: async (page) => void pages.push(page.url),
      onPdf: async () => undefined,
      onOther: async () => undefined,
      onError: async (error) => void errors.push({ type: error.errorType, url: error.url }),
    })
    expect(sitemapCalls).toBe(6)
    expect(stats.usedSitemap).toBe(false)
    expect(stats.sitemapUrlCount).toBe(0)
    expect(pages.sort()).toEqual(['https://example.com/', 'https://example.com/a'])
    expect(errors).toEqual([{ type: 'sitemap', url: 'https://example.com/sitemap.xml' }])
  })

  it('mode sitemap : réutilise la dernière version connue quand le sitemap est en panne', async () => {
    const pages: string[] = []
    const errors: string[] = []
    const stats = await crawlSite({
      seedUrl: 'https://example.com/',
      includeSubdomains: false,
      userAgent: 'CartographieTest',
      retryDelayMs: 0,
      knownSitemap: { urls: ['https://example.com/a', 'https://example.com/b'], readAt: new Date('2026-11-05T13:00:00Z') },
      config: crawlConfigSchema.parse({ mode: 'sitemap', maxPages: 50, concurrency: 1, delayMs: 0, respectRobots: false }),
      fetch: async (url) => {
        if (url.includes('sitemap')) {
          const body = new TextEncoder().encode('Oops')
          return { ok: true, status: 500, finalUrl: url, contentType: 'text/html', body, sizeBytes: body.byteLength }
        }
        return memoryFetcher({
          'https://example.com/a': { contentType: 'text/html', body: '<a href="/hors-sitemap">x</a>' },
          'https://example.com/b': { contentType: 'text/html', body: '<p>b</p>' },
        })(url)
      },
      onPage: async (page) => void pages.push(page.url),
      onPdf: async () => undefined,
      onOther: async () => undefined,
      onError: async (error) => void errors.push(error.message),
    })
    expect(stats.usedKnownSitemap).toBe(true)
    expect(stats.usedSitemap).toBe(true)
    expect(stats.sitemapUrlCount).toBe(2)
    expect(pages.sort()).toEqual(['https://example.com/a', 'https://example.com/b'])
    expect(errors[0]).toMatch(/dernière version lue le .* utilisée \(2 URL\)/)
  })

  it('mode sitemap : mémorise un sitemap lu en entier', async () => {
    let saved: string[] = []
    await crawlSite({
      seedUrl: 'https://example.com/',
      includeSubdomains: false,
      userAgent: 'CartographieTest',
      retryDelayMs: 0,
      knownSitemap: { urls: ['https://example.com/ancienne'], readAt: new Date() },
      config: crawlConfigSchema.parse({ mode: 'sitemap', maxPages: 50, concurrency: 1, delayMs: 0, respectRobots: false }),
      fetch: memoryFetcher({
        'https://example.com/sitemap.xml': { contentType: 'application/xml', body: '<urlset><url><loc>https://example.com/a</loc></url></urlset>' },
        'https://example.com/a': { contentType: 'text/html', body: '<p>a</p>' },
      }),
      onSitemapRead: async (urls) => {
        saved = urls
      },
      onPage: async () => undefined,
      onPdf: async () => undefined,
      onOther: async () => undefined,
      onError: async () => undefined,
    })
    expect(saved).toEqual(['https://example.com/a'])
  })

  it('enregistre les liens .pdf sans les télécharger quand deferPdfFetch est actif', async () => {
    const fetched: string[] = []
    const pdfs: Array<{ url: string; httpStatus: number | null; parentUrl: string | null }> = []
    const base = memoryFetcher({
      'https://example.com/sitemap.xml': { contentType: 'application/xml', body: '<urlset><url><loc>https://example.com/a</loc></url></urlset>' },
      'https://example.com/a': { contentType: 'text/html', body: '<a href="/docs/rapport.pdf">pdf</a>' },
    })
    const stats = await crawlSite({
      seedUrl: 'https://example.com/',
      includeSubdomains: false,
      userAgent: 'CartographieTest',
      retryDelayMs: 0,
      deferPdfFetch: true,
      config: crawlConfigSchema.parse({ mode: 'sitemap', maxPages: 50, concurrency: 1, delayMs: 0, respectRobots: false }),
      fetch: async (url) => {
        fetched.push(url)
        return base(url)
      },
      onPage: async () => undefined,
      onPdf: async (pdf) => void pdfs.push({ url: pdf.url, httpStatus: pdf.httpStatus, parentUrl: pdf.parentUrl }),
      onOther: async () => undefined,
      onError: async () => undefined,
    })
    expect(pdfs).toEqual([{ url: 'https://example.com/docs/rapport.pdf', httpStatus: null, parentUrl: 'https://example.com/a' }])
    expect(fetched.some((url) => url.endsWith('.pdf'))).toBe(false)
    expect(stats.pdfCount).toBe(1)
  })

  it('respecte le Crawl-delay de robots.txt, plafonné à 30 s', async () => {
    const times: number[] = []
    const base = memoryFetcher({
      'https://example.com/robots.txt': { contentType: 'text/plain', body: 'User-agent: *\nCrawl-delay: 0.3\n' },
      'https://example.com/': { contentType: 'text/html', body: '<a href="/a">a</a>' },
      'https://example.com/a': { contentType: 'text/html', body: '<p>a</p>' },
    })
    await crawlSite({
      seedUrl: 'https://example.com/',
      includeSubdomains: false,
      userAgent: 'CartographieTest',
      config: crawlConfigSchema.parse({ maxDepth: 1, maxPages: 5, concurrency: 2, delayMs: 0 }),
      fetch: async (url) => {
        if (!url.endsWith('robots.txt') && !url.includes('sitemap')) times.push(Date.now())
        return base(url)
      },
      onPage: async () => undefined,
      onPdf: async () => undefined,
      onOther: async () => undefined,
      onError: async () => undefined,
    })
    expect(times).toHaveLength(2)
    expect(times[1]! - times[0]!).toBeGreaterThanOrEqual(280)
  })
})
