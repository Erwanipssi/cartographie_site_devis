import { useQuery } from '@tanstack/react-query'
import { ArrowLeft, ChevronLeft, ChevronRight, Download, FileText, FileWarning, Files, GitBranch, Globe, Layers, ListTree, TrendingUp, TriangleAlert } from 'lucide-react'
import { useState } from 'react'
import { Link, useParams, useSearchParams } from 'react-router-dom'
import { Notice, OcrBadge, StatusBadge } from '../components/Badges'
import { SiteTree } from '../components/SiteTree'
import { EmptyState, integer, ocrSegments, PageHeader, Skeleton, StackedBar, StatCard, Tabs } from '../components/ui'
import { api, siteTree, sitemapUrl } from '../lib/api'
import { analyzedPdfCount, formatBytes, formatDuration } from '../lib/format'

type Tab = 'tree' | 'pages' | 'pdfs' | 'errors'

export function SiteDetailPage() {
  const { id = '', analysisSiteId = '' } = useParams()
  const [params, setParams] = useSearchParams()
  const tab = (params.get('tab') as Tab) || 'tree'
  const q = params.get('q') ?? ''
  const page = Number(params.get('page') ?? 1) || 1
  const ocrStatus = params.get('ocrStatus') ?? ''
  const [draft, setDraft] = useState(q)
  const sites = useQuery({ queryKey: ['analysis-sites', id], queryFn: () => api.analysisSites(id) })
  const row = sites.data?.sites.find((site) => site.id === analysisSiteId)
  const query = { q, page, pageSize: 25, ...(ocrStatus ? { ocrStatus } : {}) }
  const tree = useQuery({ queryKey: ['tree', id, analysisSiteId], queryFn: () => siteTree(id, analysisSiteId), enabled: tab === 'tree', staleTime: 60_000 })
  const pages = useQuery({ queryKey: ['pages', id, analysisSiteId, query], queryFn: () => api.pages(id, analysisSiteId, query), enabled: tab === 'pages' })
  const pdfs = useQuery({ queryKey: ['pdfs', id, analysisSiteId, query], queryFn: () => api.pdfs(id, analysisSiteId, query), enabled: tab === 'pdfs' })
  const errors = useQuery({ queryKey: ['errors', id, analysisSiteId, query], queryFn: () => api.errors(id, analysisSiteId, query), enabled: tab === 'errors' })

  const setTab = (next: Tab) => {
    const copy = new URLSearchParams(params)
    copy.set('tab', next)
    copy.set('page', '1')
    setParams(copy)
  }
  const applySearch = () => {
    const copy = new URLSearchParams(params)
    if (draft) copy.set('q', draft)
    else copy.delete('q')
    copy.set('page', '1')
    setParams(copy)
  }
  const setPage = (next: number) => {
    const copy = new URLSearchParams(params)
    copy.set('page', String(next))
    setParams(copy)
  }
  const result = tab === 'pages' ? pages.data : tab === 'pdfs' ? pdfs.data : tab === 'errors' ? errors.data : undefined
  const loadingList = (tab === 'pages' && pages.isLoading) || (tab === 'pdfs' && pdfs.isLoading) || (tab === 'errors' && errors.isLoading)
  const toFix = row ? row.pdfImageCount + row.pdfPartialCount : 0

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow={
          <Link className="inline-flex items-center gap-1 hover:text-ink-950" to={`/analyses/${id}`}>
            <ArrowLeft className="h-3.5 w-3.5" aria-hidden /> Analyse {id.slice(0, 8)}
          </Link>
        }
        title={
          <span className="flex items-center gap-3">
            {row?.site.hostname ?? <Skeleton className="h-7 w-48" />}
            {row ? <StatusBadge value={row.status} /> : null}
          </span>
        }
        description={row ? `${row.site.normalizedUrl} · ${formatDuration(row.durationMs)}` : undefined}
        actions={
          row ? (
            <>
              {row.status === 'completed' ? (
                <Link className="btn-ghost" to={`/analyses/${id}/sites/${row.id}/evolution`}>
                  <TrendingUp className="h-4 w-4" aria-hidden /> Évolution
                </Link>
              ) : null}
              <a className="btn-ghost" href={sitemapUrl(id, row.id)}>
                <Download className="h-4 w-4" aria-hidden /> sitemap.xml
              </a>
            </>
          ) : null
        }
      />

      {row ? (
        <>
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
            <StatCard icon={Globe} label="Pages" value={row.htmlCount} hint={row.sitemapUrlCount != null ? `${integer.format(row.sitemapUrlCount)} URL dans le sitemap` : undefined} />
            <StatCard icon={Files} label="PDF" value={row.pdfCount} hint={`${integer.format(analyzedPdfCount(row))} analysés`} />
            <StatCard icon={Layers} label="Pages PDF" value={row.pdfPages.pages} hint={`${integer.format(row.pdfPages.withoutText)} sans texte`} />
            <StatCard icon={FileWarning} label="PDF à traiter" value={toFix} tone={toFix > 0 ? 'warn' : 'good'} to={`/analyses/${id}/pdf-a-traiter`} hint="Non OCRisés ou partiels" />
            <StatCard icon={TriangleAlert} label="Erreurs" value={row.errorCount} tone={row.errorCount > 0 ? 'bad' : 'neutral'} />
          </div>
          {row.pdfCount > 0 ? (
            <div className="card">
              <h2 className="mb-3 text-sm">Couche texte des PDF</h2>
              <StackedBar
                segments={ocrSegments({ text: row.pdfTextCount, partial: row.pdfPartialCount, image: row.pdfImageCount, error: row.pdfErrorCount, pending: row.pendingPdfCount })}
              />
            </div>
          ) : null}
        </>
      ) : sites.isLoading ? (
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
          {Array.from({ length: 5 }, (_, index) => (
            <Skeleton key={index} className="h-[104px]" />
          ))}
        </div>
      ) : null}

      <Tabs
        value={tab}
        onChange={setTab}
        items={[
          { id: 'tree', label: 'Arborescence', icon: ListTree },
          { id: 'pages', label: 'Pages', icon: Globe, count: row?.htmlCount },
          { id: 'pdfs', label: 'PDF', icon: FileText, count: row?.pdfCount },
          { id: 'errors', label: 'Erreurs', icon: TriangleAlert, count: row?.errorCount },
        ]}
      />

      {tab === 'tree' ? (
        tree.isLoading ? (
          <div className="space-y-2">
            <Skeleton className="h-48" />
            <Skeleton className="h-96" />
          </div>
        ) : tree.isError ? (
          <Notice tone="error">Arborescence indisponible.</Notice>
        ) : tree.data && tree.data.tree.stats.pages + tree.data.tree.stats.pdfs > 0 ? (
          <SiteTree tree={tree.data.tree} />
        ) : (
          <EmptyState icon={GitBranch} title="Arborescence vide">
            Aucune page n’a encore été enregistrée pour ce site.
          </EmptyState>
        )
      ) : (
        <>
          <form
            className="flex flex-wrap gap-2"
            onSubmit={(event) => {
              event.preventDefault()
              applySearch()
            }}
          >
            <input className="field max-w-md" value={draft} onChange={(event) => setDraft(event.target.value)} placeholder="Filtrer par URL" />
            {tab === 'pdfs' ? (
              <select
                className="field max-w-xs"
                value={ocrStatus}
                onChange={(event) => {
                  const copy = new URLSearchParams(params)
                  if (event.target.value) copy.set('ocrStatus', event.target.value)
                  else copy.delete('ocrStatus')
                  copy.set('page', '1')
                  setParams(copy)
                }}
              >
                <option value="">Tous les statuts OCR</option>
                <option value="text">OCRisé / texte</option>
                <option value="image">Non OCRisé</option>
                <option value="partial">Partiel</option>
                <option value="error">Erreur</option>
                <option value="pending">En attente</option>
              </select>
            ) : null}
            <button className="btn-ghost" type="submit">
              Filtrer
            </button>
          </form>
          {loadingList ? <Skeleton className="h-80" /> : null}
          {result && result.items.length > 0 ? (
            <div className="table-wrap">
              {tab === 'pages' && pages.data ? (
                <table className="grid-table">
                  <thead>
                    <tr>
                      <th>URL</th>
                      <th>HTTP</th>
                      <th>Profondeur</th>
                      <th>Taille</th>
                    </tr>
                  </thead>
                  <tbody>
                    {pages.data.items.map((item) => (
                      <tr key={item.id} className="hover:bg-paper">
                        <td>
                          <UrlLink url={item.url} />
                        </td>
                        <td>
                          <HttpStatus value={item.httpStatus} />
                        </td>
                        <td className="tabular-nums">{item.depth}</td>
                        <td className="tabular-nums">{formatBytes(item.sizeBytes)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              ) : null}
              {tab === 'pdfs' && pdfs.data ? (
                <table className="grid-table">
                  <thead>
                    <tr>
                      <th>URL</th>
                      <th>OCR</th>
                      <th>Pages</th>
                      <th>Avec texte</th>
                      <th>Taille</th>
                    </tr>
                  </thead>
                  <tbody>
                    {pdfs.data.items.map((item) => (
                      <tr key={item.id} className="hover:bg-paper">
                        <td>
                          <UrlLink url={item.url} />
                          {item.errorMessage ? <div className="text-xs text-clay">{item.errorMessage}</div> : null}
                        </td>
                        <td>
                          <OcrBadge value={item.ocrStatus} />
                        </td>
                        <td className="tabular-nums">{item.pageCount ?? '—'}</td>
                        <td className="tabular-nums">{item.pagesWithText ?? '—'}</td>
                        <td className="tabular-nums">{formatBytes(item.sizeBytes)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              ) : null}
              {tab === 'errors' && errors.data ? (
                <table className="grid-table">
                  <thead>
                    <tr>
                      <th>URL</th>
                      <th>Type</th>
                      <th>HTTP</th>
                      <th>Message</th>
                    </tr>
                  </thead>
                  <tbody>
                    {errors.data.items.map((item) => (
                      <tr key={item.id} className="hover:bg-paper">
                        <td className="break-all font-mono text-xs">{item.url}</td>
                        <td>{item.errorType}</td>
                        <td>
                          <HttpStatus value={item.httpStatus} />
                        </td>
                        <td>{item.message}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              ) : null}
            </div>
          ) : null}
          {result && result.items.length === 0 ? (
            <EmptyState icon={tab === 'errors' ? TriangleAlert : FileText} title={tab === 'errors' && !q ? 'Aucune erreur' : 'Aucun élément pour ce filtre'} />
          ) : null}
          {result && result.total > result.pageSize ? (
            <div className="flex items-center justify-between gap-3 text-sm">
              <span className="text-ink-600">
                {integer.format((result.page - 1) * result.pageSize + 1)}–{integer.format(Math.min(result.page * result.pageSize, result.total))} sur {integer.format(result.total)}
              </span>
              <div className="flex gap-2">
                <button type="button" className="btn-ghost h-8 px-2" disabled={page <= 1} onClick={() => setPage(page - 1)} aria-label="Page précédente">
                  <ChevronLeft className="h-4 w-4" />
                </button>
                <button type="button" className="btn-ghost h-8 px-2" disabled={page * result.pageSize >= result.total} onClick={() => setPage(page + 1)} aria-label="Page suivante">
                  <ChevronRight className="h-4 w-4" />
                </button>
              </div>
            </div>
          ) : null}
        </>
      )}
    </div>
  )
}

function HttpStatus({ value }: { value: number | null }) {
  if (value == null) return <span className="text-ink-400">—</span>
  const tone = value >= 200 && value < 300 ? 'bg-moss text-pine' : value < 400 ? 'bg-blue-50 text-accent' : 'bg-red-50 text-clay'
  return <span className={`rounded px-1.5 py-0.5 font-mono text-xs ${tone}`}>{value}</span>
}

function UrlLink({ url }: { url: string }) {
  return (
    <a className="break-all font-mono text-xs text-accent underline-offset-2 hover:underline" href={url} target="_blank" rel="noreferrer">
      {url}
    </a>
  )
}
