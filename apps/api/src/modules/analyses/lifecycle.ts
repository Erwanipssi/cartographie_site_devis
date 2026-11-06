import { Prisma, type OcrStatus, type SiteRunStatus } from '@prisma/client'
import { analysisChannel } from '../../lib/cancel'
import { logger } from '../../lib/logger'
import { prisma } from '../../lib/prisma'
import { mailQueue, pdfQueue } from '../../lib/queues'
import { redis } from '../../lib/redis'
import type { DiscoveredError, DiscoveredPage } from '../crawler/types'

type SiteLock = {
  id: string
  status: SiteRunStatus
  discoveryDone: boolean
  pendingPdfCount: number
  analysisId: string
  startedAt: Date | null
}

const counterByStatus = {
  text: 'pdfTextCount',
  image: 'pdfImageCount',
  partial: 'pdfPartialCount',
  error: 'pdfErrorCount',
} as const

const lastPublish = new Map<string, number>()

function isUnique(error: unknown): boolean {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002'
}

function asDate(value: Date | string | null): Date | null {
  if (!value) return null
  return value instanceof Date ? value : new Date(value)
}

export async function publishSite(analysisId: string, analysisSiteId: string, type: string, force = false): Promise<void> {
  const now = Date.now()
  const previous = lastPublish.get(analysisSiteId) ?? 0
  if (!force && now - previous < 400) return
  lastPublish.set(analysisSiteId, now)
  const row = await prisma.analysisSite.findUnique({ where: { id: analysisSiteId } })
  if (!row) return
  await redis.publish(
    analysisChannel(analysisId),
    JSON.stringify({
      type,
      analysisId,
      analysisSiteId,
      status: row.status,
      htmlCount: row.htmlCount,
      pdfCount: row.pdfCount,
      pdfTextCount: row.pdfTextCount,
      pdfImageCount: row.pdfImageCount,
      pdfPartialCount: row.pdfPartialCount,
      pdfErrorCount: row.pdfErrorCount,
      errorCount: row.errorCount,
      pendingPdfCount: row.pendingPdfCount,
      sitemapUrlCount: row.sitemapUrlCount,
    }),
  )
}

export async function recordPage(analysisId: string, analysisSiteId: string, page: DiscoveredPage): Promise<void> {
  try {
    await prisma.page.create({
      data: {
        analysisSiteId,
        url: page.url,
        httpStatus: page.httpStatus,
        depth: page.depth,
        parentUrl: page.parentUrl,
        contentType: page.contentType,
        sizeBytes: page.sizeBytes,
      },
    })
  } catch (error) {
    if (isUnique(error)) return
    throw error
  }
  await prisma.analysisSite.update({ where: { id: analysisSiteId }, data: { htmlCount: { increment: 1 } } })
  await publishSite(analysisId, analysisSiteId, 'site.progress')
}

export async function recordSitemap(analysisId: string, analysisSiteId: string, urlCount: number): Promise<void> {
  await prisma.analysisSite.update({ where: { id: analysisSiteId }, data: { sitemapUrlCount: urlCount } })
  await publishSite(analysisId, analysisSiteId, 'site.progress', true)
}

export async function recordOther(analysisId: string, analysisSiteId: string): Promise<void> {
  await prisma.analysisSite.update({ where: { id: analysisSiteId }, data: { otherCount: { increment: 1 } } })
  await publishSite(analysisId, analysisSiteId, 'site.progress')
}

export async function recordError(analysisId: string, analysisSiteId: string, error: DiscoveredError): Promise<void> {
  await prisma.crawlError.create({
    data: {
      analysisSiteId,
      url: error.url,
      errorType: error.errorType,
      httpStatus: error.httpStatus,
      message: error.message.slice(0, 500),
    },
  })
  await prisma.analysisSite.update({ where: { id: analysisSiteId }, data: { errorCount: { increment: 1 } } })
  await publishSite(analysisId, analysisSiteId, 'site.progress')
}

