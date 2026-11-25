/**
 * Arborescence d'un site : les branches dépliables, chacune avec ses totaux (pages, PDF, pages PDF,
 * PDF à traiter, erreurs), et les PDF rattachés à la page qui les publie.
 */
import { OCR_LABELS } from '@cartographie/shared'
import { ChevronRight, ChevronsDownUp, ChevronsUpDown, ExternalLink, FileText, Folder, FolderOpen, House, Search, TriangleAlert } from 'lucide-react'
import { AnimatePresence, motion } from 'motion/react'
import { useMemo, useState } from 'react'
import { Bar, BarChart, Cell, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import type { TreeNode, TreePdf } from '../lib/api'
import { integer, OCR_COLORS } from './ui'

type Filter = 'all' | 'toFix' | 'errors'

const FILTERS: Array<{ id: Filter; label: string }> = [
  { id: 'all', label: 'Tout' },
  { id: 'toFix', label: 'PDF à traiter' },
  { id: 'errors', label: 'Erreurs' },
]

const PDF_PREVIEW = 40
const TO_FIX = new Set(['image', 'partial'])

/** « a-votre-service » → « A votre service » ; les requêtes (?page=2) restent telles quelles. */
export function humanize(segment: string): string {
  if (segment.startsWith('?')) return segment
  const text = segment.replace(/[-_]+/g, ' ').trim()
  return text ? text.charAt(0).toUpperCase() + text.slice(1) : segment
}

function allPaths(node: TreeNode, into: Set<string> = new Set()): Set<string> {
  if (node.children.length || node.pdfs.length) into.add(node.path)
  for (const child of node.children) allPaths(child, into)
  return into
}

/** Chemins à montrer pour la recherche et le filtre : les nœuds retenus et tous leurs ancêtres. */
function visiblePaths(root: TreeNode, query: string, filter: Filter): Set<string> | null {
  if (!query && filter === 'all') return null
  const needle = query.toLowerCase()
  const keep = new Set<string>()
  const walk = (node: TreeNode): boolean => {
    const passesFilter = filter === 'all' || (filter === 'toFix' ? node.stats.toFix > 0 : node.stats.errors > 0)
    if (!passesFilter) return false
    const selfMatch = !needle || node.path.toLowerCase().includes(needle) || node.pdfs.some((pdf) => pdf.name.toLowerCase().includes(needle))
    let childMatch = false
    for (const child of node.children) if (walk(child)) childMatch = true
    if (selfMatch || childMatch) keep.add(node.path)
    return selfMatch || childMatch
  }
  walk(root)
  return keep
}

export function SiteTree({ tree }: { tree: TreeNode }) {
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set([tree.path]))
  const [query, setQuery] = useState('')
  const [filter, setFilter] = useState<Filter>('all')
  const [showPdfs, setShowPdfs] = useState(true)
  const visible = useMemo(() => visiblePaths(tree, query.trim(), filter), [tree, query, filter])
  // Pendant une recherche ou un filtre, les branches retenues s'ouvrent d'elles-mêmes.
  const isOpen = (path: string) => expanded.has(path) || (visible?.has(path) ?? false)
  const toggle = (path: string) =>
    setExpanded((current) => {
      const next = new Set(current)
      if (next.has(path)) next.delete(path)
      else next.add(path)
      return next
    })
  const focus = (path: string) => {
    setExpanded((current) => new Set([...current, tree.path, path]))
    requestAnimationFrame(() => document.getElementById(`tree-${path}`)?.scrollIntoView({ behavior: 'smooth', block: 'center' }))
  }

  return (
    <div className="space-y-4">
      <Sections tree={tree} onPick={focus} />
      <div className="card space-y-3 p-0">
        <div className="flex flex-wrap items-center gap-2 border-b border-line p-3">
          <label className="relative min-w-[220px] flex-1">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-400" aria-hidden />
            <input className="field pl-8" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Rechercher un chemin ou un PDF" aria-label="Rechercher dans l’arborescence" />
          </label>
          <div className="flex rounded-md border border-line bg-paper p-0.5" role="radiogroup" aria-label="Filtrer les branches">
            {FILTERS.map((item) => (
              <button
                key={item.id}
                type="button"
                role="radio"
                aria-checked={filter === item.id}
                onClick={() => setFilter(item.id)}
                className={`rounded px-2.5 py-1 text-xs font-medium transition-colors ${filter === item.id ? 'bg-card text-ink-950 shadow-sm ring-1 ring-line' : 'text-ink-600 hover:text-ink-950'}`}
              >
                {item.label}
              </button>
            ))}
          </div>
          <label className="flex cursor-pointer items-center gap-1.5 px-1 text-xs font-medium text-ink-800">
            <input type="checkbox" className="accent-ink-950" checked={showPdfs} onChange={(event) => setShowPdfs(event.target.checked)} />
            PDF
          </label>
          <button type="button" className="btn-ghost h-8 px-2.5 text-xs" onClick={() => setExpanded(allPaths(tree))} title="Tout déplier">
            <ChevronsUpDown className="h-3.5 w-3.5" aria-hidden /> Déplier
          </button>
          <button type="button" className="btn-ghost h-8 px-2.5 text-xs" onClick={() => setExpanded(new Set([tree.path]))} title="Tout replier">
            <ChevronsDownUp className="h-3.5 w-3.5" aria-hidden /> Replier
          </button>
        </div>
        <div className="hidden grid-cols-[minmax(0,1fr)_repeat(4,72px)] gap-2 px-3 text-[11px] font-medium uppercase tracking-wide text-ink-400 md:grid">
          <span>Chemin</span>
          <span className="text-right">Pages</span>
          <span className="text-right">PDF</span>
          <span className="text-right">Pages PDF</span>
          <span className="text-right">À traiter</span>
        </div>
        <ul className="pb-2" role="tree" aria-label="Arborescence du site">
          {visible && visible.size === 0 ? <li className="px-3 py-6 text-center text-sm text-ink-600">Aucune branche ne correspond.</li> : null}
          {!visible || visible.has(tree.path) ? (
            <TreeRow node={tree} depth={0} isOpen={isOpen} toggle={toggle} visible={visible} showPdfs={showPdfs} query={query.trim().toLowerCase()} filter={filter} rootSize={tree.stats.pages + tree.stats.pdfs} />
          ) : null}
        </ul>
      </div>
    </div>
  )
}

