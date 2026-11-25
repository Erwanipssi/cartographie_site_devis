import { describe, expect, it } from 'vitest'
import { buildSiteTree, type TreeNode } from '../src/lib/site-tree'

const find = (node: TreeNode, path: string): TreeNode | undefined =>
  node.path === path ? node : node.children.map((child) => find(child, path)).find(Boolean)

describe('buildSiteTree', () => {
  const tree = buildSiteTree([
    { kind: 'page', url: 'https://ex.fr/', httpStatus: 200 },
    { kind: 'page', url: 'https://ex.fr/mairie', httpStatus: 200 },
    { kind: 'page', url: 'https://ex.fr/mairie/conseil', httpStatus: 200 },
    { kind: 'page', url: 'https://ex.fr/mairie/vieille', httpStatus: 404 },
    { kind: 'page', url: 'https://ex.fr/agenda?page=2', httpStatus: 200 },
    { kind: 'pdf', url: 'https://ex.fr/fileadmin/pv%20du%20conseil.pdf', httpStatus: 200, parentUrl: 'https://ex.fr/mairie/conseil', ocrStatus: 'image', pageCount: 4, pagesWithoutText: 4 },
    { kind: 'pdf', url: 'https://ex.fr/fileadmin/orphelin.pdf', httpStatus: 200, parentUrl: null, ocrStatus: 'text', pageCount: 2, pagesWithoutText: 0 },
  ])

  it('range les pages par chemin et rattache chaque PDF à la page qui le publie', () => {
    const conseil = find(tree, '/mairie/conseil')!
    expect(conseil.url).toBe('https://ex.fr/mairie/conseil')
    expect(conseil.pdfs.map((pdf) => pdf.name)).toEqual(['pv du conseil.pdf'])
    // Sans page parente connue, le PDF suit son propre chemin.
    expect(find(tree, '/fileadmin')!.pdfs.map((pdf) => pdf.name)).toEqual(['orphelin.pdf'])
    expect(find(tree, '/agenda/?page=2')?.url).toBe('https://ex.fr/agenda?page=2')
  })

  it('additionne les totaux de chaque branche', () => {
    expect(tree.stats).toEqual({ pages: 5, pdfs: 2, pdfPages: 6, toFix: 1, errors: 1 })
    expect(find(tree, '/mairie')!.stats).toEqual({ pages: 3, pdfs: 1, pdfPages: 4, toFix: 1, errors: 1 })
    // Branche la plus fournie en premier.
    expect(tree.children[0]!.name).toBe('mairie')
  })

  it('fusionne « rubrique.htm » et « rubrique/… », et ignore l’identifiant TYPO3 de tête', () => {
    const typo3 = buildSiteTree([
      { kind: 'page', url: 'https://ex.fr/', httpStatus: 200 },
      { kind: 'page', url: 'https://ex.fr/120/kiosque.htm', httpStatus: 200 },
      { kind: 'page', url: 'https://ex.fr/176/kiosque/archives-buc-info.htm', httpStatus: 200 },
      { kind: 'page', url: 'https://ex.fr/51/ma-ville/marches-publics.htm', httpStatus: 200 },
      { kind: 'page', url: 'https://ex.fr/190-349/ma-ville/elus/ficheAnnu/jean-dupont.htm', httpStatus: 200 },
    ])
    expect(typo3.children.map((child) => child.name)).toEqual(['kiosque', 'ma-ville'])
    const kiosque = typo3.children[0]!
    expect(kiosque.url).toBe('https://ex.fr/120/kiosque.htm')
    expect(kiosque.children.map((child) => child.name)).toEqual(['archives-buc-info'])
    // Deux pages au même chemin sous deux identifiants restent deux pages.
    const twins = buildSiteTree([
      { kind: 'page', url: 'https://ex.fr/10/agenda/fete.htm', httpStatus: 200 },
      { kind: 'page', url: 'https://ex.fr/11/agenda/fete.htm', httpStatus: 200 },
    ])
    expect(twins.stats.pages).toBe(2)
  })
})
