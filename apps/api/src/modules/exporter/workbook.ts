import ExcelJS from 'exceljs'
import { OCR_LABELS, type OcrStatus } from '@cartographie/shared'
import { A11Y_LABELS, a11yIssues } from '../../lib/pdf-accessibility'
import { documentName, TRIAGE_LABELS, type TriageRow } from '../../lib/pdf-triage'

export type ExportSite = {
  hostname: string
  url: string
  htmlCount: number
  pdfCount: number
  pdfTextCount: number
  pdfImageCount: number
  pdfPartialCount: number
  pdfErrorCount: number
  otherCount: number
  errorCount: number
  durationMs: number | null
  status: string
}

export type ExportPage = {
  site: string
  url: string
  httpStatus: number | null
  depth: number
  sizeBytes: number | null
}

export type ExportPdf = {
  site: string
  url: string
  ocrStatus: OcrStatus
  pageCount: number | null
  pagesWithText: number | null
  sizeBytes: number | null
  /** Page où le lien vers le PDF a été trouvé. */
  parentUrl?: string | null
  /** Accessibilité : null tant que le PDF n'a pas été contrôlé. */
  tagged?: boolean | null
  title?: string | null
  titleStatus?: string | null
  lang?: string | null
}

export type ExportError = {
  site: string
  url: string
  errorType: string
  httpStatus: number | null
  message: string
}

export type ExportData = {
  sites: ExportSite[]
  pages: ExportPage[]
  pdfs: ExportPdf[]
  errors: ExportError[]
  /** PDF à traiter, déjà triés par priorité (voir lib/pdf-triage). */
  toFix?: TriageRow[]
}

const STATUS_LABEL: Record<string, string> = {
  pending: 'En attente',
  running: 'En cours',
  crawling: 'Crawl',
  analyzing_pdfs: 'Analyse PDF',
  completed: 'Terminé',
  failed: 'Échec',
  cancelled: 'Annulé',
}

function prepare(sheet: ExcelJS.Worksheet, widths: number[]): void {
  sheet.columns.forEach((column, index) => {
    column.width = widths[index] ?? 18
  })
  const header = sheet.getRow(1)
  header.font = { bold: true, color: { argb: 'FFF3EFE6' } }
  header.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1B2421' } }
  header.alignment = { vertical: 'middle' }
  sheet.views = [{ state: 'frozen', ySplit: 1 }]
  sheet.autoFilter = {
    from: { row: 1, column: 1 },
    to: { row: 1, column: widths.length },
  }
}

const TITLE_LABELS: Record<string, string> = { ok: 'Oui', missing: 'Absent', generic: 'Non pertinent' }

/** Libellés lisibles des contrôles ; cellules vides si le PDF n’a pas été contrôlé. */
function a11yLabels(pdf: ExportPdf) {
  if (pdf.tagged == null) return { taggedLabel: null, titleLabel: null, langLabel: null }
  return {
    taggedLabel: pdf.tagged ? 'Oui' : 'Non',
    titleLabel: TITLE_LABELS[pdf.titleStatus ?? ''] ?? null,
    langLabel: pdf.lang ?? 'Non déclarée',
  }
}

