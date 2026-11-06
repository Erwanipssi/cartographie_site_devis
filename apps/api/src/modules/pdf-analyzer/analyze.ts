import { createRequire } from 'node:module'
import { pathToFileURL } from 'node:url'
import { classifyOcr, usefulCharCount } from '../../lib/ocr'

export type PdfInspection = {
  ocrStatus: 'text' | 'image' | 'partial' | 'error'
  pageCount: number
  pagesWithText: number
  pagesWithoutText: number
  errorMessage: string | null
  /** Accessibilité (RGAA, documents bureautiques) : structure balisée, titre et langue déclarés. */
  tagged: boolean
  title: string | null
  lang: string | null
}

type TextItem = { str?: string }
type StructNode = { children?: unknown[] } | null

/** Pages examinées pour détecter le balisage : une couverture purement décorative peut ne porter aucune balise. */
const TAG_PROBE_PAGES = 3

type DocumentFacts = { charCounts: number[]; tagged: boolean; title: string | null; lang: string | null }

async function inspectDocument(bytes: Uint8Array): Promise<DocumentFacts> {
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
  const charCounts: number[] = []
  let tagged = false
  try {
    for (let pageNumber = 1; pageNumber <= document.numPages; pageNumber += 1) {
      const page = await document.getPage(pageNumber)
      const content = await page.getTextContent()
      const text = content.items.map((item) => ('str' in item ? String((item as TextItem).str ?? '') : '')).join(' ')
      charCounts.push(usefulCharCount(text))
      // Un PDF balisé expose un arbre de structure (titres, paragraphes, listes…) que lisent les lecteurs d'écran.
      if (!tagged && pageNumber <= TAG_PROBE_PAGES) {
        const tree = (await page.getStructTree().catch(() => null)) as StructNode
        tagged = Boolean(tree?.children?.length)
      }
    }
    const { info, metadata } = await document.getMetadata().catch(() => ({ info: {}, metadata: null }))
    const facts = info as { Title?: unknown; Language?: unknown }
    const xmpTitle = metadata?.get('dc:title')
    return {
      charCounts,
      tagged,
      title: cleanText(facts.Title) ?? cleanText(xmpTitle),
      lang: cleanText(facts.Language),
    }
  } finally {
    await document.destroy()
  }
}

function cleanText(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const text = repairMojibake(value).replace(/\s+/g, ' ').trim()
  return text ? text.slice(0, 300) : null
}

/**
 * Certains logiciels écrivent les métadonnées en UTF-8 là où le PDF attend du Latin-1 : « février » devient
 * « fÃ©vrier ». On ne corrige que ce motif reconnaissable, et seulement si le décodage UTF-8 est propre.
 */
export function repairMojibake(text: string): string {
  if (!looksLikeMojibake(text) || hasCharAbove(text, 0xff)) return text
  const repaired = Buffer.from(text, 'latin1').toString('utf8')
  return repaired.includes(REPLACEMENT_CHAR) ? text : repaired
}

/** Caractère de remplacement Unicode : signe d'un décodage UTF-8 raté. */
const REPLACEMENT_CHAR = String.fromCharCode(0xfffd)

/** « Ã » ou « Â » (0xC3, 0xC2) suivi d'un octet de continuation UTF-8 (0x80-0xBF) lu comme Latin-1. */
function looksLikeMojibake(text: string): boolean {
  for (let index = 0; index < text.length - 1; index += 1) {
    const lead = text.charCodeAt(index)
    const next = text.charCodeAt(index + 1)
    if ((lead === 0xc3 || lead === 0xc2) && next >= 0x80 && next <= 0xbf) return true
  }
  return false
}

function hasCharAbove(text: string, max: number): boolean {
  for (let index = 0; index < text.length; index += 1) if (text.charCodeAt(index) > max) return true
  return false
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
  const facts = await inspectDocument(new Uint8Array(bytes))
  const { charCounts } = facts
  const ocrStatus = classifyOcr(charCounts, options)
  const pagesWithText = charCounts.filter((count) => count >= options.minChars).length
  return {
    ocrStatus,
    pageCount: charCounts.length,
    pagesWithText,
    pagesWithoutText: Math.max(0, charCounts.length - pagesWithText),
    errorMessage: ocrStatus === 'error' ? 'PDF sans page lisible' : null,
    tagged: facts.tagged,
    title: facts.title,
    lang: facts.lang,
  }
}
