import { createRequire } from 'node:module'
import { pathToFileURL } from 'node:url'
import { classifyOcr, usefulCharCount } from '../../lib/ocr'

export type PdfInspection = {
  ocrStatus: 'text' | 'image' | 'partial' | 'error'
  pageCount: number
  pagesWithText: number
  pagesWithoutText: number
  errorMessage: string | null
}

type TextItem = { str?: string }

async function pageCharCounts(bytes: Uint8Array): Promise<number[]> {
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs')
  const require = createRequire(import.meta.url)
  const workerPath = require.resolve('pdfjs-dist/legacy/build/pdf.worker.mjs')
  pdfjs.GlobalWorkerOptions.workerSrc = pathToFileURL(workerPath).href
  const document = await pdfjs
    .getDocument({
      data: bytes,
      isEvalSupported: false,
      useSystemFonts: true,
      verbosity: 0,
    })
    .promise
  const counts: number[] = []
  try {
    for (let pageNumber = 1; pageNumber <= document.numPages; pageNumber += 1) {
      const page = await document.getPage(pageNumber)
      const content = await page.getTextContent()
      const text = content.items.map((item) => ('str' in item ? String((item as TextItem).str ?? '') : '')).join(' ')
      counts.push(usefulCharCount(text))
    }
  } finally {
    await document.destroy()
  }
  return counts
}

export function pdfFailureMessage(error: unknown): string {
  const name = (error as { name?: string }).name ?? ''
  const message = error instanceof Error ? error.message : ''
  if (name === 'PasswordException' || /password/i.test(message)) return 'PDF protégé par mot de passe'
  if (/invalid pdf|xref|format/i.test(message)) return 'PDF corrompu ou illisible'
  return message || 'PDF illisible'
}

export async function analyzePdfBuffer(
  bytes: Uint8Array,
  options: { minChars: number; textRatio: number; imageRatio: number },
): Promise<PdfInspection> {
  // pdf.js peut s'approprier le tampon reçu : on lui passe une copie, sans aller-retour disque.
  const charCounts = await pageCharCounts(new Uint8Array(bytes))
  const ocrStatus = classifyOcr(charCounts, options)
  const pagesWithText = charCounts.filter((count) => count >= options.minChars).length
  return {
    ocrStatus,
    pageCount: charCounts.length,
    pagesWithText,
    pagesWithoutText: Math.max(0, charCounts.length - pagesWithText),
    errorMessage: ocrStatus === 'error' ? 'PDF sans page lisible' : null,
  }
}
