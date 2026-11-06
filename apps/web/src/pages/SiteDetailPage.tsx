import { useQuery } from '@tanstack/react-query'
import { useState } from 'react'
import { Link, useParams, useSearchParams } from 'react-router-dom'
import { Notice, OcrBadge, StatusBadge } from '../components/Badges'
import { api, sitemapUrl } from '../lib/api'
import { formatBytes } from '../lib/format'

type Tab = 'pages' | 'pdfs' | 'errors'

export function SiteDetailPage() {
  const { id = '', analysisSiteId = '' } = useParams()
  const [params, setParams] = useSearchParams()
  const tab = (params.get('tab') as Tab) || 'pages'
  const q = params.get('q') ?? ''
  const page = Number(params.get('page') ?? 1) || 1
  const ocrStatus = params.get('ocrStatus') ?? ''
  const [draft, setDraft] = useState(q)
  const sites = useQuery({ queryKey: ['analysis-sites', id], queryFn: () => api.analysisSites(id) })
  const row = sites.data?.sites.find((site) => site.id === analysisSiteId)
  const query = { q, page, pageSize: 25, ...(ocrStatus ? { ocrStatus } : {}) }
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
  const result = tab === 'pages' ? pages.data : tab === 'pdfs' ? pdfs.data : errors.data

  return (
    <div className="space-y-5">
      <Link className="text-sm font-medium text-ink-600 hover:text-ink-950" to={`/analyses/${id}`}>
        Retour à l’analyse
      </Link>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1>{row?.site.hostname ?? 'Site'}</h1>
        <div className="flex items-center gap-3">
          {row ? <StatusBadge value={row.status} /> : null}
          {row && id ? (
            <a className="btn-ghost" href={sitemapUrl(id, row.id)}>
              Télécharger sitemap.xml
            </a>
          ) : null}
        </div>
      </div>
      <div className="flex flex-wrap gap-2">
        {(['pages', 'pdfs', 'errors'] as const).map((item) => (
          <button key={item} type="button" className={tab === item ? 'btn-primary' : 'btn-ghost'} onClick={() => setTab(item)}>
            {item === 'pages' ? 'Pages' : item === 'pdfs' ? 'PDF' : 'Erreurs'}
          </button>
        ))}
      </div>
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
      <div className="table-wrap">
        {tab === 'pages' ? (
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
              {pages.data?.items.map((item) => (
                <tr key={item.id}>
                  <td>
                    <UrlLink url={item.url} />
                  </td>
                  <td>{item.httpStatus ?? '—'}</td>
                  <td>{item.depth}</td>
                  <td>{formatBytes(item.sizeBytes)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : null}
        {tab === 'pdfs' ? (
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
              {pdfs.data?.items.map((item) => (
                <tr key={item.id}>
                  <td>
                    <UrlLink url={item.url} />
                    {item.errorMessage ? <div className="text-xs text-clay">{item.errorMessage}</div> : null}
                  </td>
                  <td>
                    <OcrBadge value={item.ocrStatus} />
                  </td>
                  <td>{item.pageCount ?? '—'}</td>
                  <td>{item.pagesWithText ?? '—'}</td>
                  <td>{formatBytes(item.sizeBytes)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : null}
        {tab === 'errors' ? (
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
              {errors.data?.items.map((item) => (
                <tr key={item.id}>
                  <td className="font-mono text-xs">{item.url}</td>
                  <td>{item.errorType}</td>
                  <td>{item.httpStatus ?? '—'}</td>
                  <td>{item.message}</td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : null}
      </div>
      {result && result.items.length === 0 ? <Notice tone="info">Aucun élément pour ce filtre.</Notice> : null}
      {result ? (
        <div className="flex items-center gap-3 text-sm">
          <button
            type="button"
            className="btn-ghost"
            disabled={page <= 1}
            onClick={() => {
              const copy = new URLSearchParams(params)
              copy.set('page', String(page - 1))
              setParams(copy)
            }}
          >
            Précédent
          </button>
          <span>
            Page {result.page} · {result.total} éléments
          </span>
          <button
            type="button"
            className="btn-ghost"
            disabled={page * result.pageSize >= result.total}
            onClick={() => {
              const copy = new URLSearchParams(params)
              copy.set('page', String(page + 1))
              setParams(copy)
            }}
          >
            Suivant
          </button>
        </div>
      ) : null}
    </div>
  )
}

function UrlLink({ url }: { url: string }) {
  return (
    <a className="break-all font-mono text-xs text-accent underline-offset-2 hover:underline" href={url} target="_blank" rel="noreferrer">
      {url}
    </a>
  )
}
