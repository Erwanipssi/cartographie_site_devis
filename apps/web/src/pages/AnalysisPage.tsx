import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { ArrowRight, Ban, Download, FileText, FileWarning, Files, Globe, Layers, ListTree, Loader2, Mail, Map as MapIcon, TrendingUp, TriangleAlert } from 'lucide-react'
import { useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { Cell, Pie, PieChart, ResponsiveContainer, Tooltip } from 'recharts'
import { toast } from 'sonner'
import { Notice, StatusBadge } from '../components/Badges'
import { RecipientPicker } from '../components/RecipientPicker'
import { integer, OCR_COLORS, ocrSegments, PageHeader, ProgressBar, Reveal, Skeleton, StackedBar, StatCard } from '../components/ui'
import { api, exportUrl, sitemapUrl, type AnalysisSite, type PdfPageTotals } from '../lib/api'
import { analyzedPdfCount, formatDate, formatDuration } from '../lib/format'
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

  const cancel = useMutation({
    mutationFn: () => api.cancelAnalysis(id),
    onSuccess: async () => {
      toast('Analyse annulée')
      await queryClient.invalidateQueries({ queryKey: ['analysis', id] })
      await queryClient.invalidateQueries({ queryKey: ['analysis-sites', id] })
    },
    onError: (reason) => toast.error(reason instanceof Error ? reason.message : 'Annulation impossible'),
  })
  const send = useMutation({
    mutationFn: () => api.sendMail(id, recipientIds),
    onSuccess: async () => {
      toast.success('Rapport placé dans la file d’envoi')
      setMailOpen(false)
      await queryClient.invalidateQueries({ queryKey: ['deliveries', id] })
    },
    onError: (reason) => toast.error(reason instanceof Error ? reason.message : 'Envoi impossible'),
  })

  if (analysis.isLoading) return <AnalysisSkeleton />
  if (analysis.isError || !analysis.data) return <Notice tone="error">Analyse introuvable.</Notice>
  const rows = sites.data?.sites ?? []
  const { totals, pdfPages } = analysis.data
  const info = analysis.data.analysis
  const toFix = (totals.pdfImage ?? 0) + (totals.pdfPartial ?? 0)
  const analyzed = (totals.pdfText ?? 0) + toFix + (totals.pdfError ?? 0)
  const title = rows.length === 1 ? rows[0]!.site.hostname : rows.length > 1 ? `${rows.length} sites` : `Analyse ${id.slice(0, 8)}`

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow={
          <>
            <span>Analyse du {formatDate(info.startedAt ?? info.createdAt)}</span>
            <span className="text-ink-400">·</span>
            <span>{info.config.mode === 'sitemap' ? 'mode sitemap' : 'crawl complet'}</span>
            {info.trigger === 'scheduled' ? <span className="rounded bg-paper px-1.5 text-xs ring-1 ring-line">planifiée</span> : null}
          </>
        }
        title={
          <span className="flex items-center gap-3">
            {title} <StatusBadge value={info.status} />
          </span>
        }
        actions={
          <>
            <a className="btn-ghost" href={exportUrl(id)}>
              <Download className="h-4 w-4" aria-hidden /> Excel
            </a>
            {running ? (
              <button type="button" className="btn-ghost" onClick={() => cancel.mutate()} disabled={cancel.isPending}>
                <Ban className="h-4 w-4" aria-hidden /> Annuler
              </button>
            ) : (
              <button type="button" className="btn-primary" onClick={() => setMailOpen((open) => !open)}>
                <Mail className="h-4 w-4" aria-hidden /> Envoyer par mail
              </button>
            )}
          </>
        }
      />
      {info.failureReason ? <Notice tone="error">{info.failureReason}</Notice> : null}

      {mailOpen ? (
        <Reveal className="card space-y-3">
          <h2 className="text-sm">Destinataires du rapport</h2>
          {!health.data?.smtp ? <Notice tone="info">SMTP non configuré dans apps/api/.env.</Notice> : null}
          <RecipientPicker selected={recipientIds} onChange={setRecipientIds} />
          <button type="button" className="btn-primary" disabled={!health.data?.smtp || recipientIds.length === 0 || send.isPending} onClick={() => send.mutate()}>
            {send.isPending ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <Mail className="h-4 w-4" aria-hidden />} Envoyer maintenant
          </button>
        </Reveal>
      ) : null}

      {running ? (
        <div className="flex items-center gap-3 rounded-lg border border-blue-200 bg-blue-50/60 px-4 py-3 text-sm text-ink-800">
          <Loader2 className="h-4 w-4 shrink-0 animate-spin text-accent" aria-hidden />
          <span>
            Analyse en cours : les chiffres se mettent à jour en direct.
            {totals.pdf ? ` ${integer.format(analyzed)} PDF analysés sur ${integer.format(totals.pdf)}.` : ''}
          </span>
        </div>
      ) : null}

      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
        <StatCard icon={MapIcon} label="URL du sitemap" value={totals.sitemap ?? 0} />
        <StatCard icon={Globe} label="Pages HTML" value={totals.html ?? 0} />
        <StatCard icon={Files} label="PDF" value={totals.pdf ?? 0} hint={`${integer.format(analyzed)} analysés`} />
        <StatCard icon={Layers} label="Pages PDF" value={pdfPages.pages} hint={pdfPages.documents ? `${integer.format(Math.round(pdfPages.pages / pdfPages.documents))} par PDF en moyenne` : undefined} />
        <StatCard icon={FileWarning} label="PDF à traiter" value={toFix} tone={toFix > 0 ? 'warn' : 'good'} to={`/analyses/${id}/pdf-a-traiter`} hint={toFix > 0 ? 'Voir la liste' : 'Rien à faire'} />
        <StatCard icon={TriangleAlert} label="Erreurs" value={totals.errors ?? 0} tone={(totals.errors ?? 0) > 0 ? 'bad' : 'neutral'} />
      </div>

      {(totals.pdf ?? 0) > 0 ? (
        <div className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.4fr)]">
          <OcrDonut text={totals.pdfText ?? 0} partial={totals.pdfPartial ?? 0} image={totals.pdfImage ?? 0} error={totals.pdfError ?? 0} />
          <PdfPagesCard totals={pdfPages} pdfCount={totals.pdf ?? 0} analysisId={id} toFix={toFix} />
        </div>
      ) : null}

      <section className="space-y-3">
        <h2 className="text-sm">{rows.length > 1 ? 'Sites analysés' : 'Détail du site'}</h2>
        <div className="grid gap-3 md:grid-cols-2">
          {sites.isLoading
            ? Array.from({ length: 2 }, (_, index) => <Skeleton key={index} className="h-44" />)
            : rows.map((row, index) => (
                <Reveal key={row.id} delay={index * 0.04}>
                  <SiteCard row={row} analysisId={id} />
                </Reveal>
              ))}
        </div>
      </section>

      {deliveries.data && deliveries.data.deliveries.length > 0 ? (
        <section className="space-y-3">
          <h2 className="text-sm">Envois du rapport</h2>
          <div className="table-wrap">
            <table className="grid-table">
              <thead>
                <tr>
                  <th>Envoi</th>
                  <th>Destinataires</th>
                  <th>Statut</th>
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
        </section>
      ) : null}
    </div>
  )
}