export async function recordPdf(analysisId: string, analysisSiteId: string, page: DiscoveredPage): Promise<void> {
  let pdfId: string
  try {
    const pdf = await prisma.pdfDocument.create({
      data: {
        analysisSiteId,
        url: page.url,
        httpStatus: page.httpStatus,
        depth: page.depth,
        parentUrl: page.parentUrl,
        contentType: page.contentType,
        sizeBytes: page.sizeBytes,
        ocrStatus: 'pending',
      },
    })
    pdfId = pdf.id
  } catch (error) {
    if (isUnique(error)) return
    throw error
  }
  await prisma.analysisSite.update({
    where: { id: analysisSiteId },
    data: { pdfCount: { increment: 1 }, pendingPdfCount: { increment: 1 } },
  })
  try {
    await pdfQueue.add(
      'analyze-pdf',
      { analysisId, analysisSiteId, pdfId },
      { jobId: pdfId, attempts: 2, backoff: { type: 'exponential', delay: 3000 }, removeOnComplete: 1000, removeOnFail: 1000 },
    )
  } catch (error) {
    logger.error({ err: error, pdfId }, 'enqueue PDF impossible')
    await onPdfAnalyzed({
      analysisId,
      analysisSiteId,
      pdfId,
      ocrStatus: 'error',
      errorMessage: 'File PDF indisponible',
      pageCount: null,
      pagesWithText: null,
      pagesWithoutText: null,
      sizeBytes: page.sizeBytes,
    })
  }
  await publishSite(analysisId, analysisSiteId, 'site.progress')
}

export async function finishDiscovery(analysisSiteId: string): Promise<void> {
  const outcome = await prisma.$transaction(async (tx) => {
    const row = await lockSiteIn(tx, analysisSiteId)
    if (!row) return null
    const analysis = await tx.analysis.findUnique({ where: { id: row.analysisId } })
    const cancelled = row.status === 'cancelled' || analysis?.status === 'cancelled'
    const done = !cancelled && row.pendingPdfCount <= 0
    const started = asDate(row.startedAt)
    await tx.analysisSite.update({
      where: { id: row.id },
      data: {
        discoveryDone: true,
        status: cancelled ? 'cancelled' : done ? 'completed' : 'analyzing_pdfs',
        finishedAt: done || cancelled ? new Date() : null,
        durationMs: done && started ? Date.now() - started.getTime() : null,
      },
    })
    return { analysisId: row.analysisId, done }
  })
  if (!outcome) return
  await publishSite(outcome.analysisId, analysisSiteId, outcome.done ? 'site.completed' : 'site.progress', true)
  if (outcome.done) await maybeFinishAnalysis(outcome.analysisId)
}

export async function onPdfAnalyzed(input: {
  analysisId: string
  analysisSiteId: string
  pdfId: string
  ocrStatus: Exclude<OcrStatus, 'pending'>
  errorMessage: string | null
  pageCount: number | null
  pagesWithText: number | null
  pagesWithoutText: number | null
  sizeBytes: number | null
}): Promise<void> {
  const siteDone = await prisma.$transaction(async (tx) => {
    const row = await lockSiteIn(tx, input.analysisSiteId)
    if (!row) return false
    const analysis = await tx.analysis.findUnique({ where: { id: row.analysisId } })
    const cancelled = row.status === 'cancelled' || analysis?.status === 'cancelled'
    await tx.pdfDocument.update({
      where: { id: input.pdfId },
      data: {
        ocrStatus: input.ocrStatus,
        errorMessage: input.errorMessage,
        pageCount: input.pageCount,
        pagesWithText: input.pagesWithText,
        pagesWithoutText: input.pagesWithoutText,
        sizeBytes: input.sizeBytes ?? undefined,
        analyzedAt: new Date(),
      },
    })
    if (row.pendingPdfCount <= 0) return false
    const done = !cancelled && row.discoveryDone && row.pendingPdfCount - 1 === 0
    const started = asDate(row.startedAt)
    await tx.analysisSite.update({
      where: { id: row.id },
      data: {
        pendingPdfCount: { decrement: 1 },
        [counterByStatus[input.ocrStatus]]: { increment: 1 },
        status: cancelled ? 'cancelled' : done ? 'completed' : row.discoveryDone ? 'analyzing_pdfs' : row.status,
        finishedAt: done ? new Date() : undefined,
        durationMs: done && started ? Date.now() - started.getTime() : undefined,
      },
    })
    return done
  })
  await publishSite(input.analysisId, input.analysisSiteId, siteDone ? 'site.completed' : 'site.progress', true)
  if (siteDone) await maybeFinishAnalysis(input.analysisId)
}

