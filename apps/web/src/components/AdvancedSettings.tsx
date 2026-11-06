import { crawlConfigSchema, type CrawlConfig } from '@cartographie/shared'

type Key = keyof CrawlConfig

export function AdvancedSettings({ value, onChange }: { value: CrawlConfig; onChange: (value: CrawlConfig) => void }) {
  const set = (key: Key, next: number | boolean) => {
    const parsed = crawlConfigSchema.safeParse({ ...value, [key]: next })
    if (parsed.success) onChange(parsed.data)
  }
  return (
    <details className="card">
      <summary className="cursor-pointer font-semibold">Réglages avancés</summary>
      <div className="mt-4 grid gap-3 sm:grid-cols-2">
        <Field label="Profondeur max" value={value.maxDepth} min={0} max={8} onChange={(next) => set('maxDepth', next)} />
        <Field label="Pages HTML max" value={value.maxPages} min={1} max={5000} onChange={(next) => set('maxPages', next)} />
        <Field label="PDF max" value={value.maxPdfs} min={1} max={2000} onChange={(next) => set('maxPdfs', next)} />
        <Field label="Requêtes simultanées" value={value.concurrency} min={1} max={10} onChange={(next) => set('concurrency', next)} />
        <Field label="Délai entre requêtes (ms)" value={value.delayMs} min={0} max={5000} onChange={(next) => set('delayMs', next)} />
        <Field label="Timeout (ms)" value={value.timeoutMs} min={3000} max={60000} step={1000} onChange={(next) => set('timeoutMs', next)} />
        <Field label="Caractères min / page" value={value.ocrMinChars} min={1} max={1000} onChange={(next) => set('ocrMinChars', next)} />
        <label className="text-sm">
          Taille PDF max (Mo)
          <input
            className="field mt-1"
            type="number"
            min={1}
            max={100}
            value={Math.round(value.pdfMaxBytes / 1024 / 1024)}
            onChange={(event) => set('pdfMaxBytes', Number(event.target.value) * 1024 * 1024)}
          />
        </label>
        <label className="text-sm">
          Ratio texte
          <input className="field mt-1" type="number" min={0.05} max={1} step={0.05} value={value.textRatio} onChange={(event) => set('textRatio', Number(event.target.value))} />
        </label>
        <label className="text-sm">
          Ratio image
          <input className="field mt-1" type="number" min={0} max={0.95} step={0.05} value={value.imageRatio} onChange={(event) => set('imageRatio', Number(event.target.value))} />
        </label>
        <label className="flex items-center gap-2 text-sm sm:col-span-2">
          <input type="checkbox" checked={value.respectRobots} onChange={(event) => set('respectRobots', event.target.checked)} />
          Respecter robots.txt
        </label>
      </div>
      <p className="mt-3 text-xs text-ink-600">Un PDF est « texte » si la part de pages avec assez de caractères atteint le ratio texte, « image » en dessous du ratio image, sinon « partiel ».</p>
    </details>
  )
}

function Field({ label, value, min, max, step = 1, onChange }: { label: string; value: number; min: number; max: number; step?: number; onChange: (value: number) => void }) {
  return (
    <label className="text-sm">
      {label}
      <input className="field mt-1" type="number" min={min} max={max} step={step} value={value} onChange={(event) => onChange(Number(event.target.value))} />
    </label>
  )
}
