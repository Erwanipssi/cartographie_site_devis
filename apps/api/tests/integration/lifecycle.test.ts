/**
 * Tests d'intégration : vraie base PostgreSQL (schéma jetable) et vrai Redis, ceux de `pnpm start`.
 * Ignorés si la base ne répond pas, pour que `pnpm test` reste utilisable sans Docker.
 */
import { randomBytes } from 'node:crypto'
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { config as loadEnv } from 'dotenv'
import { PrismaClient } from '@prisma/client'
import { crawlConfigSchema } from '@cartographie/shared'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { Fetcher } from '../../src/modules/crawler/types'

loadEnv({ path: join(__dirname, '..', '..', '.env') })
const baseUrl = process.env.DATABASE_URL ?? ''
const schema = `it_${randomBytes(4).toString('hex')}`
const testUrl = `${baseUrl}${baseUrl.includes('?') ? '&' : '?'}schema=${schema}`

async function databaseReachable(): Promise<boolean> {
  if (!baseUrl) return false
  const probe = new PrismaClient({ datasourceUrl: baseUrl })
  try {
    await probe.$queryRaw`SELECT 1`
    return true
  } catch {
    return false
  } finally {
    await probe.$disconnect()
  }
}

const reachable = await databaseReachable()

/** Applique les migrations du projet, instruction par instruction, dans le schéma de test. */
async function migrate(client: PrismaClient): Promise<void> {
  await client.$executeRawUnsafe(`CREATE SCHEMA "${schema}"`)
  const dir = join(__dirname, '..', '..', 'prisma', 'migrations')
  for (const name of readdirSync(dir).filter((entry) => /^\d+_/.test(entry)).sort()) {
    const sql = readFileSync(join(dir, name, 'migration.sql'), 'utf8')
    const statements = sql
      .split(/;\s*(?:\r?\n|$)/)
      .map((statement) => statement.replace(/^\s*--.*$/gm, '').trim())
      .filter(Boolean)
    for (const statement of statements) await client.$executeRawUnsafe(statement)
  }
}

function memoryFetcher(routes: Record<string, { status?: number; contentType: string; body: string }>): Fetcher {
  return async (url) => {
    const hit = routes[url]
    const body = new TextEncoder().encode(hit?.body ?? '')
    return { ok: true, status: hit?.status ?? (hit ? 200 : 404), finalUrl: url, contentType: hit?.contentType ?? 'text/html', body, sizeBytes: body.byteLength }
  }
}

