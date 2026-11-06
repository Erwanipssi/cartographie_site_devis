import { describe, expect, it } from 'vitest'
import { comparePages, comparePdfs, type PdfSnapshot } from '../src/lib/evolution'

const pdf = (url: string, overrides: Partial<PdfSnapshot> = {}): PdfSnapshot => ({
  url: `https://ex.fr/${url}`,
  ocrStatus: 'text',
  tagged: true,
  titleStatus: 'ok',
  lang: 'fr-FR',
  pageCount: 2,
  pagesWithoutText: 0,
  parentUrl: null,
  ...overrides,
})

describe('évolution entre deux analyses', () => {
  it('repère les PDF apparus et disparus', () => {
    const result = comparePdfs([pdf('a.pdf'), pdf('b.pdf')], [pdf('b.pdf'), pdf('c.pdf')])
    expect(result.added.map((item) => item.url)).toEqual(['https://ex.fr/c.pdf'])
    expect(result.removed.map((item) => item.url)).toEqual(['https://ex.fr/a.pdf'])
  })

  it('classe les changements de couche texte, sans tenir compte des erreurs', () => {
    const result = comparePdfs(
      [pdf('ocr.pdf', { ocrStatus: 'image' }), pdf('mieux.pdf', { ocrStatus: 'partial' }), pdf('pire.pdf'), pdf('err.pdf', { ocrStatus: 'image' })],
      [pdf('ocr.pdf'), pdf('mieux.pdf'), pdf('pire.pdf', { ocrStatus: 'partial' }), pdf('err.pdf', { ocrStatus: 'error' })],
    )
    expect(result.textFixed.map((item) => [item.url.split('/').pop(), item.before.ocrStatus])).toEqual([
      ['mieux.pdf', 'partial'],
      ['ocr.pdf', 'image'],
    ])
    expect(result.textRegressed.map((item) => item.url.split('/').pop())).toEqual(['pire.pdf'])
  })

  it('compare l’accessibilité seulement quand les deux analyses l’ont contrôlée', () => {
    const result = comparePdfs(
      [pdf('balise.pdf', { tagged: false, lang: null }), pdf('jamais.pdf', { tagged: null }), pdf('casse.pdf')],
      [pdf('balise.pdf', { lang: null }), pdf('jamais.pdf', { tagged: false }), pdf('casse.pdf', { titleStatus: 'missing' })],
    )
    expect(result.a11yImproved.map((item) => item.url.split('/').pop())).toEqual(['balise.pdf'])
    expect(result.a11yRegressed.map((item) => item.url.split('/').pop())).toEqual(['casse.pdf'])
  })

  it('repère les pages apparues et disparues', () => {
    expect(comparePages(['a', 'b'], ['b', 'c', 'd'])).toEqual({ added: ['c', 'd'], removed: ['a'] })
  })
})
