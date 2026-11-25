/**
 * Arborescence d'un site : les pages rangées selon le chemin de leur URL, et chaque PDF
 * rattaché à la page qui le publie (sa page parente), ou à défaut rangé selon son propre chemin.
 * Chaque nœud porte les totaux de son sous-arbre, pour lire d'un coup d'œil où sont les PDF à traiter.
 */

export type TreeEntry =
  | { kind: 'page'; url: string; httpStatus: number | null }
  | {
      kind: 'pdf'
      url: string
      httpStatus: number | null
      parentUrl: string | null
      ocrStatus: string
      pageCount: number | null
      pagesWithoutText: number | null
    }

export type TreeStats = {
  /** Pages HTML du sous-arbre (le nœud compris). */
  pages: number
  pdfs: number
  /** Pages contenues dans les PDF du sous-arbre. */
  pdfPages: number
  /** PDF sans couche texte complète (non OCRisés ou partiels). */
  toFix: number
  /** Pages ou PDF en erreur HTTP (ou illisibles). */
  errors: number
}

export type TreePdf = { url: string; name: string; ocrStatus: string; pageCount: number | null; httpStatus: number | null }

export type TreeNode = {
  /** Segment de chemin affiché (« / » pour la racine). */
  name: string
  path: string
  /** URL de la page si ce chemin est une page du site, sinon null (simple dossier). */
  url: string | null
  httpStatus: number | null
  pdfs: TreePdf[]
  children: TreeNode[]
  stats: TreeStats
}

const TO_FIX = new Set(['image', 'partial'])

const PAGE_EXTENSION = /\.(html?|php|aspx?|jsp)$/i
// Identifiant de page TYPO3 : « 680 », ou « 190-349 » pour une fiche d'annuaire.
const NUMERIC = /^\d+(?:[-_]\d+)*$/

function rawSegments(url: string): string[] | null {
  try {
    const parsed = new URL(url)
    const segments = parsed.pathname
      .split('/')
      .filter(Boolean)
      .map((segment) => {
        try {
          return decodeURIComponent(segment)
        } catch {
          return segment
        }
      })
    // La requête distingue des pages différentes (?page=2) : elle devient un dernier segment.
    if (parsed.search) segments.push(parsed.search)
    return segments
  } catch {
    return null
  }
}

/**
 * Segments qui rangent une page : sans l'extension (« kiosque.htm » et « kiosque/… » sont la même rubrique)
 * ni, si le CMS en préfixe ses URL (TYPO3 : /680/ma-ville/…), l'identifiant numérique de tête.
 */
function pageSegments(segments: string[], stripId: boolean): string[] {
  const rest = stripId && segments.length > 1 && NUMERIC.test(segments[0]!) ? segments.slice(1) : [...segments]
  const last = rest.length - 1
  if (last >= 0) rest[last] = rest[last]!.replace(PAGE_EXTENSION, '')
  return rest
}

function emptyNode(name: string, path: string): TreeNode {
  return { name, path, url: null, httpStatus: null, pdfs: [], children: [], stats: { pages: 0, pdfs: 0, pdfPages: 0, toFix: 0, errors: 0 } }
}

const isError = (status: number | null) => status != null && (status < 200 || status >= 400)

export function buildSiteTree(entries: TreeEntry[]): TreeNode {
  const root = emptyNode('/', '/')
  const childIndex = new Map<TreeNode, Map<string, TreeNode>>()
  const pageNodeByUrl = new Map<string, TreeNode>()

  const nodeFor = (segments: string[]): TreeNode => {
    let node = root
    let path = ''
    for (const segment of segments) {
      path += `/${segment}`
      let children = childIndex.get(node)
      if (!children) {
        children = new Map()
        childIndex.set(node, children)
      }
      let child = children.get(segment)
      if (!child) {
        child = emptyNode(segment, path)
        children.set(segment, child)
        node.children.push(child)
      }
      node = child
    }
    return node
  }

  const pages = entries.flatMap((entry) => {
    const segments = entry.kind === 'page' ? rawSegments(entry.url) : null
    return segments ? [{ entry, segments }] : []
  })
  // Identifiant de tête retiré seulement si c'est la convention du site (la majorité de ses pages).
  const withId = pages.filter(({ segments }) => segments.length > 1 && NUMERIC.test(segments[0]!)).length
  const stripId = withId > 0 && withId >= pages.length / 2

  for (const { entry, segments } of pages) {
    const path = pageSegments(segments, stripId)
    let node = nodeFor(path)
    // Même chemin, autre identifiant : une autre page, distinguée par son identifiant.
    if (node.url && node.url !== entry.url && path.length > 0) {
      node = nodeFor([...path.slice(0, -1), `${path.at(-1)} (${segments[0]})`])
    }
    node.url = entry.url
    node.httpStatus = entry.httpStatus
    pageNodeByUrl.set(entry.url, node)
  }

  for (const entry of entries) {
    if (entry.kind !== 'pdf') continue
    const segments = rawSegments(entry.url)
    if (!segments) continue
    const parent = (entry.parentUrl ? pageNodeByUrl.get(entry.parentUrl) : undefined) ?? nodeFor(segments.slice(0, -1))
    parent.pdfs.push({
      url: entry.url,
      name: segments.at(-1) ?? entry.url,
      ocrStatus: entry.ocrStatus,
      pageCount: entry.pageCount,
      httpStatus: entry.httpStatus,
    })
  }

  const finish = (node: TreeNode): TreeStats => {
    const stats: TreeStats = { pages: node.url ? 1 : 0, pdfs: node.pdfs.length, pdfPages: 0, toFix: 0, errors: isError(node.httpStatus) ? 1 : 0 }
    for (const pdf of node.pdfs) {
      stats.pdfPages += pdf.pageCount ?? 0
      if (TO_FIX.has(pdf.ocrStatus)) stats.toFix += 1
      if (pdf.ocrStatus === 'error' || isError(pdf.httpStatus)) stats.errors += 1
    }
    node.pdfs.sort((a, b) => a.name.localeCompare(b.name, 'fr'))
    // Dossiers les plus fournis d'abord : c'est là que l'œil doit aller.
    for (const child of node.children) {
      const sub = finish(child)
      stats.pages += sub.pages
      stats.pdfs += sub.pdfs
      stats.pdfPages += sub.pdfPages
      stats.toFix += sub.toFix
      stats.errors += sub.errors
    }
    node.children.sort((a, b) => b.stats.pages + b.stats.pdfs - (a.stats.pages + a.stats.pdfs) || a.name.localeCompare(b.name, 'fr'))
    node.stats = stats
    return stats
  }
  finish(root)
  return root
}
