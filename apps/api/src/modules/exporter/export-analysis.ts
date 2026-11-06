import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { OCR_LABELS } from '@cartographie/shared'
import { env } from '../../env'
import { sortForTriage, TRIAGE_STATUSES, type TriageStatus } from '../../lib/pdf-triage'
import { logger } from '../../lib/logger'
import { prisma } from '../../lib/prisma'
import { buildWorkbook, type ExportData } from './workbook'

export async function loadAnalysisExport(analysisId: string): Promise<Buffer> {
  const analysis = await prisma.analysis.findUnique({
    where: { id: analysisId },
    include: {
      sites: {
        include: {
          site: true,
          pages: { orderBy: { url: 'asc' } },
          pdfs: { orderBy: { url: 'asc' } },
          errors: { orderBy: { createdAt: 'asc' } },
        },
        orderBy: { site: { hostname: 'asc' } },
      },
    },
  })
  if (!analysis) throw new Error('Analyse introuvable')

  const data: ExportData = {
    sites: analysis.sites.map((row) => ({
      hostname: row.site.hostname,
      url: row.site.normalizedUrl,
      htmlCount: row.htmlCount,
      pdfCount: row.pdfCount,
      pdfTextCount: row.pdfTextCount,
      pdfImageCount: row.pdfImageCount,
      pdfPartialCount: row.pdfPartialCount,
      pdfErrorCount: row.pdfErrorCount,
      otherCount: row.otherCount,
      errorCount: row.errorCount,
      durationMs: row.durationMs,
      status: row.status,
    })),
    pages: analysis.sites.flatMap((row) =>
      row.pages.map((page) => ({
        site: row.site.hostname,
        url: page.url,
        httpStatus: page.httpStatus,
        depth: page.depth,
        sizeBytes: page.sizeBytes,
      })),
    ),
    pdfs: analysis.sites.flatMap((row) =>
      row.pdfs.map((pdf) => ({
        site: row.site.hostname,
        url: pdf.url,
        ocrStatus: pdf.ocrStatus,
        pageCount: pdf.pageCount,
        pagesWithText: pdf.pagesWithText,
        sizeBytes: pdf.sizeBytes,
        parentUrl: pdf.parentUrl,
        tagged: pdf.tagged,
        title: pdf.title,
        titleStatus: pdf.titleStatus,
        lang: pdf.lang,
      })),
    ),
    toFix: sortForTriage(
      analysis.sites.flatMap((row) =>
        row.pdfs
          .filter((pdf): pdf is typeof pdf & { ocrStatus: TriageStatus } => (TRIAGE_STATUSES as readonly string[]).includes(pdf.ocrStatus))
          .map((pdf) => ({
            site: row.site.hostname,
            url: pdf.url,
            ocrStatus: pdf.ocrStatus,
            pageCount: pdf.pageCount,
            pagesWithoutText: pdf.pagesWithoutText,
            sizeBytes: pdf.sizeBytes,
            parentUrl: pdf.parentUrl,
            errorMessage: pdf.errorMessage,
          })),
      ),
    ),
    errors: analysis.sites.flatMap((row) =>
      row.errors.map((error) => ({
        site: row.site.hostname,
        url: error.url,
        errorType: error.errorType,
        httpStatus: error.httpStatus,
        message: error.message,
      })),
    ),
  }

  const buffer = await buildWorkbook(data)
  // La copie sur disque est un archivage : son échec (dossier en lecture seule, fichier verrouillé par un
  // antivirus ou ouvert dans Excel) ne doit pas priver l'utilisateur du téléchargement.
  try {
    await mkdir(env.EXPORT_DIR, { recursive: true })
    const file = join(env.EXPORT_DIR, `${analysisId}.xlsx`)
    await writeFile(file, buffer)
    await prisma.analysis.update({ where: { id: analysisId }, data: { exportPath: file } })
  } catch (error) {
    logger.warn({ err: error, analysisId }, 'classeur non archivé sur disque, téléchargement servi quand même')
  }
  return buffer
}

export async function analysisSummaryText(analysisId: string): Promise<string> {
  const rows = await prisma.analysisSite.findMany({
    where: { analysisId },
    include: { site: true },
    orderBy: { site: { hostname: 'asc' } },
  })
  const lines = [
    'Rapport de cartographie',
    '',
    ...rows.map((row) => {
      const ocr = `${row.pdfTextCount} texte, ${row.pdfImageCount} image, ${row.pdfPartialCount} partiel, ${row.pdfErrorCount} erreur`
      return `${row.site.hostname} — ${row.htmlCount} pages HTML, ${row.pdfCount} PDF (${ocr}), ${row.errorCount} erreurs`
    }),
    '',
    'Statuts OCR : ' + Object.values(OCR_LABELS).join(', '),
  ]
  return lines.join('\n')
}
