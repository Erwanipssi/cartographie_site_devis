import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { Notice, StatusBadge } from '../components/Badges'
import { RecipientPicker } from '../components/RecipientPicker'
import { api, exportUrl, sitemapUrl, type AnalysisSite } from '../lib/api'
import { analyzedPdfCount, formatDuration } from '../lib/format'
import { useAnalysisStream } from '../lib/useAnalysisStream'

export function AnalysisPage() {
  const { id = '' } = useParams()
  const queryClient = useQueryClient()
  const analysis = useQuery({
    queryKey: ['analysis', id],
    queryFn: () => api.analysis(id),
    refetchInterval: (query) => {
      const status = query.state.data?.analysis.status
      return status === 'running' || status === 'pending' ? 2000 : false
    },
  })
  const sites = useQuery({
    queryKey: ['analysis-sites', id],
    queryFn: () => api.analysisSites(id),
    refetchInterval: () => (analysis.data?.analysis.status === 'running' || analysis.data?.analysis.status === 'pending' ? 2000 : false),
  })
  const health = useQuery({ queryKey: ['health'], queryFn: api.health })
  const deliveries = useQuery({ queryKey: ['deliveries', id], queryFn: () => api.deliveries(id) })
  const running = analysis.data?.analysis.status === 'running' || analysis.data?.analysis.status === 'pending'
  useAnalysisStream(id, Boolean(running))
  const [mailOpen, setMailOpen] = useState(false)
  const [recipientIds, setRecipientIds] = useState<string[]>([])
  const [mailMessage, setMailMessage] = useState<string | null>(null)

  const cancel = useMutation({
    mutationFn: () => api.cancelAnalysis(id),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['analysis', id] })
      await queryClient.invalidateQueries({ queryKey: ['analysis-sites', id] })
    },
  })
  const send = useMutation({
    mutationFn: () => api.sendMail(id, recipientIds),
    onSuccess: async () => {
      setMailMessage('Envoi placé dans la file.')
      await queryClient.invalidateQueries({ queryKey: ['deliveries', id] })
    },
    onError: (reason) => setMailMessage(reason instanceof Error ? reason.message : 'Envoi impossible'),
  })

  if (analysis.isLoading) return <p>Chargement…</p>
  if (analysis.isError || !analysis.data) return <Notice tone="error">Analyse introuvable.</Notice>
  const rows = sites.data?.sites ?? []
  const totals = analysis.data.totals

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="text-sm text-ink-600">Analyse</p>
          <h1 className="break-all font-mono text-2xl">{id.slice(0, 8)}</h1>
        </div>
        <StatusBadge value={analysis.data.analysis.status} />
      </div>
      {analysis.data.analysis.failureReason ? <Notice tone="error">{analysis.data.analysis.failureReason}</Notice> : null}
      <div className="grid gap-3 sm:grid-cols-5">
        <Metric label="URL du sitemap" value={totals.sitemap ?? 0} />
        <Metric label="Pages HTML" value={totals.html ?? 0} />
        <Metric label="PDF" value={totals.pdf ?? 0} />
        <Metric label="PDF texte" value={totals.pdfText ?? 0} />
        <Metric label="Erreurs" value={totals.errors ?? 0} />
      </div>
      {(totals.pdfImage ?? 0) + (totals.pdfPartial ?? 0) + (totals.pdfError ?? 0) > 0 ? (
        <Link
          to={`/analyses/${id}/pdf-a-traiter`}
          className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-red-200 bg-red-50/60 px-5 py-4 transition-colors hover:border-red-300 hover:bg-red-50"
        >
          <div>
            <p className="font-semibold text-ink-950">
              {(totals.pdfImage ?? 0) + (totals.pdfPartial ?? 0)} PDF à traiter
              {(totals.pdfError ?? 0) > 0 ? <span className="font-normal text-ink-600"> · {totals.pdfError} illisible{(totals.pdfError ?? 0) > 1 ? 's' : ''}</span> : null}
            </p>
            <p className="text-sm text-ink-600">
              {totals.pdfImage ?? 0} sans aucune page lisible, {totals.pdfPartial ?? 0} partiellement lisibles
            </p>
          </div>
          <span className="text-sm font-medium text-ink-950">Voir la liste →</span>
        </Link>
      ) : null}
      <div className="grid gap-3 md:grid-cols-2">
        {rows.map((row) => (
          <ProgressCard key={row.id} row={row} analysisId={id} />
        ))}
      </div>
      <div className="table-wrap">
        <table className="grid-table">
          <thead>
            <tr>
              <th>Site</th>
              <th>Sitemap</th>
              <th>Pages</th>
              <th>PDF</th>
              <th>Texte</th>
              <th>Image</th>
              <th>Partiel</th>
              <th>Erreur PDF</th>
              <th>Durée</th>
              <th>Statut</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.id}>
                <td>
                  <Link className="font-medium text-accent hover:underline underline-offset-2" to={`/analyses/${id}/sites/${row.id}`}>
                    {row.site.hostname}
                  </Link>
                </td>
                <td>{row.sitemapUrlCount ?? '—'}</td>
                <td>{row.htmlCount}</td>
                <td>{row.pdfCount}</td>
                <td>{row.pdfTextCount}</td>
                <td>{row.pdfImageCount}</td>
                <td>{row.pdfPartialCount}</td>
                <td>{row.pdfErrorCount}</td>
                <td>{formatDuration(row.durationMs)}</td>
                <td>
                  <StatusBadge value={row.status} />
                </td>
                <td className="text-right">
                  <a className="whitespace-nowrap font-medium text-accent underline-offset-2 hover:underline" href={sitemapUrl(id, row.id)} title="URL découvertes, au format sitemap.xml">
                    sitemap.xml
                  </a>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="flex flex-wrap gap-2">
        <a className="btn-ghost" href={exportUrl(id)}>
          Télécharger Excel
        </a>
        {running ? (
          <button type="button" className="btn-ghost" onClick={() => cancel.mutate()} disabled={cancel.isPending}>
            Annuler
          </button>
        ) : (
          <button type="button" className="btn-primary" onClick={() => setMailOpen((open) => !open)}>
            Envoyer par mail
          </button>
        )}
      </div>
      {mailOpen ? (
        <div className="card space-y-3">
          <h2 className="text-xl">Destinataires</h2>
          {!health.data?.smtp ? <Notice tone="info">SMTP non configuré dans apps/api/.env.</Notice> : null}
          <RecipientPicker selected={recipientIds} onChange={setRecipientIds} />
          <button type="button" className="btn-primary" disabled={!health.data?.smtp || recipientIds.length === 0 || send.isPending} onClick={() => send.mutate()}>
            Envoyer maintenant
          </button>
          {mailMessage ? <p className="text-sm">{mailMessage}</p> : null}
        </div>
      ) : null}
      {deliveries.data && deliveries.data.deliveries.length > 0 ? (
        <div className="table-wrap">
          <table className="grid-table">
            <thead>
              <tr>
                <th>Envoi</th>
                <th>Destinataires</th>
                <th>Statut</th>
              <th />
                <th>Détail</th>
              </tr>
            </thead>
            <tbody>
              {deliveries.data.deliveries.map((delivery) => (
                <tr key={delivery.id}>
                  <td>{delivery.trigger}</td>
                  <td>{delivery.recipients.join(', ')}</td>
                  <td>{delivery.status}</td>
                  <td>{delivery.error ?? '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}
    </div>
  )
}

function Metric({ label, value }: { label: string; value: number }) {
  return (
    <div className="card">
      <p className="text-xs uppercase tracking-wide text-ink-600">{label}</p>
      <p className="text-2xl font-semibold tabular-nums tracking-tight">{value}</p>
    </div>
  )
}

function ProgressCard({ row, analysisId }: { row: AnalysisSite; analysisId: string }) {
  const analyzed = analyzedPdfCount(row)
  return (
    <Link to={`/analyses/${analysisId}/sites/${row.id}`} className="card block transition-colors hover:border-ink-400">
      <div className="flex items-center justify-between gap-2">
        <h2 className="text-base">{row.site.hostname}</h2>
        <StatusBadge value={row.status} />
      </div>
      <p className="mt-2 text-sm text-ink-600">
        {row.sitemapUrlCount != null ? `${row.sitemapUrlCount} URL dans le sitemap · ` : ''}{row.htmlCount} pages · {row.pdfCount} PDF découverts · {analyzed} PDF analysés · {row.errorCount} erreurs
      </p>
      {row.errorMessage ? <p className="mt-1 text-sm text-clay">{row.errorMessage}</p> : null}
    </Link>
  )
}
