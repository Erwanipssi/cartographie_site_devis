import { useQuery } from '@tanstack/react-query'
import { Link, useParams, useSearchParams } from 'react-router-dom'
import { Notice } from '../components/Badges'
import { insights, type EvolutionPdf } from '../lib/api'
import { formatDate } from '../lib/format'

const OCR_LABEL: Record<string, string> = { text: 'texte', partial: 'partiel', image: 'non OCRisé', error: 'illisible', pending: 'en attente' }

export function EvolutionPage() {
  const { id = '', analysisSiteId = '' } = useParams()
  const [params, setParams] = useSearchParams()
  const previousId = params.get('avec') ?? undefined
  const evolution = useQuery({
    queryKey: ['evolution', id, analysisSiteId, previousId],
    queryFn: () => insights.evolution(id, analysisSiteId, previousId),
  })
  const data = evolution.data

  return (
    <div className="space-y-6">
      <Link className="text-sm font-medium text-ink-600 hover:text-ink-950" to={`/analyses/${id}`}>
        Retour à l’analyse
      </Link>
      <div>
        <h1>Évolution · {data?.site ?? '…'}</h1>
        <p className="mt-1 text-sm text-ink-600">Ce qui a changé sur le site entre deux analyses : documents publiés ou retirés, corrections et régressions.</p>
      </div>

      {evolution.isError ? <Notice tone="error">{evolution.error instanceof Error ? evolution.error.message : 'Évolution indisponible'}</Notice> : null}

      {data && !data.previous ? (
        <Notice tone="info">C’est la première analyse terminée de ce site : l’évolution sera disponible après la prochaine.</Notice>
      ) : null}

      {data?.previous ? (
        <>
          <div className="card flex flex-wrap items-center gap-3 text-sm">
            <span className="text-ink-600">Comparée à l’analyse du</span>
            <select
              className="field w-auto"
              aria-label="Analyse de comparaison"
              value={data.previous.id}
              onChange={(event) => {
                const copy = new URLSearchParams(params)
                copy.set('avec', event.target.value)
                setParams(copy)
              }}
            >
              {data.candidates.map((run) => (
                <option key={run.id} value={run.id}>
                  {formatDate(run.date)} · {run.mode === 'sitemap' ? 'sitemap' : 'crawl'} · {run.htmlCount} pages
                </option>
              ))}
            </select>
            {data.previous.mode !== data.current.mode ? (
              <span className="text-amber">Mode différent ({data.previous.mode} → {data.current.mode}) : les écarts de pages peuvent venir du mode, pas du site.</span>
            ) : null}
          </div>

          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <Delta label="Pages" before={data.previous.htmlCount} now={data.current.htmlCount} neutral />
            <Delta label="PDF" before={data.previous.pdfCount} now={data.current.pdfCount} neutral />
            <Delta
              label="PDF à traiter (texte)"
              before={data.previous.pdfImageCount + data.previous.pdfPartialCount}
              now={data.current.pdfImageCount + data.current.pdfPartialCount}
              lowerIsBetter
            />
            {data.accessibility && data.accessibility.before.checked > 0 && data.accessibility.now.checked > 0 ? (
              <Delta label="PDF accessibles" before={data.accessibility.before.conform} now={data.accessibility.now.conform} />
            ) : (
              // Une analyse antérieure aux contrôles d'accessibilité n'a pas de chiffre : « — », pas 0.
              <div className="card">
                <p className="text-xs font-medium text-ink-600">PDF accessibles</p>
                <p className="mt-1 text-2xl font-semibold tabular-nums tracking-tight">
                  {data.accessibility && data.accessibility.now.checked > 0 ? data.accessibility.now.conform : '—'}
                </p>
                <p className="mt-1 text-xs text-ink-600">
                  {data.accessibility && data.accessibility.now.checked > 0 ? 'Pas de contrôle dans l’analyse précédente' : 'Non contrôlés : relancez une analyse'}
                </p>
              </div>
            )}
          </div>

          {data.pdfs && data.pages ? (
            <div className="grid gap-4 lg:grid-cols-2">
              <PdfList title="Couche texte ajoutée" tone="good" list={data.pdfs.textFixed} change={(pdf) => `${OCR_LABEL[pdf.before?.ocrStatus ?? ''] ?? '?'} → ${OCR_LABEL[pdf.ocrStatus] ?? pdf.ocrStatus}`} />
              <PdfList title="Couche texte dégradée" tone="bad" list={data.pdfs.textRegressed} change={(pdf) => `${OCR_LABEL[pdf.before?.ocrStatus ?? ''] ?? '?'} → ${OCR_LABEL[pdf.ocrStatus] ?? pdf.ocrStatus}`} />
              <PdfList title="Accessibilité améliorée" tone="good" list={data.pdfs.a11yImproved} />
              <PdfList title="Accessibilité dégradée" tone="bad" list={data.pdfs.a11yRegressed} />
              <PdfList title="PDF publiés depuis" tone="neutral" list={data.pdfs.added} change={(pdf) => OCR_LABEL[pdf.ocrStatus] ?? pdf.ocrStatus} />
              <PdfList title="PDF retirés depuis" tone="neutral" list={data.pdfs.removed} />
              <UrlList title="Pages apparues" list={data.pages.added} />
              <UrlList title="Pages disparues" list={data.pages.removed} />
            </div>
          ) : null}
        </>
      ) : null}
    </div>
  )
}

