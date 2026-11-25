import { prisma } from '../../lib/prisma'

/**
 * Nombre de pages contenues dans les PDF, additionnées sur tous les PDF analysés d'un site.
 * Les PDF illisibles ou pas encore analysés n'ont pas de nombre de pages : ils ne comptent pas.
 */
export type PdfPageTotals = {
  /** Total des pages de tous les PDF analysés. */
  pages: number
  /** Pages qui portent une couche de texte exploitable. */
  withText: number
  /** Pages sans texte : le volume à OCRiser pour rendre les documents lisibles. */
  withoutText: number
  /** Nombre de PDF dont les pages ont été comptées. */
  documents: number
}

export const EMPTY_PDF_PAGES: PdfPageTotals = { pages: 0, withText: 0, withoutText: 0, documents: 0 }

/** Totaux par site d'analyse (une seule requête groupée). Un site sans PDF analysé n'apparaît pas dans la carte. */
export async function pdfPagesBySite(analysisSiteIds: string[]): Promise<Map<string, PdfPageTotals>> {
  if (analysisSiteIds.length === 0) return new Map()
  const groups = await prisma.pdfDocument.groupBy({
    by: ['analysisSiteId'],
    where: { analysisSiteId: { in: analysisSiteIds }, pageCount: { not: null } },
    _sum: { pageCount: true, pagesWithText: true, pagesWithoutText: true },
    _count: { _all: true },
  })
  return new Map(
    groups.map((group) => [
      group.analysisSiteId,
      {
        pages: group._sum.pageCount ?? 0,
        withText: group._sum.pagesWithText ?? 0,
        withoutText: group._sum.pagesWithoutText ?? 0,
        documents: group._count._all,
      },
    ]),
  )
}

export function addPdfPages(totals: PdfPageTotals[]): PdfPageTotals {
  return totals.reduce(
    (sum, item) => ({
      pages: sum.pages + item.pages,
      withText: sum.withText + item.withText,
      withoutText: sum.withoutText + item.withoutText,
      documents: sum.documents + item.documents,
    }),
    EMPTY_PDF_PAGES,
  )
}
