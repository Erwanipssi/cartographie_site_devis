import { createAnalysisSchema, ocrStatusSchema, sendMailSchema } from '@cartographie/shared'
import type { FastifyInstance } from 'fastify'
import type { ZodTypeProvider } from 'fastify-type-provider-zod'
import { z } from 'zod'
import { smtpConfigured } from '../env'
import { flagCancelled, analysisChannel } from '../lib/cancel'
import { redis } from '../lib/redis'
import { ApiError, pageWindow } from '../lib/http'
import { prisma } from '../lib/prisma'
import { mailQueue } from '../lib/queues'
import { readConfig, startAnalysis } from '../modules/analyses/service'
import { documentName, parseTriageStatuses, TRIAGE_STATUSES, triageCsv, type TriageStatus } from '../lib/pdf-triage'
import { buildSitemapXml } from '../lib/sitemap'
import { loadAnalysisExport } from '../modules/exporter/export-analysis'

const idParams = z.object({ id: z.string().min(1) })
const siteParams = z.object({ id: z.string().min(1), analysisSiteId: z.string().min(1) })
const listQuery = z.object({
  page: z.string().optional(),
  pageSize: z.string().optional(),
  q: z.string().max(200).optional(),
  sort: z.string().optional(),
  dir: z.enum(['asc', 'desc']).optional(),
  ocrStatus: ocrStatusSchema.optional(),
})
const toFixQuery = z.object({
  page: z.string().optional(),
  pageSize: z.string().optional(),
  q: z.string().max(200).optional(),
  /** Statuts séparés par des virgules (image,partial,error). Défaut : image,partial. */
  status: z.string().max(40).optional(),
  /** Limiter à un site de l'analyse (id d'AnalysisSite). */
  site: z.string().max(40).optional(),
})

