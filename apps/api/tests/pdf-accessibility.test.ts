import { describe, expect, it } from 'vitest'
import { a11yIssues, parseA11yIssues, titleStatus } from '../src/lib/pdf-accessibility'

describe('accessibilité des PDF', () => {
  it('distingue un titre absent, non pertinent ou correct', () => {
    expect(titleStatus(null)).toBe('missing')
    expect(titleStatus('   ')).toBe('missing')
    expect(titleStatus('Microsoft Word - CR conseil.docx')).toBe('generic')
    expect(titleStatus('rapport_final.pdf')).toBe('generic')
    expect(titleStatus('«Titre» «Prenoms» «Nom_»')).toBe('generic')
    expect(titleStatus('Sans titre')).toBe('generic')
    expect(titleStatus('Diapositive 1')).toBe('generic')
    expect(titleStatus('Compte rendu du conseil municipal du 14 novembre 2022')).toBe('ok')
    expect(titleStatus('Acquisitions Jeunesse 2022-07 et 08')).toBe('ok')
  })

  it('liste les défauts, rien pour un PDF pas encore contrôlé', () => {
    expect(a11yIssues({ tagged: null, titleStatus: null, lang: null })).toEqual([])
    expect(a11yIssues({ tagged: false, titleStatus: 'generic', lang: null })).toEqual(['untagged', 'notitle', 'nolang'])
    expect(a11yIssues({ tagged: true, titleStatus: 'ok', lang: 'fr-FR' })).toEqual([])
  })

  it('lit les défauts demandés, tous par défaut', () => {
    expect(parseA11yIssues(undefined)).toEqual(['untagged', 'notitle', 'nolang'])
    expect(parseA11yIssues('nolang,inconnu')).toEqual(['nolang'])
  })
})

describe('métadonnées mal encodées', () => {
  it('répare le motif UTF-8 lu comme Latin-1, sans toucher au reste', async () => {
    const { repairMojibake } = await import('../src/modules/pdf-analyzer/analyze')
    expect(repairMojibake('Liste_des_achats_de_livres_fÃ©vrier_2026')).toBe('Liste_des_achats_de_livres_février_2026')
    expect(repairMojibake('Procès-verbal du conseil')).toBe('Procès-verbal du conseil')
    expect(repairMojibake('Ã la carte « menu »')).toBe('Ã la carte « menu »')
  })
})