function AnalysisSkeleton() {
  return (
    <div className="space-y-6">
      <Skeleton className="h-12 w-72" />
      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
        {Array.from({ length: 6 }, (_, index) => (
          <Skeleton key={index} className="h-[104px]" />
        ))}
      </div>
      <Skeleton className="h-56" />
    </div>
  )
}

/** Anneau de la couche texte : la part de PDF exploitables, lisible d'un coup d'œil. */
function OcrDonut({ text, partial, image, error }: { text: number; partial: number; image: number; error: number }) {
  const segments = ocrSegments({ text, partial, image, error })
  const filled = segments.filter((segment) => segment.value > 0)
  const total = text + partial + image + error
  const share = total > 0 ? Math.round((text / total) * 100) : 0
  return (
    <section className="card">
      <h2 className="text-sm">Couche texte des PDF</h2>
      <div className="mt-3 flex flex-wrap items-center gap-x-6 gap-y-4">
        <div className="relative h-36 w-36 shrink-0">
          <ResponsiveContainer width="100%" height="100%">
            <PieChart>
              <Pie data={filled} dataKey="value" nameKey="label" innerRadius="70%" outerRadius="100%" paddingAngle={1.5} stroke="none" startAngle={90} endAngle={-270}>
                {filled.map((segment) => (
                  <Cell key={segment.key} fill={segment.color} />
                ))}
              </Pie>
              <Tooltip contentStyle={{ borderRadius: 8, border: '1px solid #e4e4e7', fontSize: 12 }} formatter={(value, name) => [integer.format(Number(value)), String(name)]} />
            </PieChart>
          </ResponsiveContainer>
          <div className="pointer-events-none absolute inset-0 grid place-items-center text-center">
            <div>
              <p className="text-2xl font-semibold tabular-nums tracking-tight">{share} %</p>
              <p className="text-[11px] text-ink-600">avec texte</p>
            </div>
          </div>
        </div>
        <ul className="min-w-[200px] flex-1 space-y-1.5 text-sm">
          {segments.map((segment) => (
            <li key={segment.key} className="flex items-center justify-between gap-3">
              <span className="flex items-center gap-2 whitespace-nowrap text-ink-800">
                <span className="h-2.5 w-2.5 rounded-sm" style={{ backgroundColor: segment.color }} aria-hidden />
                {segment.label}
              </span>
              <span className="whitespace-nowrap tabular-nums">
                <span className="font-medium">{integer.format(segment.value)}</span>
                <span className="ml-1.5 text-xs text-ink-600">{total ? Math.round((segment.value / total) * 100) : 0} %</span>
              </span>
            </li>
          ))}
        </ul>
      </div>
    </section>
  )
}