describe.skipIf(!reachable)('cycle de vie d’une analyse (base réelle)', () => {
  let prisma: PrismaClient
  let lifecycle: typeof import('../../src/modules/analyses/lifecycle')
  let watchdog: typeof import('../../src/modules/analyses/watchdog')
  let crawler: typeof import('../../src/modules/crawler/crawl-site')
  let queues: typeof import('../../src/lib/queues')
  let redis: typeof import('../../src/lib/redis')
  const pdfJobIds: string[] = []

  beforeAll(async () => {
    // Le client Prisma de l'application lit DATABASE_URL à l'import : on le pointe sur le schéma de test d'abord.
    process.env.DATABASE_URL = testUrl
    const admin = new PrismaClient({ datasourceUrl: testUrl })
    await migrate(admin)
    await admin.$disconnect()
    ;({ prisma } = await import('../../src/lib/prisma'))
    lifecycle = await import('../../src/modules/analyses/lifecycle')
    watchdog = await import('../../src/modules/analyses/watchdog')
    crawler = await import('../../src/modules/crawler/crawl-site')
    queues = await import('../../src/lib/queues')
    redis = await import('../../src/lib/redis')
  })

  afterAll(async () => {
    if (!prisma) return
    for (const id of pdfJobIds) await queues.pdfQueue.remove(id).catch(() => undefined)
    await prisma.$executeRawUnsafe(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`)
    await prisma.$disconnect()
    await queues.closeQueues()
    redis.redis.disconnect()
  })

  async function newAnalysis(hostname: string) {
    const site = await prisma.site.create({
      data: { inputUrl: `https://${hostname}/`, normalizedUrl: `https://${hostname}/`, origin: `https://${hostname}`, hostname },
    })
    const analysis = await prisma.analysis.create({
      data: { status: 'running', config: {}, startedAt: new Date(), sites: { create: [{ siteId: site.id }] } },
      include: { sites: true },
    })
    return { site, analysis, analysisSite: analysis.sites[0]! }
  }

  it('déroule une analyse en mode sitemap jusqu’à son terme, compteurs justes', async () => {
    const { analysis, analysisSite } = await newAnalysis('cycle.test')
    const ids = { analysisId: analysis.id, analysisSiteId: analysisSite.id }
    await prisma.analysisSite.update({ where: { id: analysisSite.id }, data: { status: 'crawling', startedAt: new Date() } })

    await crawler.crawlSite({
      seedUrl: 'https://cycle.test/',
      includeSubdomains: false,
      userAgent: 'CartographieTest',
      retryDelayMs: 0,
      deferPdfFetch: true,
      // Une requête à la fois : la page retenue comme « publiée sur » est alors toujours la première du sitemap.
      config: crawlConfigSchema.parse({ mode: 'sitemap', maxPages: 50, concurrency: 1, delayMs: 0, respectRobots: false }),
      fetch: memoryFetcher({
        'https://cycle.test/sitemap.xml': {
          contentType: 'application/xml',
          body: '<urlset><url><loc>https://cycle.test/a</loc></url><url><loc>https://cycle.test/b</loc></url><url><loc>https://cycle.test/absente</loc></url></urlset>',
        },
        'https://cycle.test/a': { contentType: 'text/html', body: '<a href="/docs/un.pdf">1</a><a href="/docs/deux.pdf">2</a>' },
        'https://cycle.test/b': { contentType: 'text/html', body: '<a href="/docs/un.pdf">1 encore</a>' },
      }),
      onPage: (page) => lifecycle.recordPage(ids.analysisId, ids.analysisSiteId, page),
      onPdf: (pdf) => lifecycle.recordPdf(ids.analysisId, ids.analysisSiteId, pdf),
      onOther: () => lifecycle.recordOther(ids.analysisId, ids.analysisSiteId),
      onError: (error) => lifecycle.recordError(ids.analysisId, ids.analysisSiteId, error),
      onSitemap: (count, source) => lifecycle.recordSitemap(ids.analysisId, ids.analysisSiteId, count, source),
    })
    await lifecycle.finishDiscovery(analysisSite.id)

    let row = await prisma.analysisSite.findUniqueOrThrow({ where: { id: analysisSite.id } })
    expect(row).toMatchObject({ status: 'analyzing_pdfs', htmlCount: 2, pdfCount: 2, pendingPdfCount: 2, errorCount: 1, sitemapUrlCount: 3, sitemapSource: 'live' })

    const pdfs = await prisma.pdfDocument.findMany({ where: { analysisSiteId: analysisSite.id }, orderBy: { url: 'asc' } })
    pdfJobIds.push(...pdfs.map((pdf) => pdf.id))
    expect(pdfs.map((pdf) => [pdf.url, pdf.httpStatus, pdf.parentUrl])).toEqual([
      ['https://cycle.test/docs/deux.pdf', null, 'https://cycle.test/a'],
      ['https://cycle.test/docs/un.pdf', null, 'https://cycle.test/a'],
    ])

    for (const [index, pdf] of pdfs.entries()) {
      await lifecycle.onPdfAnalyzed({
        ...ids,
        pdfId: pdf.id,
        ocrStatus: index === 0 ? 'text' : 'image',
        errorMessage: null,
        pageCount: 3,
        pagesWithText: index === 0 ? 3 : 0,
        pagesWithoutText: index === 0 ? 0 : 3,
        sizeBytes: 1000,
        httpStatus: 200,
        contentType: 'application/pdf',
      })
    }
    row = await prisma.analysisSite.findUniqueOrThrow({ where: { id: analysisSite.id } })
    expect(row).toMatchObject({ status: 'completed', pendingPdfCount: 0, pdfTextCount: 1, pdfImageCount: 1 })
    const done = await prisma.analysis.findUniqueOrThrow({ where: { id: analysis.id } })
    expect(done.status).toBe('completed')
  })

  it('n’enregistre et ne compte qu’une fois une page déjà vue', async () => {
    const { analysis, analysisSite } = await newAnalysis('doublon.test')
    const page = { url: 'https://doublon.test/a', httpStatus: 200, depth: 0, parentUrl: null, contentType: 'text/html', sizeBytes: 10 }
    await lifecycle.recordPage(analysis.id, analysisSite.id, page)
    await lifecycle.recordPage(analysis.id, analysisSite.id, page)
    const row = await prisma.analysisSite.findUniqueOrThrow({ where: { id: analysisSite.id } })
    expect(row.htmlCount).toBe(1)
  })

  it('surveillance : un crawl dont le job a disparu passe en échec, avec la raison', async () => {
    const { analysis, analysisSite } = await newAnalysis('fige.test')
    const longAgo = new Date(Date.now() - watchdog.WATCHDOG_GRACE_MS - 60_000)
    await prisma.analysisSite.update({ where: { id: analysisSite.id }, data: { status: 'crawling', startedAt: longAgo } })
    const noJobs = { crawl: { getJob: async () => undefined }, pdf: { getJob: async () => undefined } }

    const result = await watchdog.sweepStalledWork(noJobs as never)
    expect(result.failedSites).toContain(analysisSite.id)
    const row = await prisma.analysisSite.findUniqueOrThrow({ where: { id: analysisSite.id } })
    expect(row.status).toBe('failed')
    expect(row.errorMessage).toMatch(/disparu de la file/)
    expect((await prisma.analysis.findUniqueOrThrow({ where: { id: analysis.id } })).status).toBe('failed')
  })

  it('surveillance : épargne un crawl récent ou encore vivant', async () => {
    const { analysisSite } = await newAnalysis('vivant.test')
    const longAgo = new Date(Date.now() - watchdog.WATCHDOG_GRACE_MS - 60_000)
    await prisma.analysisSite.update({ where: { id: analysisSite.id }, data: { status: 'crawling', startedAt: longAgo } })
    const active = { getJob: async () => ({ getState: async () => 'active' }) }
    await watchdog.sweepStalledWork({ crawl: active, pdf: active } as never)
    expect((await prisma.analysisSite.findUniqueOrThrow({ where: { id: analysisSite.id } })).status).toBe('crawling')
  })

  it('surveillance : clôt un PDF orphelin pour que le site se termine', async () => {
    const { analysis, analysisSite } = await newAnalysis('orphelin.test')
    const longAgo = new Date(Date.now() - watchdog.WATCHDOG_GRACE_MS - 60_000)
    await prisma.analysisSite.update({
      where: { id: analysisSite.id },
      data: { status: 'analyzing_pdfs', discoveryDone: true, startedAt: longAgo, pdfCount: 1, pendingPdfCount: 1 },
    })
    await prisma.pdfDocument.create({ data: { analysisSiteId: analysisSite.id, url: 'https://orphelin.test/x.pdf', depth: 1, ocrStatus: 'pending' } })
    const noJobs = { crawl: { getJob: async () => undefined }, pdf: { getJob: async () => undefined } }

    const result = await watchdog.sweepStalledWork(noJobs as never)
    expect(result.closedPdfs).toBe(1)
    const row = await prisma.analysisSite.findUniqueOrThrow({ where: { id: analysisSite.id } })
    expect(row).toMatchObject({ status: 'completed', pendingPdfCount: 0, pdfErrorCount: 1 })
    expect((await prisma.analysis.findUniqueOrThrow({ where: { id: analysis.id } })).status).toBe('completed')
  })
})
