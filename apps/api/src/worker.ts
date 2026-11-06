import { Worker } from 'bullmq'
import { env } from './env'
import { isCancelled } from './lib/cancel'
import { logger } from './lib/logger'
import { prisma } from './lib/prisma'
import { bullConnection } from './lib/queues'
import { redis } from './lib/redis'
import { finishDiscovery, markSiteFailed, onPdfAnalyzed, recordError, recordOther, recordPage, recordPdf, recordSitemap } from './modules/analyses/lifecycle'
import { crawlSite } from './modules/crawler/crawl-site'
import { fetchPublic } from './modules/crawler/fetch'
import { sendReport } from './modules/mailer/send'
import { analyzePdfBuffer, pdfFailureMessage } from './modules/pdf-analyzer/analyze'
import { executeSchedule } from './modules/scheduler/run'
import { syncAllSchedules } from './modules/scheduler/sync'
import { readConfig } from './modules/analyses/service'
import { sweepStalledWork } from './modules/analyses/watchdog'
import { titleStatus } from './lib/pdf-accessibility'

const PDF_MIN_TIMEOUT_MS = 60_000

function readKnownSitemap(urls: unknown, readAt: Date | null): { urls: string[]; readAt: Date } | undefined {
  if (!readAt || !Array.isArray(urls)) return undefined
  const list = urls.filter((url): url is string => typeof url === 'string')
  return list.length ? { urls: list, readAt } : undefined
}