function Delta({ label, before, now, lowerIsBetter = false, neutral = false }: { label: string; before: number; now: number; lowerIsBetter?: boolean; neutral?: boolean }) {
  const diff = now - before
  const good = diff === 0 || neutral ? null : lowerIsBetter ? diff < 0 : diff > 0
  return (
    <div className="card">
      <p className="text-xs font-medium text-ink-600">{label}</p>
      <p className="mt-1 text-2xl font-semibold tabular-nums tracking-tight">{now}</p>
      <p className={`mt-1 text-xs tabular-nums ${good === null ? 'text-ink-600' : good ? 'text-pine' : 'text-clay'}`}>
        {diff === 0 ? 'Inchangé' : `${diff > 0 ? '+' : ''}${diff} (avant : ${before})`}
      </p>
    </div>
  )
}

const TONES = { good: 'text-pine', bad: 'text-clay', neutral: 'text-ink-950' } as const

function Section({ title, tone, total, shown, children }: { title: string; tone: keyof typeof TONES; total: number; shown: number; children: React.ReactNode }) {
  return (
    <section className="card space-y-2">
      <div className="flex items-baseline justify-between gap-2">
        <h2 className={`text-sm ${total > 0 ? TONES[tone] : 'text-ink-600'}`}>{title}</h2>
        <span className="text-sm font-semibold tabular-nums">{total}</span>
      </div>
      {total === 0 ? <p className="text-xs text-ink-600">Aucun</p> : children}
      {total > shown ? <p className="text-xs text-ink-600">{shown} premiers affichés sur {total}.</p> : null}
    </section>
  )
}

function PdfList({ title, tone, list, change }: { title: string; tone: keyof typeof TONES; list: { total: number; items: EvolutionPdf[] }; change?: (pdf: EvolutionPdf) => string }) {
  return (
    <Section title={title} tone={tone} total={list.total} shown={list.items.length}>
      <ul className="max-h-72 space-y-1 overflow-y-auto text-sm">
        {list.items.map((pdf) => (
          <li key={pdf.url} className="flex items-baseline justify-between gap-3">
            <a className="truncate text-accent underline-offset-2 hover:underline" href={pdf.url} target="_blank" rel="noreferrer" title={pdf.url}>
              {pdf.name}
            </a>
            {change ? <span className="shrink-0 text-xs text-ink-600">{change(pdf)}</span> : null}
          </li>
        ))}
      </ul>
    </Section>
  )
}

function UrlList({ title, list }: { title: string; list: { total: number; items: string[] } }) {
  return (
    <Section title={title} tone="neutral" total={list.total} shown={list.items.length}>
      <ul className="max-h-72 space-y-1 overflow-y-auto text-sm">
        {list.items.map((url) => (
          <li key={url} className="truncate">
            <a className="text-ink-800 underline-offset-2 hover:underline" href={url} target="_blank" rel="noreferrer" title={url}>
              {url.replace(/^https?:\/\/(www\.)?/, '')}
            </a>
          </li>
        ))}
      </ul>
    </Section>
  )
}
