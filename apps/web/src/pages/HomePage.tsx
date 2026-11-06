import { crawlConfigSchema, type CrawlConfig } from '@cartographie/shared'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { AdvancedSettings } from '../components/AdvancedSettings'
import { Notice } from '../components/Badges'
import { RecipientPicker } from '../components/RecipientPicker'
import { looksLikeUrl, newRow, UrlListInput, type UrlRow } from '../components/UrlListInput'
import { api } from '../lib/api'

// Sitemap : rapide, on lit le sitemap et on n'ouvre que ses pages pour y relever les PDF.
// Crawl complet : suit tous les liens, plus lent, utile quand le site n'a pas de sitemap fiable.
const SCOPES = {
  sitemap: {
    label: 'Sitemap',
    hint: 'Pages du sitemap et PDF qu’elles contiennent',
    values: { mode: 'sitemap', maxDepth: 8, maxPages: 5000, maxPdfs: 2000, delayMs: 100, concurrency: 6 },
  },
  crawl: {
    label: 'Crawl complet',
    hint: 'Suit tous les liens du site (plus lent)',
    values: { mode: 'crawl', maxDepth: 8, maxPages: 5000, maxPdfs: 2000, delayMs: 200, concurrency: 4 },
  },
} as const
type Scope = keyof typeof SCOPES

const scopeOf = (config: CrawlConfig): Scope => config.mode

