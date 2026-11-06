import type { FastifyInstance } from 'fastify'
import type { ZodTypeProvider } from 'fastify-type-provider-zod'
import { z } from 'zod'
import { comparePages, comparePdfs } from '../lib/evolution'
import { ApiError } from '../lib/http'
import { documentName } from '../lib/pdf-triage'
import { prisma } from '../lib/prisma'
import { readConfig } from '../modules/analyses/service'

/** Au-delà, les listes sont tronquées (le total reste exact) : la page doit rester lisible. */
const LIST_LIMIT = 300

const pdfFields = {
  url: true,
  ocrStatus: true,
  tagged: true,
  titleStatus: true,
  lang: true,
  pageCount: true,
  pagesWithoutText: true,
  parentUrl: true,
} as const

type Run = {
  id: string
  analysisId: string
  date: Date
  mode: string
  htmlCount: number
  pdfCount: number
  pdfTextCount: number
  pdfImageCount: number
  pdfPartialCount: number
  pdfErrorCount: number
  errorCount: number
  sitemapUrlCount: number | null
}

/** Analyses terminées d'un site, de la plus récente à la plus ancienne. */
async function completedRuns(siteId: string): Promise<Run[]> {
  const rows = await prisma.analysisSite.findMany({
    where: { siteId, status: 'completed' },
    include: { analysis: { select: { id: true, createdAt: true, config: true } } },
    orderBy: { analysis: { createdAt: 'desc' } },
  })
  return rows.map((row) => ({
    id: row.id,
    analysisId: row.analysisId,
    date: row.analysis.createdAt,
    mode: readConfig(row.analysis.config).mode,
    htmlCount: row.htmlCount,
    pdfCount: row.pdfCount,
    pdfTextCount: row.pdfTextCount,
    pdfImageCount: row.pdfImageCount,
    pdfPartialCount: row.pdfPartialCount,
    pdfErrorCount: row.pdfErrorCount,
    errorCount: row.errorCount,
    sitemapUrlCount: row.sitemapUrlCount,
  }))
}

/** Compte des PDF contrôlés et conformes (balisés, titrés, langue déclarée) d'une analyse de site. */
async function accessibility(analysisSiteId: string): Promise<{ checked: number; conform: number }> {
  const checked = { analysisSiteId, tagged: { not: null } }
  const [total, conform] = await Promise.all([
    prisma.pdfDocument.count({ where: checked }),
    prisma.pdfDocument.count({ where: { ...checked, tagged: true, titleStatus: 'ok', lang: { not: null } } }),
  ])
  return { checked: total, conform }
}

/** La comparaison par défaut : l'analyse précédente faite dans le même mode (sitemap ou crawl). */
function defaultPrevious(current: Run, earlier: Run[]): Run | undefined {
  return earlier.find((run) => run.mode === current.mode) ?? earlier[0]
}

const cap = <T>(list: T[]) => ({ total: list.length, items: list.slice(0, LIST_LIMIT) })

export async function registerEvolution(app: FastifyInstance): Promise<void> {
  const route = app.withTypeProvider<ZodTypeProvider>()

  route.get(
    '/api/analyses/:id/sites/:analysisSiteId/evolution',
    {
      schema: {
        params: z.object({ id: z.string().min(1), analysisSiteId: z.string().min(1) }),
        querystring: z.object({ previous: z.string().max(40).optional() }),
      },
    },
    async (request) => {
      const row = await prisma.analysisSite.findFirst({
        where: { id: request.params.analysisSiteId, analysisId: request.params.id },
        include: { site: { select: { hostname: true } } },
      })
      if (!row) throw new ApiError(404, 'Site introuvable dans cette analyse', 'NOT_FOUND')
      const runs = await completedRuns(row.siteId)
      const current = runs.find((run) => run.id === row.id)
      if (!current) throw new ApiError(409, 'Cette analyse n’est pas terminée', 'NOT_COMPLETED')
      const earlier = runs.filter((run) => run.date < current.date)
      const previous = request.query.previous ? earlier.find((run) => run.id === request.query.previous) : defaultPrevious(current, earlier)
      const base = { site: row.site.hostname, current, candidates: earlier }
      if (!previous) return { ...base, previous: null }

      const [pdfsBefore, pdfsNow, pagesBefore, pagesNow, a11yBefore, a11yNow] = await Promise.all([
        prisma.pdfDocument.findMany({ where: { analysisSiteId: previous.id }, select: pdfFields }),
        prisma.pdfDocument.findMany({ where: { analysisSiteId: current.id }, select: pdfFields }),
        prisma.page.findMany({ where: { analysisSiteId: previous.id }, select: { url: true } }),
        prisma.page.findMany({ where: { analysisSiteId: current.id }, select: { url: true } }),
        accessibility(previous.id),
        accessibility(current.id),
      ])
      const pdfs = comparePdfs(pdfsBefore, pdfsNow)
      const pages = comparePages(
        pagesBefore.map((page) => page.url),
        pagesNow.map((page) => page.url),
      )
      const named = <T extends { url: string }>(list: T[]) => list.map((item) => ({ ...item, name: documentName(item.url) }))
      return {
        ...base,
        previous,
        accessibility: { before: a11yBefore, now: a11yNow },
        pdfs: {
          added: cap(named(pdfs.added)),
          removed: cap(named(pdfs.removed)),
          textFixed: cap(named(pdfs.textFixed)),
          textRegressed: cap(named(pdfs.textRegressed)),
          a11yImproved: cap(named(pdfs.a11yImproved)),
          a11yRegressed: cap(named(pdfs.a11yRegressed)),
        },
        pages: { added: cap(pages.added), removed: cap(pages.removed) },
      }
    },
  )

  // Vue d'ensemble : la dernière analyse terminée de chaque site, comparée à la précédente du même mode.
  route.get('/api/overview', async () => {
    const sites = await prisma.site.findMany({ where: { archivedAt: null }, orderBy: { hostname: 'asc' } })
    const rows = await Promise.all(
      sites.map(async (site) => {
        const runs = await completedRuns(site.id)
        const latest = runs[0]
        if (!latest) return { siteId: site.id, hostname: site.hostname, latest: null, previous: null }
        const previous = defaultPrevious(latest, runs.slice(1)) ?? null
        const [a11yLatest, a11yPrevious] = await Promise.all([accessibility(latest.id), previous ? accessibility(previous.id) : null])
        return {
          siteId: site.id,
          hostname: site.hostname,
          latest: { ...latest, accessibility: a11yLatest },
          previous: previous ? { ...previous, accessibility: a11yPrevious } : null,
        }
      }),
    )
    return { sites: rows }
  })
}