/** Les rubriques de premier niveau, classées par volume : la carte du site en un coup d'œil. */
function Sections({ tree, onPick }: { tree: TreeNode; onPick: (path: string) => void }) {
  const data = tree.children.slice(0, 10).map((child) => ({
    path: child.path,
    name: (() => {
      const label = humanize(child.name)
      return label.length > 28 ? `${label.slice(0, 27)}…` : label
    })(),
    pages: child.stats.pages,
    pdfs: child.stats.pdfs,
    toFix: child.stats.toFix,
  }))
  if (data.length < 2) return null
  return (
    <section className="card">
      <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-sm">Rubriques principales</h2>
        <p className="text-xs text-ink-600">Cliquez une rubrique pour l’ouvrir dans l’arborescence</p>
      </div>
      <div style={{ height: data.length * 30 + 10 }}>
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={data} layout="vertical" margin={{ top: 0, right: 16, bottom: 0, left: 0 }} barCategoryGap={6}>
            <XAxis type="number" hide />
            <YAxis type="category" dataKey="name" width={150} tickLine={false} axisLine={false} tick={{ fontSize: 12, fill: '#3f3f46' }} />
            <Tooltip
              cursor={{ fill: '#f4f4f5' }}
              contentStyle={{ borderRadius: 8, border: '1px solid #e4e4e7', fontSize: 12, boxShadow: '0 4px 12px rgb(0 0 0 / 0.06)' }}
              formatter={(value, name) => [integer.format(Number(value)), name === 'pages' ? 'Pages' : 'PDF']}
            />
            <Bar dataKey="pages" stackId="a" fill="#18181b" radius={[0, 0, 0, 0]} onClick={(entry) => onPick((entry as unknown as { path: string }).path)} className="cursor-pointer" />
            <Bar dataKey="pdfs" stackId="a" radius={[0, 4, 4, 0]} onClick={(entry) => onPick((entry as unknown as { path: string }).path)} className="cursor-pointer">
              {data.map((entry) => (
                <Cell key={entry.path} fill={entry.toFix > 0 ? OCR_COLORS.partial : '#a1a1aa'} />
              ))}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>
      <ul className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-ink-600">
        <li className="flex items-center gap-1.5">
          <span className="h-2 w-2 rounded-sm bg-ink-950" aria-hidden /> Pages
        </li>
        <li className="flex items-center gap-1.5">
          <span className="h-2 w-2 rounded-sm bg-ink-400" aria-hidden /> PDF
        </li>
        <li className="flex items-center gap-1.5">
          <span className="h-2 w-2 rounded-sm" style={{ backgroundColor: OCR_COLORS.partial }} aria-hidden /> PDF, dont certains à traiter
        </li>
      </ul>
    </section>
  )
}

