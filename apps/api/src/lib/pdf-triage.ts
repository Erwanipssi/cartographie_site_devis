import type { OcrStatus } from '@cartographie/shared'

/**
 * « PDF à traiter » : les documents sans couche texte exploitable, classés du plus urgent au moins urgent.
 * - image   : aucune page lisible, à reprendre entièrement (OCR ou version native)
 * - partial : une partie des pages sans texte, à compléter
 * - error   : document illisible (téléchargement ou fichier en erreur), à vérifier à la main
 */
export const TRIAGE_STATUSES = ['image', 'partial', 'error'] as const satisfies readonly OcrStatus[]
export type TriageStatus = (typeof TRIAGE_STATUSES)[number]

export const TRIAGE_LABELS: Record<TriageStatus, string> = {
  image: 'Non OCRisé — à reprendre',
  partial: 'Partiel — à compléter',
  error: 'Illisible — à vérifier',
}

export function parseTriageStatuses(value: string | undefined): TriageStatus[] {
  if (!value) return ['image', 'partial']
  const wanted = value.split(',').map((part) => part.trim())
  const statuses = TRIAGE_STATUSES.filter((status) => wanted.includes(status))
  return statuses.length ? statuses : ['image', 'partial']
}

/** Nom lisible du fichier : dernier segment du chemin, décodé (« Compte%20rendu.pdf » → « Compte rendu.pdf »). */
export function documentName(url: string): string {
  try {
    const segment = new URL(url).pathname.split('/').filter(Boolean).pop() ?? url
    try {
      return decodeURIComponent(segment)
    } catch {
      return segment
    }
  } catch {
    return url
  }
}

export type TriageRow = {
  site: string
  url: string
  ocrStatus: TriageStatus
  pageCount: number | null
  pagesWithoutText: number | null
  sizeBytes: number | null
  parentUrl: string | null
  errorMessage: string | null
}

/** Marque d'ordre des octets UTF-8 : sans elle, Excel lit le CSV en Windows-1252 et casse les accents. */
const BOM = String.fromCharCode(0xfeff)

const CSV_HEADER = ['Statut', 'Document', 'Pages', 'Pages sans texte', 'Taille (Mo)', 'Publié sur', 'URL du PDF', 'Site', 'Détail']

function csvCell(value: string | number | null): string {
  if (value == null) return ''
  const text = String(value)
  return /[";\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text
}

/** CSV pour Excel en français : séparateur « ; », décimale « , », BOM UTF-8 pour les accents. */
export function triageCsv(rows: TriageRow[]): string {
  const lines = [CSV_HEADER.join(';')]
  for (const row of rows) {
    lines.push(
      [
        TRIAGE_LABELS[row.ocrStatus],
        documentName(row.url),
        row.pageCount,
        row.pagesWithoutText,
        row.sizeBytes == null ? null : (row.sizeBytes / 1024 / 1024).toFixed(2).replace('.', ','),
        row.parentUrl,
        row.url,
        row.site,
        row.errorMessage,
      ]
        .map(csvCell)
        .join(';'),
    )
  }
  return `${BOM}${lines.join('\r\n')}\r\n`
}

/** Même ordre que l'API : aucune page lisible d'abord, puis partiels, puis illisibles ; les plus gros en tête. */
export function sortForTriage<T extends Pick<TriageRow, 'ocrStatus' | 'pagesWithoutText' | 'url'>>(rows: T[]): T[] {
  return [...rows].sort(
    (a, b) =>
      TRIAGE_STATUSES.indexOf(a.ocrStatus) - TRIAGE_STATUSES.indexOf(b.ocrStatus) ||
      (b.pagesWithoutText ?? -1) - (a.pagesWithoutText ?? -1) ||
      a.url.localeCompare(b.url),
  )
}