export async function buildWorkbook(data: ExportData): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook()
  workbook.creator = 'Cartographie'
  workbook.created = new Date()

  const summary = workbook.addWorksheet('Synthèse')
  summary.columns = [
    { header: 'Site', key: 'hostname' },
    { header: 'URL', key: 'url' },
    { header: 'Pages HTML', key: 'htmlCount' },
    { header: 'PDF', key: 'pdfCount' },
    { header: 'OCRisés', key: 'pdfTextCount' },
    { header: 'Non OCRisés', key: 'pdfImageCount' },
    { header: 'Partiels', key: 'pdfPartialCount' },
    { header: 'Erreurs PDF', key: 'pdfErrorCount' },
    { header: 'Autres', key: 'otherCount' },
    { header: 'Erreurs crawl', key: 'errorCount' },
    { header: 'Durée (s)', key: 'duration' },
    { header: 'Statut', key: 'status' },
  ]
  prepare(summary, [28, 46, 14, 10, 12, 14, 12, 14, 12, 16, 12, 16])
  for (const site of data.sites) {
    summary.addRow({
      ...site,
      duration: site.durationMs == null ? null : Math.round(site.durationMs / 1000),
      status: STATUS_LABEL[site.status] ?? site.status,
    })
  }

  // Juste après la synthèse : la liste d'actions, du document le plus urgent au moins urgent.
  const toFix = workbook.addWorksheet('PDF à traiter')
  toFix.columns = [
    { header: 'Statut', key: 'status' },
    { header: 'Document', key: 'name' },
    { header: 'Pages', key: 'pageCount' },
    { header: 'Pages sans texte', key: 'pagesWithoutText' },
    { header: 'Taille (Mo)', key: 'sizeMb' },
    { header: 'Publié sur', key: 'parentUrl' },
    { header: 'URL du PDF', key: 'url' },
    { header: 'Site', key: 'site' },
    { header: 'Détail', key: 'errorMessage' },
  ]
  prepare(toFix, [26, 48, 10, 16, 12, 56, 56, 24, 32])
  for (const row of data.toFix ?? []) {
    const added = toFix.addRow({
      ...row,
      status: TRIAGE_LABELS[row.ocrStatus],
      name: documentName(row.url),
      sizeMb: row.sizeBytes == null ? null : Math.round((row.sizeBytes / 1024 / 1024) * 100) / 100,
    })
    // Liens cliquables vers le PDF et vers la page où il est publié.
    added.getCell('url').value = { text: row.url, hyperlink: row.url }
    if (row.parentUrl) added.getCell('parentUrl').value = { text: row.parentUrl, hyperlink: row.parentUrl }
    const fill = row.ocrStatus === 'image' ? 'FFF4C7C3' : row.ocrStatus === 'partial' ? 'FFF4E2C4' : 'FFE7E2D8'
    added.getCell('status').fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: fill } }
  }

  const pages = workbook.addWorksheet('Pages')
  pages.columns = [
    { header: 'Site', key: 'site' },
    { header: 'URL', key: 'url' },
    { header: 'Statut HTTP', key: 'httpStatus' },
    { header: 'Profondeur', key: 'depth' },
    { header: 'Taille (octets)', key: 'sizeBytes' },
  ]
  prepare(pages, [28, 64, 14, 14, 18])
  for (const page of data.pages) pages.addRow(page)

  const pdfs = workbook.addWorksheet('PDF')
  pdfs.columns = [
    { header: 'Site', key: 'site' },
    { header: 'URL', key: 'url' },
    { header: 'Statut OCR', key: 'ocr' },
    { header: 'Pages', key: 'pageCount' },
    { header: 'Pages avec texte', key: 'pagesWithText' },
    { header: 'Taille (octets)', key: 'sizeBytes' },
    { header: 'Publié sur', key: 'parentUrl' },
    { header: 'Balisé', key: 'taggedLabel' },
    { header: 'Titre', key: 'titleLabel' },
    { header: 'Langue', key: 'langLabel' },
  ]
  prepare(pdfs, [28, 64, 20, 12, 20, 18, 56, 10, 16, 12])
  for (const pdf of data.pdfs) {
    pdfs.addRow({ ...pdf, ocr: OCR_LABELS[pdf.ocrStatus], ...a11yLabels(pdf) })
  }
  pdfs.addConditionalFormatting({
    ref: 'C2:C5000',
    rules: [
      {
        type: 'containsText',
        operator: 'containsText',
        text: 'OCRisé / texte',
        priority: 1,
        style: { fill: { type: 'pattern', pattern: 'solid', bgColor: { argb: 'FFCDE8D6' } } },
      },
      {
        type: 'containsText',
        operator: 'containsText',
        text: 'Non OCRisé',
        priority: 2,
        style: { fill: { type: 'pattern', pattern: 'solid', bgColor: { argb: 'FFF4C7C3' } } },
      },
      {
        type: 'containsText',
        operator: 'containsText',
        text: 'Partiel',
        priority: 3,
        style: { fill: { type: 'pattern', pattern: 'solid', bgColor: { argb: 'FFF4E2C4' } } },
      },
      {
        type: 'containsText',
        operator: 'containsText',
        text: 'Erreur',
        priority: 4,
        style: { fill: { type: 'pattern', pattern: 'solid', bgColor: { argb: 'FFE7E2D8' } } },
      },
    ],
  })

  // Accessibilité : PDF contrôlés présentant au moins un défaut (balisage, titre, langue).
  const a11y = workbook.addWorksheet('Accessibilité PDF')
  a11y.columns = [
    { header: 'Document', key: 'name' },
    { header: 'Défauts', key: 'issues' },
    { header: 'Balisé', key: 'taggedLabel' },
    { header: 'Titre', key: 'titleLabel' },
    { header: 'Titre déclaré', key: 'title' },
    { header: 'Langue', key: 'langLabel' },
    { header: 'Couche texte', key: 'ocr' },
    { header: 'Publié sur', key: 'parentUrl' },
    { header: 'URL du PDF', key: 'url' },
    { header: 'Site', key: 'site' },
  ]
  prepare(a11y, [44, 40, 10, 16, 40, 12, 20, 56, 56, 24])
  const withIssues = data.pdfs
    .map((pdf) => ({ pdf, issues: a11yIssues({ tagged: pdf.tagged ?? null, titleStatus: pdf.titleStatus ?? null, lang: pdf.lang ?? null }) }))
    .filter(({ issues }) => issues.length > 0)
    .sort((a, b) => b.issues.length - a.issues.length || a.pdf.url.localeCompare(b.pdf.url))
  for (const { pdf, issues } of withIssues) {
    const added = a11y.addRow({
      ...pdf,
      ...a11yLabels(pdf),
      name: documentName(pdf.url),
      issues: issues.map((issue) => A11Y_LABELS[issue]).join(', '),
      ocr: OCR_LABELS[pdf.ocrStatus],
    })
    added.getCell('url').value = { text: pdf.url, hyperlink: pdf.url }
    if (pdf.parentUrl) added.getCell('parentUrl').value = { text: pdf.parentUrl, hyperlink: pdf.parentUrl }
  }

  const errors = workbook.addWorksheet('Erreurs')
  errors.columns = [
    { header: 'Site', key: 'site' },
    { header: 'URL', key: 'url' },
    { header: 'Type', key: 'errorType' },
    { header: 'Statut HTTP', key: 'httpStatus' },
    { header: 'Message', key: 'message' },
  ]
  prepare(errors, [28, 64, 24, 14, 48])
  for (const error of data.errors) errors.addRow(error)

  const raw = await workbook.xlsx.writeBuffer()
  return Buffer.from(raw)
}