export async function registerAnalyses(app: FastifyInstance): Promise<void> {
  const route = app.withTypeProvider<ZodTypeProvider>()

  route.post('/api/analyses', { schema: { body: createAnalysisSchema } }, async (request, reply) => {
    const config = readConfig(request.body.config ?? {})
    const recipientIds = request.body.recipientIds ?? []
    const emailOnComplete = request.body.emailOnComplete ?? false
    const recipients = recipientIds.length ? await prisma.recipient.findMany({ where: { id: { in: recipientIds } } }) : []
    if (emailOnComplete && recipients.length === 0) {
      throw new ApiError(400, 'Choisissez au moins un destinataire', 'RECIPIENT_REQUIRED')
    }
    const analysis = await startAnalysis({
      siteIds: request.body.siteIds,
      config,
      emailOnComplete,
      emails: recipients.map((recipient) => recipient.email),
      trigger: 'manual',
      strict: true,
    })
    return reply.code(202).send({ analysis: { id: analysis.id, status: analysis.status } })
  })

  route.get('/api/analyses', { schema: { querystring: listQuery } }, async (request) => {
    const window = pageWindow(request.query)
    const [total, analyses] = await Promise.all([
      prisma.analysis.count(),
      prisma.analysis.findMany({
        orderBy: { createdAt: 'desc' },
        skip: window.skip,
        take: window.take,
        include: { _count: { select: { sites: true } } },
      }),
    ])
    return {
      analyses: analyses.map((analysis) => ({
        id: analysis.id,
        status: analysis.status,
        trigger: analysis.trigger,
        createdAt: analysis.createdAt,
        startedAt: analysis.startedAt,
        finishedAt: analysis.finishedAt,
        emailOnComplete: analysis.emailOnComplete,
        failureReason: analysis.failureReason,
        siteCount: analysis._count.sites,
      })),
      total,
      page: window.page,
      pageSize: window.pageSize,
    }
  })

  route.get('/api/analyses/:id', { schema: { params: idParams } }, async (request) => {
    const analysis = await prisma.analysis.findUnique({ where: { id: request.params.id } })
    if (!analysis) throw new ApiError(404, 'Analyse introuvable', 'NOT_FOUND')
    const sites = await prisma.analysisSite.findMany({ where: { analysisId: analysis.id } })
    const totals = sites.reduce(
      (acc, row) => {
        acc.html += row.htmlCount
        acc.pdf += row.pdfCount
        acc.pdfText += row.pdfTextCount
        acc.pdfImage += row.pdfImageCount
        acc.pdfPartial += row.pdfPartialCount
        acc.pdfError += row.pdfErrorCount
        acc.errors += row.errorCount
        acc.sitemap += row.sitemapUrlCount ?? 0
        return acc
      },
      { html: 0, pdf: 0, pdfText: 0, pdfImage: 0, pdfPartial: 0, pdfError: 0, errors: 0, sitemap: 0 },
    )
    return { analysis, totals }
  })

  route.post('/api/analyses/:id/cancel', { schema: { params: idParams } }, async (request) => {
    const analysis = await prisma.analysis.findUnique({ where: { id: request.params.id } })
    if (!analysis) throw new ApiError(404, 'Analyse introuvable', 'NOT_FOUND')
    if (analysis.status !== 'running' && analysis.status !== 'pending') {
      throw new ApiError(409, 'Cette analyse n’est plus en cours', 'NOT_RUNNING')
    }
    await flagCancelled(analysis.id)
    await prisma.analysis.update({ where: { id: analysis.id }, data: { status: 'cancelled', finishedAt: new Date() } })
    await prisma.analysisSite.updateMany({
      where: { analysisId: analysis.id, status: { in: ['pending', 'crawling', 'analyzing_pdfs'] } },
      data: { status: 'cancelled', discoveryDone: true, finishedAt: new Date() },
    })
    await redis.publish(analysisChannel(analysis.id), JSON.stringify({ type: 'analysis.failed', analysisId: analysis.id, status: 'cancelled' }))
    return { ok: true }
  })

  route.get('/api/analyses/:id/sites', { schema: { params: idParams } }, async (request) => {
    const sites = await prisma.analysisSite.findMany({
      where: { analysisId: request.params.id },
      include: { site: true },
      orderBy: { site: { hostname: 'asc' } },
    })
    return { sites }
  })

  route.get('/api/analyses/:id/sites/:analysisSiteId/pages', { schema: { params: siteParams, querystring: listQuery } }, async (request) => {
    await assertSite(request.params.id, request.params.analysisSiteId)
    const window = pageWindow(request.query)
    const sortKey = ['url', 'httpStatus', 'depth', 'sizeBytes'].includes(request.query.sort ?? '') ? (request.query.sort as string) : 'url'
    const where = {
      analysisSiteId: request.params.analysisSiteId,
      ...(request.query.q ? { url: { contains: request.query.q, mode: 'insensitive' as const } } : {}),
    }
    const [total, items] = await Promise.all([
      prisma.page.count({ where }),
      prisma.page.findMany({
        where,
        orderBy: { [sortKey]: request.query.dir ?? 'asc' },
        skip: window.skip,
        take: window.take,
      }),
    ])
    return { items, total, page: window.page, pageSize: window.pageSize }
  })

  route.get('/api/analyses/:id/sites/:analysisSiteId/pdfs', { schema: { params: siteParams, querystring: listQuery } }, async (request) => {
    await assertSite(request.params.id, request.params.analysisSiteId)
    const window = pageWindow(request.query)
    const sortKey = ['url', 'ocrStatus', 'pageCount', 'sizeBytes'].includes(request.query.sort ?? '') ? (request.query.sort as string) : 'url'
    const where = {
      analysisSiteId: request.params.analysisSiteId,
      ...(request.query.ocrStatus ? { ocrStatus: request.query.ocrStatus } : {}),
      ...(request.query.q ? { url: { contains: request.query.q, mode: 'insensitive' as const } } : {}),
    }
    const [total, items] = await Promise.all([
      prisma.pdfDocument.count({ where }),
      prisma.pdfDocument.findMany({
        where,
        orderBy: { [sortKey]: request.query.dir ?? 'asc' },
        skip: window.skip,
        take: window.take,
      }),
    ])
    return { items, total, page: window.page, pageSize: window.pageSize }
  })

  route.get('/api/analyses/:id/sites/:analysisSiteId/errors', { schema: { params: siteParams, querystring: listQuery } }, async (request) => {
    await assertSite(request.params.id, request.params.analysisSiteId)
    const window = pageWindow(request.query)
    const where = {
      analysisSiteId: request.params.analysisSiteId,
      ...(request.query.q ? { url: { contains: request.query.q, mode: 'insensitive' as const } } : {}),
    }
    const [total, items] = await Promise.all([
      prisma.crawlError.count({ where }),
      prisma.crawlError.findMany({ where, orderBy: { createdAt: 'desc' }, skip: window.skip, take: window.take }),
    ])
    return { items, total, page: window.page, pageSize: window.pageSize }
  })

  // PDF à traiter : tous les sites de l'analyse, du plus urgent (aucune page lisible) au moins urgent.
  const toFixWhere = async (analysisId: string, query: z.infer<typeof toFixQuery>) => {
    const analysis = await prisma.analysis.findUnique({ where: { id: analysisId }, select: { id: true } })
    if (!analysis) throw new ApiError(404, 'Analyse introuvable', 'NOT_FOUND')
    return {
      analysisSite: { analysisId },
      ...(query.site ? { analysisSiteId: query.site } : {}),
      ...(query.q ? { url: { contains: query.q, mode: 'insensitive' as const } } : {}),
    }
  }
  const toFixOrder = [{ ocrStatus: 'asc' as const }, { pagesWithoutText: { sort: 'desc' as const, nulls: 'last' as const } }, { url: 'asc' as const }]
  const toFixSelect = {
    url: true,
    ocrStatus: true,
    pageCount: true,
    pagesWithoutText: true,
    sizeBytes: true,
    parentUrl: true,
    errorMessage: true,
    analysisSite: { select: { id: true, site: { select: { hostname: true } } } },
  } as const

  route.get('/api/analyses/:id/pdfs-to-fix', { schema: { params: idParams, querystring: toFixQuery } }, async (request) => {
    const base = await toFixWhere(request.params.id, request.query)
    const statuses = parseTriageStatuses(request.query.status)
    const window = pageWindow(request.query)
    const where = { ...base, ocrStatus: { in: statuses } }
    const [total, rows, grouped] = await Promise.all([
      prisma.pdfDocument.count({ where }),
      prisma.pdfDocument.findMany({ where, orderBy: toFixOrder, skip: window.skip, take: window.take, select: toFixSelect }),
      prisma.pdfDocument.groupBy({ by: ['ocrStatus'], where: { ...base, ocrStatus: { in: [...TRIAGE_STATUSES] } }, _count: { _all: true } }),
    ])
    const counts = Object.fromEntries(TRIAGE_STATUSES.map((status) => [status, grouped.find((group) => group.ocrStatus === status)?._count._all ?? 0]))
    const items = rows.map(({ analysisSite, ...pdf }) => ({
      ...pdf,
      name: documentName(pdf.url),
      site: analysisSite.site.hostname,
      analysisSiteId: analysisSite.id,
    }))
    return { items, total, counts, page: window.page, pageSize: window.pageSize }
  })

  route.get('/api/analyses/:id/pdfs-to-fix.csv', { schema: { params: idParams, querystring: toFixQuery } }, async (request, reply) => {
    const base = await toFixWhere(request.params.id, request.query)
    const rows = await prisma.pdfDocument.findMany({
      where: { ...base, ocrStatus: { in: parseTriageStatuses(request.query.status) } },
      orderBy: toFixOrder,
      select: toFixSelect,
    })
    const csv = triageCsv(
      rows.map(({ analysisSite, ...pdf }) => ({ ...pdf, ocrStatus: pdf.ocrStatus as TriageStatus, site: analysisSite.site.hostname })),
    )
    return reply
      .header('Content-Type', 'text/csv; charset=utf-8')
      .header('Content-Disposition', `attachment; filename="pdf-a-traiter-${request.params.id.slice(0, 8)}.csv"`)
      .send(csv)
  })

  route.get('/api/analyses/:id/export', { schema: { params: idParams } }, async (request, reply) => {
    const analysis = await prisma.analysis.findUnique({ where: { id: request.params.id } })
    if (!analysis) throw new ApiError(404, 'Analyse introuvable', 'NOT_FOUND')
    const buffer = await loadAnalysisExport(analysis.id)
    return reply
      .header('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
      .header('Content-Disposition', `attachment; filename="cartographie-${analysis.id.slice(0, 8)}.xlsx"`)
      .send(buffer)
  })

  route.get('/api/analyses/:id/sites/:analysisSiteId/sitemap.xml', { schema: { params: siteParams } }, async (request, reply) => {
    const row = await prisma.analysisSite.findFirst({
      where: { id: request.params.analysisSiteId, analysisId: request.params.id },
      include: { site: true },
    })
    if (!row) throw new ApiError(404, 'Site introuvable dans cette analyse', 'NOT_FOUND')
    const ok = { analysisSiteId: row.id, httpStatus: { gte: 200, lt: 300 } }
    const [pages, pdfs] = await Promise.all([
      prisma.page.findMany({ where: ok, select: { url: true } }),
      prisma.pdfDocument.findMany({ where: ok, select: { url: true } }),
    ])
    const xml = buildSitemapXml([...pages, ...pdfs])
    return reply
      .header('Content-Type', 'application/xml; charset=utf-8')
      .header('Content-Disposition', `attachment; filename="sitemap-${row.site.hostname}.xml"`)
      .send(xml)
  })

  route.post('/api/analyses/:id/email', { schema: { params: idParams, body: sendMailSchema } }, async (request) => {
    if (!smtpConfigured) throw new ApiError(503, 'SMTP non configuré', 'SMTP_UNAVAILABLE')
    const analysis = await prisma.analysis.findUnique({ where: { id: request.params.id } })
    if (!analysis) throw new ApiError(404, 'Analyse introuvable', 'NOT_FOUND')
    const recipients = await prisma.recipient.findMany({ where: { id: { in: request.body.recipientIds } } })
    if (recipients.length === 0) throw new ApiError(400, 'Aucun destinataire', 'RECIPIENT_REQUIRED')
    await mailQueue.add(
      'send-report',
      { analysisId: analysis.id, emails: recipients.map((recipient) => recipient.email), trigger: 'manual' },
      { attempts: 2, backoff: { type: 'exponential', delay: 5000 }, removeOnComplete: 1000, removeOnFail: 1000 },
    )
    return { queued: true }
  })

  app.get('/api/analyses/:id/events', async (request, reply) => {
    const params = idParams.safeParse(request.params)
    if (!params.success) throw new ApiError(400, 'Identifiant invalide')
    const analysis = await prisma.analysis.findUnique({ where: { id: params.data.id } })
    if (!analysis) throw new ApiError(404, 'Analyse introuvable', 'NOT_FOUND')
    reply.hijack()
    reply.raw.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    })
    reply.raw.write(`data: ${JSON.stringify({ type: 'connected', analysisId: analysis.id })}\n\n`)
    const sub = redis.duplicate()
    await sub.subscribe(analysisChannel(analysis.id))
    const onMessage = (_channel: string, message: string) => {
      reply.raw.write(`data: ${message}\n\n`)
    }
    sub.on('message', onMessage)
    const heartbeat = setInterval(() => reply.raw.write(': ping\n\n'), 15_000)
    request.raw.on('close', () => {
      clearInterval(heartbeat)
      sub.off('message', onMessage)
      void sub.unsubscribe().finally(() => sub.quit())
    })
  })
}

async function assertSite(analysisId: string, analysisSiteId: string): Promise<void> {
  const row = await prisma.analysisSite.findFirst({ where: { id: analysisSiteId, analysisId } })
  if (!row) throw new ApiError(404, 'Site d’analyse introuvable', 'NOT_FOUND')
}