type RowProps = {
  node: TreeNode
  depth: number
  isOpen: (path: string) => boolean
  toggle: (path: string) => void
  visible: Set<string> | null
  showPdfs: boolean
  query: string
  filter: Filter
  rootSize: number
}

function Num({ value, tone }: { value: number; tone?: string }) {
  return <span className={`text-right text-xs tabular-nums ${value === 0 ? 'text-ink-400' : (tone ?? 'text-ink-800')}`}>{value === 0 ? '·' : integer.format(value)}</span>
}

function TreeRow({ node, depth, isOpen, toggle, visible, showPdfs, query, filter, rootSize }: RowProps) {
  const [allPdfs, setAllPdfs] = useState(false)
  const expandable = node.children.length > 0 || (showPdfs && node.pdfs.length > 0)
  const open = expandable && isOpen(node.path)
  const children = visible ? node.children.filter((child) => visible.has(child.path)) : node.children
  const pdfs = showPdfs
    ? node.pdfs.filter(
        (pdf) =>
          (!query || pdf.name.toLowerCase().includes(query) || node.path.toLowerCase().includes(query)) &&
          (filter === 'all' || (filter === 'toFix' ? TO_FIX.has(pdf.ocrStatus) : pdf.ocrStatus === 'error' || (pdf.httpStatus != null && pdf.httpStatus >= 400))),
      )
    : []
  const shownPdfs = allPdfs ? pdfs : pdfs.slice(0, PDF_PREVIEW)
  const weight = rootSize > 0 ? ((node.stats.pages + node.stats.pdfs) / rootSize) * 100 : 0
  const Icon = depth === 0 ? House : node.children.length === 0 && node.url ? FileText : open ? FolderOpen : Folder
  const broken = node.httpStatus != null && (node.httpStatus < 200 || node.httpStatus >= 400)

  return (
    <li role="treeitem" aria-expanded={expandable ? open : undefined} aria-level={depth + 1}>
      <div
        id={`tree-${node.path}`}
        className="group grid grid-cols-[minmax(0,1fr)_auto] items-center gap-2 px-3 py-1 hover:bg-paper md:grid-cols-[minmax(0,1fr)_repeat(4,72px)]"
      >
        <div className="flex min-w-0 items-center gap-1" style={{ paddingLeft: depth * 16 }}>
          <button
            type="button"
            className={`grid h-5 w-5 shrink-0 place-items-center rounded text-ink-400 hover:bg-line hover:text-ink-950 ${expandable ? '' : 'invisible'}`}
            onClick={() => toggle(node.path)}
            aria-label={open ? 'Replier' : 'Déplier'}
          >
            <ChevronRight className={`h-3.5 w-3.5 transition-transform duration-150 ${open ? 'rotate-90' : ''}`} />
          </button>
          <Icon className={`h-4 w-4 shrink-0 ${depth === 0 ? 'text-ink-950' : 'text-ink-400'}`} aria-hidden />
          <button type="button" className="min-w-0 truncate text-left text-sm text-ink-950" onClick={() => expandable && toggle(node.path)} title={node.url ?? node.path}>
            {depth === 0 ? 'Accueil' : humanize(node.name)}
          </button>
          {broken ? (
            <span className="inline-flex shrink-0 items-center gap-0.5 rounded bg-red-50 px-1 text-[11px] font-medium text-clay" title={`HTTP ${node.httpStatus}`}>
              <TriangleAlert className="h-3 w-3" aria-hidden /> {node.httpStatus}
            </span>
          ) : null}
          {node.url ? (
            <a href={node.url} target="_blank" rel="noreferrer" className="shrink-0 text-ink-400 opacity-0 transition-opacity hover:text-accent group-hover:opacity-100 focus:opacity-100" aria-label="Ouvrir la page">
              <ExternalLink className="h-3.5 w-3.5" />
            </a>
          ) : null}
          {depth === 1 ? (
            <span className="ml-auto hidden h-1 w-16 shrink-0 overflow-hidden rounded-full bg-paper ring-1 ring-inset ring-line lg:block" title={`${Math.round(weight)} % du site`}>
              <span className="block h-full rounded-full bg-ink-400" style={{ width: `${Math.max(weight, 2)}%` }} />
            </span>
          ) : null}
        </div>
        <span className="text-right text-xs tabular-nums text-ink-600 md:hidden">
          {integer.format(node.stats.pages)} p. · {integer.format(node.stats.pdfs)} PDF
          {node.stats.toFix > 0 ? <span className="text-amber"> · {node.stats.toFix} à traiter</span> : null}
        </span>
        <span className="hidden md:contents">
          <Num value={node.stats.pages} />
          <Num value={node.stats.pdfs} />
          <Num value={node.stats.pdfPages} />
          <Num value={node.stats.toFix} tone="font-semibold text-amber" />
        </span>
      </div>
      <AnimatePresence initial={false}>
        {open ? (
          <motion.ul
            role="group"
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.18, ease: 'easeOut' }}
            className="overflow-hidden"
          >
            {children.map((child) => (
              <TreeRow key={child.path} node={child} depth={depth + 1} isOpen={isOpen} toggle={toggle} visible={visible} showPdfs={showPdfs} query={query} filter={filter} rootSize={rootSize} />
            ))}
            {shownPdfs.map((pdf) => (
              <PdfLeaf key={pdf.url} pdf={pdf} depth={depth + 1} />
            ))}
            {pdfs.length > shownPdfs.length ? (
              <li style={{ paddingLeft: (depth + 1) * 16 + 36 }} className="py-1">
                <button type="button" className="link text-xs" onClick={() => setAllPdfs(true)}>
                  Afficher les {integer.format(pdfs.length - shownPdfs.length)} autres PDF
                </button>
              </li>
            ) : null}
          </motion.ul>
        ) : null}
      </AnimatePresence>
    </li>
  )
}

