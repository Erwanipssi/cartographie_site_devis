import { a11yIssues } from './pdf-accessibility'

/**
 * Évolution d'un site entre deux analyses : PDF apparus ou disparus, PDF corrigés ou dégradés
 * (couche texte, accessibilité), pages apparues ou disparues. Comparaison par URL normalisée.
 */

export type PdfSnapshot = {
  url: string
  ocrStatus: string
  tagged: boolean | null
  titleStatus: string | null
  lang: string | null
  pageCount: number | null
  pagesWithoutText: number | null
  parentUrl: string | null
}

export type PdfChange = PdfSnapshot & { before: PdfSnapshot }

export type PdfEvolution = {
  added: PdfSnapshot[]
  removed: PdfSnapshot[]
  /** Couche texte apparue ou complétée (non OCRisé → partiel → texte). */
  textFixed: PdfChange[]
  textRegressed: PdfChange[]
  /** Moins de défauts d'accessibilité (balisage, titre, langue) qu'avant. */
  a11yImproved: PdfChange[]
  a11yRegressed: PdfChange[]
}

/** Niveau de lisibilité ; null si le statut ne se compare pas (erreur, en attente). */
const TEXT_RANK: Record<string, number> = { image: 0, partial: 1, text: 2 }

function issueCount(pdf: PdfSnapshot): number | null {
  return pdf.tagged === null ? null : a11yIssues(pdf).length
}

export function comparePdfs(previous: PdfSnapshot[], current: PdfSnapshot[]): PdfEvolution {
  const before = new Map(previous.map((pdf) => [pdf.url, pdf]))
  const now = new Map(current.map((pdf) => [pdf.url, pdf]))
  const result: PdfEvolution = { added: [], removed: [], textFixed: [], textRegressed: [], a11yImproved: [], a11yRegressed: [] }

  for (const pdf of current) {
    const old = before.get(pdf.url)
    if (!old) {
      result.added.push(pdf)
      continue
    }
    const rankBefore = TEXT_RANK[old.ocrStatus]
    const rankNow = TEXT_RANK[pdf.ocrStatus]
    if (rankBefore !== undefined && rankNow !== undefined) {
      if (rankNow > rankBefore) result.textFixed.push({ ...pdf, before: old })
      else if (rankNow < rankBefore) result.textRegressed.push({ ...pdf, before: old })
    }
    const issuesBefore = issueCount(old)
    const issuesNow = issueCount(pdf)
    if (issuesBefore !== null && issuesNow !== null) {
      if (issuesNow < issuesBefore) result.a11yImproved.push({ ...pdf, before: old })
      else if (issuesNow > issuesBefore) result.a11yRegressed.push({ ...pdf, before: old })
    }
  }
  for (const pdf of previous) if (!now.has(pdf.url)) result.removed.push(pdf)

  const byUrl = (a: { url: string }, b: { url: string }) => a.url.localeCompare(b.url)
  for (const list of Object.values(result)) list.sort(byUrl)
  return result
}

export function comparePages(previous: string[], current: string[]): { added: string[]; removed: string[] } {
  const before = new Set(previous)
  const now = new Set(current)
  return {
    added: current.filter((url) => !before.has(url)).sort(),
    removed: previous.filter((url) => !now.has(url)).sort(),
  }
}
