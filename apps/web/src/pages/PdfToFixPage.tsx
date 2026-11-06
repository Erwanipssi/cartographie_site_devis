import { useQuery } from '@tanstack/react-query'
import { useState } from 'react'
import { Link, useParams, useSearchParams } from 'react-router-dom'
import { Notice } from '../components/Badges'
import { exportUrl, pdfsToFix, pdfsToFixCsvUrl, type PdfToFix, type TriageStatus } from '../lib/api'
import { formatBytes } from '../lib/format'

const STATUSES: Array<{ key: TriageStatus; label: string; hint: string; tone: string }> = [
  { key: 'image', label: 'Non OCRisés', hint: 'Aucune page lisible : à reprendre (OCR ou version native)', tone: 'bg-red-50 text-red-700 ring-red-200' },
  { key: 'partial', label: 'Partiels', hint: 'Une partie des pages sans texte : à compléter', tone: 'bg-amber-50 text-amber-800 ring-amber-200' },
  { key: 'error', label: 'Illisibles', hint: 'Fichier en erreur : à vérifier à la main', tone: 'bg-zinc-100 text-zinc-700 ring-zinc-200' },
]
const PAGE_SIZE = 50

export function PdfToFixPage() {
  const { id = '' } = useParams()
  const [params, setParams] = useSearchParams()
  const selected = (params.get('status')?.split(',').filter((value): value is TriageStatus => ['image', 'partial', 'error'].includes(value)) ?? []) as TriageStatus[]
  const statuses: TriageStatus[] = selected.length ? selected : ['image', 'partial']
  const q = params.get('q') ?? ''
  const page = Number(params.get('page') ?? 1) || 1
  const [draft, setDraft] = useState(q)

  const result = useQuery({
    queryKey: ['pdfs-to-fix', id, statuses.join(','), q, page],
    queryFn: () => pdfsToFix(id, { status: statuses.join(','), q, page, pageSize: PAGE_SIZE }),
  })

  const update = (changes: Record<string, string | null>) => {
    const copy = new URLSearchParams(params)
    for (const [key, value] of Object.entries(changes)) {
      if (value) copy.set(key, value)
      else copy.delete(key)
    }
    setParams(copy)
  }
  const toggle = (status: TriageStatus) => {
    const next = statuses.includes(status) ? statuses.filter((item) => item !== status) : [...statuses, status]
    if (next.length === 0) return
    update({ status: next.join(','), page: '1' })
  }

  const counts = result.data?.counts
  const total = result.data?.total ?? 0
  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE))

  return (
    <div className="space-y-6">
      <Link className="text-sm font-medium text-ink-600 hover:text-ink-950" to={`/analyses/${id}`}>
        Retour à l’analyse
      </Link>
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1>PDF à traiter</h1>
          <p className="mt-1 max-w-2xl text-sm text-ink-600">
            Documents sans couche de texte exploitable, du plus urgent au moins urgent : les lecteurs d’écran et la recherche ne peuvent pas les lire.
          </p>
        </div>
        <div className="flex gap-2">
          <a className="btn-ghost" href={pdfsToFixCsvUrl(id, statuses)}>
            Exporter en CSV
          </a>
          <a className="btn-primary" href={exportUrl(id)} title="Classeur complet, avec un onglet « PDF à traiter »">
            Classeur Excel
          </a>
        </div>
      </div>

      <div className="grid gap-3 sm:grid-cols-3" role="group" aria-label="Filtrer par statut">
        {STATUSES.map((status) => {
          const active = statuses.includes(status.key)
          return (
            <button
              key={status.key}
              type="button"
              aria-pressed={active}
              onClick={() => toggle(status.key)}
              className={`card text-left transition-colors ${active ? 'border-ink-950 ring-1 ring-ink-950' : 'opacity-60 hover:opacity-100'}`}
            >
              <div className="flex items-center justify-between gap-2">
                <span className={`rounded-full px-2 py-0.5 text-xs font-medium ring-1 ${status.tone}`}>{status.label}</span>
                <span className="text-2xl font-semibold tabular-nums tracking-tight">{counts ? counts[status.key] : '—'}</span>
              </div>
              <p className="mt-2 text-xs text-ink-600">{status.hint}</p>
            </button>
          )
        })}
      </div>

      <form
        className="flex flex-wrap gap-2"
        onSubmit={(event) => {
          event.preventDefault()
          update({ q: draft || null, page: '1' })
        }}
      >
        <input className="field max-w-md" placeholder="Rechercher dans le nom ou l’adresse du PDF" value={draft} onChange={(event) => setDraft(event.target.value)} />
        <button className="btn-ghost" type="submit">
          Rechercher
        </button>
      </form>

      {result.isError ? <Notice tone="error">Impossible de charger la liste.</Notice> : null}

      <div className="table-wrap">
        <table className="grid-table">
          <thead>
            <tr>
              <th>Statut</th>
              <th>Document</th>
              <th className="text-right">Pages sans texte</th>
              <th className="text-right">Taille</th>
              <th>Publié sur</th>
            </tr>
          </thead>
          <tbody>
            {result.data?.items.map((pdf) => <Row key={`${pdf.analysisSiteId}-${pdf.url}`} pdf={pdf} />)}
            {result.data && result.data.items.length === 0 ? (
              <tr>
                <td colSpan={5} className="py-8 text-center text-ink-600">
                  {q ? 'Aucun PDF ne correspond à cette recherche.' : 'Aucun PDF à traiter pour ces statuts.'}
                </td>
              </tr>
            ) : null}
            {result.isLoading ? (
              <tr>
                <td colSpan={5} className="py-8 text-center text-ink-600">
                  Chargement…
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>

      <div className="flex items-center justify-between text-sm text-ink-600">
        <span>
          {total} document{total > 1 ? 's' : ''}
        </span>
        {pages > 1 ? (
          <div className="flex items-center gap-2">
            <button type="button" className="btn-ghost" disabled={page <= 1} onClick={() => update({ page: String(page - 1) })}>
              Précédent
            </button>
            <span className="tabular-nums">
              {page} / {pages}
            </span>
            <button type="button" className="btn-ghost" disabled={page >= pages} onClick={() => update({ page: String(page + 1) })}>
              Suivant
            </button>
          </div>
        ) : null}
      </div>
    </div>
  )
}

function Row({ pdf }: { pdf: PdfToFix }) {
  const status = STATUSES.find((item) => item.key === pdf.ocrStatus) ?? STATUSES[0]!
  const withoutText =
    pdf.ocrStatus === 'error' ? '—' : pdf.pageCount != null && pdf.pagesWithoutText != null ? `${pdf.pagesWithoutText} / ${pdf.pageCount}` : '—'
  return (
    <tr>
      <td className="whitespace-nowrap">
        <span className={`rounded-full px-2 py-0.5 text-xs font-medium ring-1 ${status.tone}`}>{status.label.replace(/s$/, '')}</span>
      </td>
      <td className="max-w-md">
        <a className="break-words font-medium text-accent underline-offset-2 hover:underline" href={pdf.url} target="_blank" rel="noreferrer">
          {pdf.name}
        </a>
        {pdf.errorMessage ? <div className="text-xs text-clay">{pdf.errorMessage}</div> : null}
      </td>
      <td className="text-right tabular-nums">{withoutText}</td>
      <td className="whitespace-nowrap text-right tabular-nums">{formatBytes(pdf.sizeBytes)}</td>
      <td className="max-w-xs">
        {pdf.parentUrl ? (
          <a className="block truncate text-ink-600 underline-offset-2 hover:text-ink-950 hover:underline" href={pdf.parentUrl} target="_blank" rel="noreferrer" title={pdf.parentUrl}>
            {pdf.parentUrl.replace(/^https?:\/\/(www\.)?/, '')}
          </a>
        ) : (
          '—'
        )}
      </td>
    </tr>
  )
}