export function HomePage() {
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const sites = useQuery({ queryKey: ['sites'], queryFn: api.sites })
  const health = useQuery({ queryKey: ['health'], queryFn: api.health, refetchInterval: 5000 })
  const [rows, setRows] = useState<UrlRow[]>(() => [newRow()])
  const [config, setConfig] = useState<CrawlConfig>(() => crawlConfigSchema.parse(SCOPES.sitemap.values))
  const scope = scopeOf(config)
  const [emailOnComplete, setEmailOnComplete] = useState(false)
  const [recipientIds, setRecipientIds] = useState<string[]>([])
  const [feedback, setFeedback] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const add = useMutation({
    mutationFn: (urls: string[]) => api.addSites(urls),
    onSuccess: (result) => {
      void queryClient.invalidateQueries({ queryKey: ['sites'] })
      // Les URL refusées restent dans le formulaire, avec la raison sous le champ.
      const reasons = new Map(result.rejected.map((item) => [item.url.trim(), item.reason]))
      const remaining = rows.filter((row) => reasons.has(row.value.trim())).map((row) => ({ ...row, error: reasons.get(row.value.trim()) }))
      setRows(remaining.length ? remaining : [newRow()])
      const parts = [
        result.created.length ? `${result.created.length} ajouté(s)` : '',
        result.restored.length ? `${result.restored.length} restauré(s)` : '',
        result.existing.length ? `${result.existing.length} déjà présent(s)` : '',
        result.rejected.length ? `${result.rejected.length} refusé(s)` : '',
      ].filter(Boolean)
      const message = parts.join(' · ') || 'Aucune URL nouvelle.'
      const nothingAdded = result.created.length + result.restored.length === 0
      if (result.rejected.length && nothingAdded) {
        setFeedback(null)
        setError(`${message} — voir le détail sous chaque champ.`)
      } else {
        setFeedback(message)
        setError(null)
      }
    },
    onError: (reason) => setError(reason instanceof Error ? reason.message : 'Ajout impossible'),
  })

  const update = useMutation({
    mutationFn: ({ id, includeSubdomains }: { id: string; includeSubdomains: boolean }) => api.updateSite(id, includeSubdomains),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ['sites'] }),
  })
  const remove = useMutation({
    mutationFn: (id: string) => api.deleteSite(id),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ['sites'] }),
  })
  const launch = useMutation({
    mutationFn: () =>
      api.createAnalysis({
        siteIds: (sites.data?.sites ?? []).map((site) => site.id),
        config,
        emailOnComplete,
        recipientIds,
      }),
    onSuccess: (result) => navigate(`/analyses/${result.analysis.id}`),
    onError: (reason) => setError(reason instanceof Error ? reason.message : 'Lancement impossible'),
  })

  const list = sites.data?.sites ?? []
  const filled = [...new Set(rows.map((row) => row.value.trim()).filter(Boolean))]
  const validCount = filled.filter(looksLikeUrl).length

  return (
    <div className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_320px]">
      <section className="space-y-6">
        <div>
          <h1 className="text-2xl">Sites à cartographier</h1>
          <p className="mt-1 max-w-2xl text-sm text-ink-600">Ajoutez les sites un par un. L’analyse compte les pages HTML, les PDF, et indique si chaque PDF contient une couche de texte exploitable.</p>
        </div>
        {health.data && !health.data.worker ? <Notice tone="info">Le worker est arrêté. Lancez <code>pnpm dev:worker</code> pour exécuter les analyses.</Notice> : null}
        {health.data && !health.data.db ? <Notice tone="error">Base PostgreSQL indisponible. Lancez <code>pnpm infra</code>.</Notice> : null}

        <form
          className="card space-y-4 p-0 pb-5 [&>*]:px-5 [&>*:first-child]:border-b [&>*:first-child]:border-line [&>*:first-child]:py-3"
          onSubmit={(event) => {
            event.preventDefault()
            setError(null)
            setFeedback(null)
            if (!filled.length) {
              setError('Saisissez au moins une URL.')
              return
            }
            add.mutate(filled)
          }}
        >
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <h2 className="text-sm">Nouvelles URL</h2>
            <p className="text-xs text-ink-600">
              <kbd className="kbd">Entrée</kbd> nouvelle ligne · <kbd className="kbd">⌫</kbd> sur une ligne vide la retire
            </p>
          </div>
          <UrlListInput rows={rows} onChange={setRows} />
          <div className="flex flex-wrap items-center justify-between gap-3 border-t border-line pt-4">
            <p className="text-sm text-ink-600">{filled.length === 0 ? 'Aucune URL saisie' : `${validCount} / ${filled.length} URL valide(s)`}</p>
            <div className="flex gap-2">
              {filled.length > 0 ? (
                <button type="button" className="btn-ghost" onClick={() => setRows([newRow()])}>
                  Tout effacer
                </button>
              ) : null}
              <button className="btn-primary" type="submit" disabled={add.isPending || filled.length === 0}>
                {add.isPending ? 'Ajout…' : filled.length > 1 ? `Ajouter les ${filled.length} sites` : 'Ajouter le site'}
              </button>
            </div>
          </div>
        </form>
        {feedback ? <Notice tone="ok">{feedback}</Notice> : null}
        {error ? <Notice tone="error">{error}</Notice> : null}

        <div className="space-y-3">
          <div className="flex items-center gap-2">
            <h2 className="text-sm">Sites enregistrés</h2>
            <span className="rounded-md border border-line bg-card px-1.5 text-xs font-medium tabular-nums text-ink-600">{list.length}</span>
          </div>
          {list.length === 0 ? (
            <div className="rounded-lg border border-dashed border-line px-6 py-10 text-center text-sm text-ink-600">Aucun site pour le moment. Ajoutez une première URL ci-dessus.</div>
          ) : (
            <ul className="divide-y divide-line overflow-hidden rounded-lg border border-line bg-card">
              {list.map((site) => (
                <li key={site.id} className="flex flex-wrap items-center gap-x-4 gap-y-2 px-4 py-3 transition hover:bg-paper">
                  <div className="grid h-8 w-8 shrink-0 place-items-center rounded-md border border-line bg-paper text-xs font-medium uppercase text-ink-600">{site.hostname.replace(/^www\./, '').charAt(0)}</div>
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-sm font-medium">{site.hostname}</div>
                    <div className="truncate font-mono text-xs text-ink-600">{site.normalizedUrl}</div>
                  </div>
                  <label className="flex cursor-pointer items-center gap-2 text-sm text-ink-800">
                    <input type="checkbox" className="accent-ink-950" checked={site.includeSubdomains} onChange={(event) => update.mutate({ id: site.id, includeSubdomains: event.target.checked })} />
                    Sous-domaines
                  </label>
                  <button type="button" className="rounded-md px-2 py-1 text-sm text-ink-600 transition-colors hover:bg-red-50 hover:text-clay" onClick={() => remove.mutate(site.id)}>
                    Retirer
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      </section>

      <aside className="space-y-4 lg:sticky lg:top-6 lg:self-start">
        <div className="card space-y-3">
          <h2 className="text-sm">Mode d’analyse</h2>
          <div className="grid grid-cols-2 gap-1 rounded-md border border-line bg-paper p-1" role="radiogroup" aria-label="Mode d’analyse">
            {(Object.keys(SCOPES) as Scope[]).map((key) => (
              <button
                key={key}
                type="button"
                role="radio"
                aria-checked={scope === key}
                className={`rounded px-2 py-1.5 text-sm font-medium transition-colors ${scope === key ? 'bg-card text-ink-950 shadow-sm ring-1 ring-line' : 'text-ink-600 hover:text-ink-950'}`}
                onClick={() => setConfig(crawlConfigSchema.parse({ ...config, ...SCOPES[key].values }))}
              >
                {SCOPES[key].label}
              </button>
            ))}
          </div>
          <p className="text-xs text-ink-600">
            {SCOPES[scope].hint}
            {scope === 'crawl' ? ` · profondeur ${config.maxDepth}` : ''} · {config.maxPages} pages · {config.maxPdfs} PDF max
          </p>
        </div>
        <AdvancedSettings value={config} onChange={setConfig} />
        <div className="card space-y-3">
          <label className="flex items-center gap-2 text-sm font-semibold">
            <input type="checkbox" className="accent-ink-950" checked={emailOnComplete} onChange={(event) => setEmailOnComplete(event.target.checked)} />
            Envoyer le rapport à la fin
          </label>
          {emailOnComplete ? <RecipientPicker selected={recipientIds} onChange={setRecipientIds} /> : null}
          {emailOnComplete && health.data && !health.data.smtp ? <p className="text-xs text-amber">SMTP non configuré : l’envoi sera journalisé en échec.</p> : null}
          <button
            className="btn-primary w-full"
            type="button"
            disabled={list.length === 0 || launch.isPending}
            onClick={() => {
              setError(null)
              launch.mutate()
            }}
          >
            Lancer l’analyse
          </button>
          <p className="text-xs text-ink-600">
            {list.length} site(s) à analyser
          </p>
        </div>
      </aside>
    </div>
  )
}
