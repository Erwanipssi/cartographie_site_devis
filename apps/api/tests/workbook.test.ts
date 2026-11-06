import { describe, expect, it } from 'vitest'
import { buildWorkbook } from '../src/modules/exporter/workbook'

describe('buildWorkbook', () => {
  it('produit les cinq feuilles et le libellé OCR', async () => {
    const buffer = await buildWorkbook({
      sites: [
        {
          hostname: 'example.com',
          url: 'https://example.com/',
          htmlCount: 3,
          pdfCount: 1,
          pdfTextCount: 1,
          pdfImageCount: 0,
          pdfPartialCount: 0,
          pdfErrorCount: 0,
          otherCount: 0,
          errorCount: 0,
          durationMs: 1500,
          status: 'completed',
        },
      ],
      pages: [{ site: 'example.com', url: 'https://example.com/', httpStatus: 200, depth: 0, sizeBytes: 100 }],
      pdfs: [
        {
          site: 'example.com',
          url: 'https://example.com/a.pdf',
          ocrStatus: 'image',
          pageCount: 2,
          pagesWithText: 0,
          sizeBytes: 2000,
        },
      ],
      errors: [{ site: 'example.com', url: 'https://example.com/404', errorType: 'http', httpStatus: 404, message: 'HTTP 404' }],
    })
    const ExcelJS = await import('exceljs')
    const workbook = new ExcelJS.Workbook()
    await workbook.xlsx.load(buffer as never)
    expect(workbook.worksheets.map((sheet) => sheet.name)).toEqual(['Synthèse', 'PDF à traiter', 'Pages', 'PDF', 'Erreurs'])
    expect(workbook.getWorksheet('PDF')?.getCell('C2').value).toBe('Non OCRisé')
    expect(workbook.getWorksheet('Synthèse')?.getCell('A1').value).toBe('Site')
  })
})