/** Pages contenues dans les PDF, avec la part sans texte (le volume à OCRiser). */
function PdfPagesCard({ totals, pdfCount, analysisId, toFix }: { totals: PdfPageTotals; pdfCount: number; analysisId: string; toFix: number }) {
  return (
    <section className="card flex flex-col gap-4">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-sm">Pages dans les PDF</h2>
        <p className="text-xs text-ink-600">
          {integer.format(totals.documents)} PDF comptés{totals.documents < pdfCount ? ` sur ${integer.format(pdfCount)} (illisibles ou en cours exclus)` : ''}
        </p>
      </div>
      <div className="grid grid-cols-3 gap-3">
        <div>
          <p className="text-xs font-medium text-ink-600">Total</p>
          <p className="text-2xl font-semibold tabular-nums tracking-tight">{integer.format(totals.pages)}</p>
        </div>
        <div>
          <p className="text-xs font-medium text-ink-600">Avec texte</p>
          <p className="text-2xl font-semibold tabular-nums tracking-tight text-pine">{integer.format(totals.withText)}</p>
        </div>
        <div>
          <p className="text-xs font-medium text-ink-600">À OCRiser</p>
          <p className={`text-2xl font-semibold tabular-nums tracking-tight ${totals.withoutText > 0 ? 'text-clay' : ''}`}>{integer.format(totals.withoutText)}</p>
        </div>
      </div>
      <StackedBar
        segments={[
          { key: 'with', label: 'Pages avec texte', value: totals.withText, color: OCR_COLORS.text },
          { key: 'without', label: 'Pages sans texte', value: totals.withoutText, color: OCR_COLORS.image },
        ]}
      />
      {toFix > 0 ? (
        <Link to={`/analyses/${analysisId}/pdf-a-traiter`} className="group mt-auto flex items-center justify-between rounded-md border border-amber-200 bg-amber-50/60 px-3 py-2 text-sm transition-colors hover:border-amber-300">
          <span>
            <span className="font-semibold">{integer.format(toFix)} PDF</span> à traiter pour rendre ces pages lisibles
          </span>
          <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-0.5" aria-hidden />
        </Link>
      ) : null}
    </section>
  )
}

