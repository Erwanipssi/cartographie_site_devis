import { crawlConfigSchema, type CrawlConfig } from '@cartographie/shared'
import type { AnalysisTrigger } from '@prisma/client'
import { env } from '../../env'
import { ApiError } from '../../lib/http'
import { prisma } from '../../lib/prisma'
import { crawlQueue } from '../../lib/queues'

export async function startAnalysis(input: {
  siteIds: string[]
  config: CrawlConfig
  emailOnComplete: boolean
  emails: string[]
  trigger: AnalysisTrigger
  scheduleId?: string
  strict: boolean
}) {
  const uniqueIds = [...new Set(input.siteIds)]
  const sites = await prisma.site.findMany({ where: { id: { in: uniqueIds }, archivedAt: null } })
  if (input.strict && sites.length !== uniqueIds.length) {
    throw new ApiError(400, 'Un ou plusieurs sites sont inconnus ou archivés', 'UNKNOWN_SITE')
  }
  const config = {
    ...input.config,
    pdfMaxBytes: Math.min(input.config.pdfMaxBytes, env.PDF_MAX_BYTES),
  }
  if (config.imageRatio >= config.textRatio) {
    throw new ApiError(400, 'Le seuil « image » doit être inférieur au seuil « texte »', 'INVALID_THRESHOLD')
  }
  if (sites.length === 0) {
    return prisma.analysis.create({
      data: {
        status: 'failed',
        trigger: input.trigger,
        scheduleId: input.scheduleId,
        config,
        emailOnComplete: input.emailOnComplete,
        notifyEmails: input.emails,
        failureReason: 'Aucun site actif à analyser',
        startedAt: new Date(),
        finishedAt: new Date(),
      },
    })
  }
  const analysis = await prisma.analysis.create({
    data: {
      status: 'running',
      trigger: input.trigger,
      scheduleId: input.scheduleId,
      config,
      emailOnComplete: input.emailOnComplete,
      notifyEmails: input.emails,
      startedAt: new Date(),
      sites: { create: sites.map((site) => ({ siteId: site.id })) },
    },
    include: { sites: true },
  })
  for (const site of analysis.sites) {
    await crawlQueue.add(
      'crawl-site',
      { analysisId: analysis.id, analysisSiteId: site.id },
      { jobId: site.id, attempts: 1, removeOnComplete: 1000, removeOnFail: 1000 },
    )
  }
  return analysis
}

export function readConfig(value: unknown): CrawlConfig {
  return crawlConfigSchema.parse(value ?? {})
}