export async function markSiteFailed(analysisSiteId: string, message: string): Promise<void> {
  const row = await prisma.analysisSite.findUnique({ where: { id: analysisSiteId } })
  if (!row || row.status === 'cancelled' || row.status === 'completed') return
  const started = row.startedAt
  await prisma.analysisSite.update({
    where: { id: analysisSiteId },
    data: {
      status: 'failed',
      errorMessage: message.slice(0, 500),
      discoveryDone: true,
      finishedAt: new Date(),
      durationMs: started ? Date.now() - started.getTime() : null,
    },
  })
  await publishSite(row.analysisId, analysisSiteId, 'site.completed', true)
  await maybeFinishAnalysis(row.analysisId)
}

export async function maybeFinishAnalysis(analysisId: string): Promise<void> {
  const outcome = await prisma.$transaction(async (tx) => {
    const locked = await tx.$queryRaw<Array<{ status: string; emailOnComplete: boolean; notifyEmails: string[] }>>`
      SELECT "status", "emailOnComplete", "notifyEmails"
      FROM "Analysis"
      WHERE "id" = ${analysisId}
      FOR UPDATE
    `
    const analysis = locked[0]
    if (!analysis) return null
    if (analysis.status === 'cancelled' || analysis.status === 'completed' || analysis.status === 'failed') return null
    const open = await tx.analysisSite.count({
      where: { analysisId, status: { in: ['pending', 'crawling', 'analyzing_pdfs'] } },
    })
    if (open > 0) return null
    const [total, failed] = await Promise.all([
      tx.analysisSite.count({ where: { analysisId } }),
      tx.analysisSite.count({ where: { analysisId, status: 'failed' } }),
    ])
    const status = total > 0 && failed === total ? 'failed' : 'completed'
    await tx.analysis.update({
      where: { id: analysisId },
      data: {
        status,
        finishedAt: new Date(),
        failureReason: status === 'failed' ? 'Tous les sites ont échoué' : null,
      },
    })
    const emails = Array.isArray(analysis.notifyEmails) ? analysis.notifyEmails : []
    return {
      status,
      emails,
      send: status === 'completed' && analysis.emailOnComplete && emails.length > 0,
    }
  })
  if (!outcome) return
  await redis.publish(
    analysisChannel(analysisId),
    JSON.stringify({ type: outcome.status === 'failed' ? 'analysis.failed' : 'analysis.completed', analysisId, status: outcome.status }),
  )
  if (!outcome.send) return
  await mailQueue.add(
    'send-report',
    { analysisId, emails: outcome.emails, trigger: 'auto' },
    { jobId: `mail:${analysisId}:auto`, attempts: 2, backoff: { type: 'exponential', delay: 5000 }, removeOnComplete: 1000, removeOnFail: 1000 },
  )
}

async function lockSiteIn(tx: Prisma.TransactionClient, id: string): Promise<SiteLock | null> {
  const rows = await tx.$queryRaw<SiteLock[]>`
    SELECT "id", "status", "discoveryDone", "pendingPdfCount", "analysisId", "startedAt"
    FROM "AnalysisSite"
    WHERE "id" = ${id}
    FOR UPDATE
  `
  const row = rows[0]
  if (!row) return null
  return { ...row, pendingPdfCount: Number(row.pendingPdfCount), startedAt: asDate(row.startedAt) }
}