function SiteCard({ row, analysisId }: { row: AnalysisSite; analysisId: string }) {
  const analyzed = analyzedPdfCount(row)
  const active = row.status === 'crawling' || row.status === 'analyzing_pdfs' || row.status === 'pending'
  const base = `/analyses/${analysisId}/sites/${row.id}`
  const figures: Array<[string, number]> = [
    ['Pages', row.htmlCount],
    ['PDF', row.pdfCount],
    ['Pages PDF', row.pdfPages.pages],
    ['Erreurs', row.errorCount],
  ]
  return (
    <article className="card flex h-full flex-col gap-4">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <Link to={base} className="block truncate font-semibold hover:text-accent">
            {row.site.hostname}
          </Link>
          <p className="text-xs text-ink-600">{formatDuration(row.durationMs)}</p>
        </div>
        <StatusBadge value={row.status} />
      </div>

      <dl className="grid grid-cols-4 gap-2 text-center">
        {figures.map(([label, value]) => (
          <div key={label} className="rounded-md bg-paper px-2 py-2 ring-1 ring-inset ring-line">
            <dt className="text-[11px] text-ink-600">{label}</dt>
            <dd className="font-semibold tabular-nums">{integer.format(value)}</dd>
          </div>
        ))}
      </dl>

      {active ? (
        <div className="space-y-2 text-xs text-ink-600">
          {row.sitemapUrlCount ? (
            <div className="space-y-1">
              <div className="flex justify-between">
                <span>Pages ouvertes</span>
                <span className="tabular-nums">
                  {integer.format(row.htmlCount + row.errorCount)} / {integer.format(row.sitemapUrlCount)}
                </span>
              </div>
              <ProgressBar value={row.htmlCount + row.errorCount} max={row.sitemapUrlCount} />
            </div>
          ) : null}
          {row.pdfCount > 0 ? (
            <div className="space-y-1">
              <div className="flex justify-between">
                <span>PDF analysés</span>
                <span className="tabular-nums">
                  {integer.format(analyzed)} / {integer.format(row.pdfCount)}
                </span>
              </div>
              <ProgressBar value={analyzed} max={row.pdfCount} tone="good" />
            </div>
          ) : null}
        </div>
      ) : row.pdfCount > 0 ? (
        <StackedBar height="h-2" legend={false} segments={ocrSegments({ text: row.pdfTextCount, partial: row.pdfPartialCount, image: row.pdfImageCount, error: row.pdfErrorCount, pending: row.pendingPdfCount })} />
      ) : null}

      {row.sitemapSource && row.sitemapSource !== 'live' ? <p className={`text-xs ${SITEMAP_SOURCES[row.sitemapSource].tone}`}>{SITEMAP_SOURCES[row.sitemapSource].text}</p> : null}
      {row.errorMessage ? <p className="text-xs text-clay">{row.errorMessage}</p> : null}

      <div className="mt-auto flex flex-wrap gap-2 border-t border-line pt-3">
        <Link to={`${base}?tab=tree`} className="btn-ghost h-8 px-2.5 text-xs">
          <ListTree className="h-3.5 w-3.5" aria-hidden /> Arborescence
        </Link>
        <Link to={`${base}?tab=pdfs`} className="btn-ghost h-8 px-2.5 text-xs">
          <FileText className="h-3.5 w-3.5" aria-hidden /> PDF
        </Link>
        {row.status === 'completed' ? (
          <Link to={`${base}/evolution`} className="btn-ghost h-8 px-2.5 text-xs" title="Changements depuis l’analyse précédente">
            <TrendingUp className="h-3.5 w-3.5" aria-hidden /> Évolution
          </Link>
        ) : null}
        <a href={sitemapUrl(analysisId, row.id)} className="btn-ghost h-8 px-2.5 text-xs" title="URL découvertes, au format sitemap.xml">
          <Download className="h-3.5 w-3.5" aria-hidden /> sitemap.xml
        </a>
      </div>
    </article>
  )
}

// Seuls les cas où la liste du sitemap mérite une réserve sont signalés ; le détail est dans les erreurs du site.
const SITEMAP_SOURCES: Record<'partial' | 'cache' | 'none', { text: string; tone: string }> = {
  partial: { text: 'Sitemap partiel : certains sous-sitemaps n’ont pas répondu (voir les erreurs).', tone: 'text-amber' },
  cache: { text: 'Sitemap indisponible : dernière version lue utilisée (date dans les erreurs).', tone: 'text-amber' },
  none: { text: 'Aucun sitemap exploitable : le site a été parcouru en suivant ses liens.', tone: 'text-ink-600' },
}
