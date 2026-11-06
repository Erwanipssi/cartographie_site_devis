import ExcelJS from 'exceljs'
import { OCR_LABELS, type OcrStatus } from '@cartographie/shared'

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
  ]
  prepare(pdfs, [28, 64, 20, 12, 20, 18])
  for (const pdf of data.pdfs) {
    pdfs.addRow({ ...pdf, ocr: OCR_LABELS[pdf.ocrStatus] })
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
