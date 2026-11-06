import type { Queue } from 'bullmq'
import { logger } from '../../lib/logger'
import { prisma } from '../../lib/prisma'
import { crawlQueue, pdfQueue } from '../../lib/queues'
import { finishDiscovery, markSiteFailed, onPdfAnalyzed } from './lifecycle'

/**
 * Surveillance des analyses figées.
 *
 * Plutôt qu'un simple délai sans progrès (qui accuserait à tort un gros PDF lent ou une file chargée),
 * on regarde l'état réel du job BullMQ qui porte le travail :
 * - site en découverte dont le job de crawl n'est plus vivant → site en échec, avec la raison ;
 * - PDF « en attente » dont le job d'analyse n'est plus vivant → PDF clôturé en erreur, le site peut se terminer ;
 * - site « analyse PDF » sans plus aucun PDF en attente (compteur désynchronisé) → site clôturé.
 * Un job « active » reste vivant : si son worker meurt, BullMQ le détecte (stalled) et le relance ou l'échoue.
 */

const ALIVE = new Set(['active', 'waiting', 'delayed', 'prioritized', 'waiting-children'])
/** Laisse le temps à un job tout juste créé d'apparaître dans la file. */
export const WATCHDOG_GRACE_MS = 2 * 60_000

type Queues = { crawl: Pick<Queue, 'getJob'>; pdf: Pick<Queue, 'getJob'> }

async function jobState(queue: Pick<Queue, 'getJob'>, jobId: string): Promise<string> {
  const job = await queue.getJob(jobId)
  if (!job) return 'missing'
  return job.getState()
}

const CRAWL_REASONS: Record<string, string> = {
  missing: 'Crawl interrompu : le traitement a disparu de la file (worker arrêté ou file vidée)',
  failed: 'Crawl interrompu : le traitement a échoué (voir apps/api/data/logs/worker.log)',
  completed: 'Crawl interrompu : le traitement s’est terminé sans clôturer le site',
}

export type SweepResult = { failedSites: string[]; closedPdfs: number; closedSites: string[] }

export async function sweepStalledWork(queues: Queues = { crawl: crawlQueue, pdf: pdfQueue }, now = Date.now()): Promise<SweepResult> {
  const result: SweepResult = { failedSites: [], closedPdfs: 0, closedSites: [] }
  const open = await prisma.analysisSite.findMany({
    where: { status: { in: ['pending', 'crawling', 'analyzing_pdfs'] }, analysis: { status: 'running' } },
    select: { id: true, analysisId: true, discoveryDone: true, startedAt: true, analysis: { select: { createdAt: true } } },
  })

  for (const site of open) {
    const since = (site.startedAt ?? site.analysis.createdAt).getTime()
    if (now - since < WATCHDOG_GRACE_MS) continue

    if (!site.discoveryDone) {
      const state = await jobState(queues.crawl, site.id)
      if (ALIVE.has(state)) continue
      await markSiteFailed(site.id, CRAWL_REASONS[state] ?? `Crawl interrompu (état du traitement : ${state})`)
      result.failedSites.push(site.id)
      continue
    }

    const pending = await prisma.pdfDocument.findMany({
      where: { analysisSiteId: site.id, ocrStatus: 'pending' },
      select: { id: true },
      take: 2000,
    })
    if (pending.length === 0) {
      // Plus rien à attendre : on remet le compteur d'accord et on clôt le site.
      await prisma.analysisSite.update({ where: { id: site.id }, data: { pendingPdfCount: 0 } })
      await finishDiscovery(site.id)
      result.closedSites.push(site.id)
      continue
    }
    for (const pdf of pending) {
      if (ALIVE.has(await jobState(queues.pdf, pdf.id))) continue
      await onPdfAnalyzed({
        analysisId: site.analysisId,
        analysisSiteId: site.id,
        pdfId: pdf.id,
        ocrStatus: 'error',
        errorMessage: 'Analyse interrompue : le traitement de ce PDF s’est arrêté sans résultat',
        pageCount: null,
        pagesWithText: null,
        pagesWithoutText: null,
        sizeBytes: null,
      })
      result.closedPdfs += 1
    }
  }

  if (result.failedSites.length || result.closedPdfs || result.closedSites.length) {
    logger.warn(result, 'surveillance : travail figé débloqué')
  }
  return result
}
