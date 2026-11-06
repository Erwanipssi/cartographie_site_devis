import { describe, expect, it } from 'vitest'
import { documentName, parseTriageStatuses, sortForTriage, triageCsv, type TriageRow } from '../src/lib/pdf-triage'

const row = (overrides: Partial<TriageRow>): TriageRow => ({
  site: 'ex.fr',
  url: 'https://ex.fr/doc.pdf',
  ocrStatus: 'image',
  pageCount: 10,
  pagesWithoutText: 10,
  sizeBytes: 1_048_576,
  parentUrl: 'https://ex.fr/page',
  errorMessage: null,
  ...overrides,
})

describe('PDF à traiter', () => {
  it('lit les statuts demandés, avec image + partiel par défaut', () => {
    expect(parseTriageStatuses(undefined)).toEqual(['image', 'partial'])
    expect(parseTriageStatuses('error,image')).toEqual(['image', 'error'])
    expect(parseTriageStatuses('text,inconnu')).toEqual(['image', 'partial'])
  })

  it('donne un nom de document lisible', () => {
    expect(documentName('https://ex.fr/docs/Compte%20rendu%20CM.pdf')).toBe('Compte rendu CM.pdf')
    expect(documentName('https://ex.fr/docs/rapport.PDF?v=2')).toBe('rapport.PDF')
    expect(documentName('https://ex.fr/docs/mal%E0form%C3.pdf')).toBe('mal%E0form%C3.pdf')
  })

  it('trie du plus urgent au moins urgent', () => {
    const sorted = sortForTriage([
      row({ url: 'https://ex.fr/partiel.pdf', ocrStatus: 'partial', pagesWithoutText: 50 }),
      row({ url: 'https://ex.fr/illisible.pdf', ocrStatus: 'error', pagesWithoutText: null }),
      row({ url: 'https://ex.fr/petit.pdf', ocrStatus: 'image', pagesWithoutText: 2 }),
      row({ url: 'https://ex.fr/gros.pdf', ocrStatus: 'image', pagesWithoutText: 120 }),
    ])
    expect(sorted.map((item) => documentName(item.url))).toEqual(['gros.pdf', 'petit.pdf', 'partiel.pdf', 'illisible.pdf'])
  })

  it('produit un CSV lisible par Excel en français', () => {
    const csv = triageCsv([row({ url: 'https://ex.fr/a;b.pdf', errorMessage: 'Délai "dépassé"' })])
    expect(csv.charCodeAt(0)).toBe(0xfeff)
    const [header, line] = csv.slice(1).split('\r\n')
    expect(header).toBe('Statut;Document;Pages;Pages sans texte;Taille (Mo);Publié sur;URL du PDF;Site;Détail')
    expect(line).toBe('Non OCRisé — à reprendre;"a;b.pdf";10;10;1,00;https://ex.fr/page;"https://ex.fr/a;b.pdf";ex.fr;"Délai ""dépassé"""')
  })
})