function PdfLeaf({ pdf, depth }: { pdf: TreePdf; depth: number }) {
  const color = OCR_COLORS[pdf.ocrStatus] ?? OCR_COLORS.pending
  return (
    <li role="treeitem" aria-level={depth + 1} className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-2 px-3 py-0.5 hover:bg-paper md:grid-cols-[minmax(0,1fr)_repeat(4,72px)]">
      <div className="flex min-w-0 items-center gap-1.5" style={{ paddingLeft: depth * 16 + 24 }}>
        <span className="relative shrink-0">
          <FileText className="h-4 w-4" style={{ color }} aria-hidden />
        </span>
        <a href={pdf.url} target="_blank" rel="noreferrer" className="min-w-0 truncate text-[13px] text-ink-800 underline-offset-2 hover:text-accent hover:underline" title={pdf.url}>
          {pdf.name}
        </a>
        <span className="shrink-0 rounded px-1.5 text-[11px] font-medium" style={{ color, backgroundColor: `${color}14` }}>
          {OCR_LABELS[pdf.ocrStatus] ?? pdf.ocrStatus}
        </span>
      </div>
      <span className="text-right text-xs tabular-nums text-ink-600 md:col-start-4">{pdf.pageCount != null ? `${integer.format(pdf.pageCount)} p.` : '—'}</span>
    </li>
  )
}