async function main(): Promise<void> {
  await prisma.$connect()
  await redis.ping()
  await syncAllSchedules()
  const beat = async () => {
    await redis.set('worker:heartbeat', String(Date.now()), 'EX', 15)
  }
  await beat()
  const heartbeat = setInterval(() => {
    void beat().catch(() => undefined)
  }, 5000)

  // Surveillance des analyses figées, une fois par minute. Le verrou Redis évite que deux workers la lancent ensemble.
  const sweep = async () => {
    const acquired = await redis.set('watchdog:lock', String(process.pid), 'EX', 50, 'NX')
    if (acquired) await sweepStalledWork()
  }
  const watchdog = setInterval(() => {
    void sweep().catch((error: unknown) => logger.error({ err: error }, 'surveillance en échec'))
  }, 60_000)

  const crawlWorker = new Worker(
    'crawl',
    async (job) => {
      const { analysisId, analysisSiteId } = job.data as { analysisId: string; analysisSiteId: string }
      const row = await prisma.analysisSite.findUnique({
        where: { id: analysisSiteId },
        include: { site: true, analysis: true },
      })
      if (!row || row.status === 'cancelled' || row.analysis.status === 'cancelled') return
      const config = readConfig(row.analysis.config)
      config.pdfMaxBytes = Math.min(config.pdfMaxBytes, env.PDF_MAX_BYTES)
      await prisma.analysisSite.update({
        where: { id: row.id },
        data: { status: 'crawling', startedAt: row.startedAt ?? new Date() },
      })
      try {
        await crawlSite({
          seedUrl: row.site.normalizedUrl,
          includeSubdomains: row.site.includeSubdomains,
          config,
          userAgent: env.CARTOGRAPHIE_USER_AGENT,
          fetch: (url) =>
            fetchPublic(url, {
              userAgent: env.CARTOGRAPHIE_USER_AGENT,
              timeoutMs: config.timeoutMs,
              maxBytes: 2_000_000,
              skipPdfBody: true,
            }),
          shouldCancel: () => isCancelled(analysisId),
          onPage: async (page) => recordPage(analysisId, analysisSiteId, page),
          onPdf: async (page) => recordPdf(analysisId, analysisSiteId, page),
          onOther: async () => recordOther(analysisId, analysisSiteId),
          onError: async (error) => recordError(analysisId, analysisSiteId, error),
          onSitemap: async (count, source) => recordSitemap(analysisId, analysisSiteId, count, source),
          deferPdfFetch: true,
          knownSitemap: readKnownSitemap(row.site.sitemapUrls, row.site.sitemapReadAt),
          onSitemapRead: async (urls) => {
            await prisma.site.update({ where: { id: row.site.id }, data: { sitemapUrls: urls, sitemapReadAt: new Date() } })
          },
        })
        if (await isCancelled(analysisId)) {
          await prisma.analysisSite.update({
            where: { id: row.id },
            data: { status: 'cancelled', discoveryDone: true, finishedAt: new Date() },
          })
          return
        }
        await finishDiscovery(analysisSiteId)
      } catch (error) {
        logger.error({ err: error, analysisId, analysisSiteId }, 'crawl en échec')
        if (await isCancelled(analysisId)) return
        await markSiteFailed(analysisSiteId, error instanceof Error ? error.message : 'Crawl interrompu')
      }
    },
    { connection: bullConnection, concurrency: env.CRAWL_SITE_CONCURRENCY },
  )

  const pdfWorker = new Worker(
    'pdf',
    async (job) => {
      const { analysisId, analysisSiteId, pdfId } = job.data as { analysisId: string; analysisSiteId: string; pdfId: string }
      if (await isCancelled(analysisId)) return
      const pdf = await prisma.pdfDocument.findUnique({ where: { id: pdfId } })
      if (!pdf || pdf.ocrStatus !== 'pending') return
      const analysis = await prisma.analysis.findUnique({ where: { id: analysisId } })
      if (!analysis) return
      const config = readConfig(analysis.config)
      const fetched = await fetchPublic(pdf.url, {
        userAgent: env.CARTOGRAPHIE_USER_AGENT,
        // Le délai couvre tout le fichier : un PDF de plusieurs Mo sur un site chargé dépasse vite 15 s.
        timeoutMs: Math.max(config.timeoutMs, PDF_MIN_TIMEOUT_MS),
        maxBytes: Math.min(config.pdfMaxBytes, env.PDF_MAX_BYTES),
        skipPdfBody: false,
      })
      // Échec passager (délai, réseau, erreur serveur) : on laisse BullMQ retenter, avec attente croissante.
      // Le dernier essai, lui, enregistre l'échec pour que le site puisse se terminer.
      const transient = fetched.ok ? fetched.status >= 500 : fetched.errorType === 'timeout' || fetched.errorType === 'network'
      if (transient && job.attemptsMade + 1 < (job.opts.attempts ?? 1)) {
        throw new Error(`Téléchargement PDF à retenter : ${fetched.ok ? `HTTP ${fetched.status}` : fetched.message}`)
      }
      const fail = (errorMessage: string, extra: { httpStatus?: number | null; contentType?: string | null; sizeBytes?: number | null } = {}) =>
        onPdfAnalyzed({
          analysisId,
          analysisSiteId,
          pdfId,
          ocrStatus: 'error',
          errorMessage,
          pageCount: null,
          pagesWithText: null,
          pagesWithoutText: null,
          sizeBytes: extra.sizeBytes ?? pdf.sizeBytes,
          httpStatus: extra.httpStatus,
          contentType: extra.contentType,
        })
      if (!fetched.ok) {
        await fail(fetched.message, { httpStatus: fetched.status ?? null })
        return
      }
      // Le crawler n'a pas demandé le fichier (mode « téléchargement unique ») : c'est ici qu'on relève
      // une page d'erreur ou une page HTML servie à la place du PDF.
      if (fetched.status >= 400) {
        await fail(`HTTP ${fetched.status}`, { httpStatus: fetched.status, contentType: fetched.contentType })
        return
      }
      const mime = fetched.contentType?.split(';')[0]?.trim().toLowerCase() ?? ''
      const looksPdf = new TextDecoder().decode(fetched.body.subarray(0, 5)) === '%PDF-'
      if (!looksPdf && (mime === 'text/html' || mime === 'application/xhtml+xml')) {
        await fail(`Pas un PDF (${mime})`, { httpStatus: fetched.status, contentType: fetched.contentType, sizeBytes: fetched.sizeBytes })
        return
      }
      try {
        const inspection = await analyzePdfBuffer(fetched.body, {
          minChars: config.ocrMinChars,
          textRatio: config.textRatio,
          imageRatio: config.imageRatio,
        })
        await onPdfAnalyzed({
          analysisId,
          analysisSiteId,
          pdfId,
          ocrStatus: inspection.ocrStatus,
          errorMessage: inspection.errorMessage,
          pageCount: inspection.pageCount,
          pagesWithText: inspection.pagesWithText,
          pagesWithoutText: inspection.pagesWithoutText,
          sizeBytes: fetched.sizeBytes,
          httpStatus: fetched.status,
          contentType: fetched.contentType,
          a11y: { tagged: inspection.tagged, title: inspection.title, titleStatus: titleStatus(inspection.title), lang: inspection.lang },
        })
      } catch (error) {
        await fail(pdfFailureMessage(error), { httpStatus: fetched.status, contentType: fetched.contentType, sizeBytes: fetched.sizeBytes })
      }
    },
    { connection: bullConnection, concurrency: env.PDF_CONCURRENCY },
  )

  const mailWorker = new Worker(
    'mail',
    async (job) => {
      const data = job.data as { analysisId: string; emails: string[]; trigger: string }
      await sendReport(data)
    },
    { connection: bullConnection, concurrency: 2 },
  )

  const scheduleWorker = new Worker(
    'schedule',
    async (job) => {
      const data = job.data as { scheduleId: string; manual?: boolean }
      await executeSchedule(data.scheduleId, Boolean(data.manual))
    },
    { connection: bullConnection, concurrency: 1 },
  )

  for (const worker of [crawlWorker, pdfWorker, mailWorker, scheduleWorker]) {
    worker.on('failed', (job, error) => {
      logger.error({ err: error, jobId: job?.id, queue: worker.name }, 'job en échec')
    })
  }

  const shutdown = async () => {
    clearInterval(heartbeat)
    clearInterval(watchdog)
    await Promise.all([crawlWorker.close(), pdfWorker.close(), mailWorker.close(), scheduleWorker.close()])
    await prisma.$disconnect()
    redis.disconnect()
    process.exit(0)
  }
  // Une promesse oubliée ne doit pas arrêter le worker en plein crawl.
  process.on('unhandledRejection', (reason) => {
    logger.error({ err: reason }, 'promesse rejetée non gérée')
  })
  // Une vraie exception non rattrapée laisse le processus dans un état incertain : on la journalise puis on sort.
  process.on('uncaughtException', (error) => {
    logger.fatal({ err: error }, 'exception non rattrapée : arrêt du worker')
    process.exit(1)
  })
  process.on('exit', (code) => {
    if (code !== 0) logger.warn({ code }, 'worker arrêté')
  })
  process.on('SIGINT', () => void shutdown())
  process.on('SIGTERM', () => void shutdown())
  logger.info('worker prêt')
}

void main().catch((error: unknown) => {
  logger.error({ err: error }, 'worker arrêté')
  process.exit(1)
})
