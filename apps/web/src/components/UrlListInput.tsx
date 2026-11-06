import { splitUrlInput } from '@cartographie/shared'
import { useEffect, useRef, type ClipboardEvent, type KeyboardEvent } from 'react'

export type UrlRow = { id: string; value: string; error?: string }

let counter = 0
export const newRow = (value = ''): UrlRow => ({ id: `row-${Date.now()}-${counter++}`, value })

export function looksLikeUrl(value: string): boolean {
  const text = value.trim()
  if (!text) return false
  try {
    const url = new URL(/^[a-z][a-z0-9+.-]*:\/\//i.test(text) ? text : `https://${text}`)
    return (url.protocol === 'http:' || url.protocol === 'https:') && url.hostname.includes('.')
  } catch {
    return false
  }
}

const key = (value: string) => value.trim().toLowerCase().replace(/^https?:\/\//, '').replace(/^www\./, '').replace(/\/+$/, '')

type Props = {
  rows: UrlRow[]
  onChange: (rows: UrlRow[]) => void
  max?: number
}

export function UrlListInput({ rows, onChange, max = 100 }: Props) {
  const refs = useRef(new Map<string, HTMLInputElement>())
  const focusNext = useRef<string | null>(null)

  useEffect(() => {
    if (!focusNext.current) return
    refs.current.get(focusNext.current)?.focus()
    focusNext.current = null
  })

  const counts = new Map<string, number>()
  for (const row of rows) {
    const k = key(row.value)
    if (k) counts.set(k, (counts.get(k) ?? 0) + 1)
  }

  const update = (id: string, value: string) => onChange(rows.map((row) => (row.id === id ? { ...row, value, error: undefined } : row)))

  const insertAfter = (index: number, values: string[] = ['']) => {
    const room = Math.max(0, max - rows.length)
    const added = values.slice(0, room).map((value) => newRow(value))
    if (!added.length) return
    const next = [...rows.slice(0, index + 1), ...added, ...rows.slice(index + 1)]
    focusNext.current = added[added.length - 1]?.id ?? null
    onChange(next)
  }

  const remove = (index: number) => {
    if (rows.length === 1) {
      onChange([newRow()])
      focusNext.current = null
      return
    }
    const next = rows.filter((_, i) => i !== index)
    focusNext.current = next[Math.max(0, index - 1)]?.id ?? null
    onChange(next)
  }

  const focusRow = (row: UrlRow | undefined) => {
    if (row) refs.current.get(row.id)?.focus()
  }

  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>, index: number) => {
    const row = rows[index]
    if (!row) return
    const following = rows[index + 1]
    if (event.key === 'Enter') {
      event.preventDefault()
      if (!row.value.trim()) return
      if (following && !following.value.trim()) focusRow(following)
      else insertAfter(index)
    } else if (event.key === 'Backspace' && !row.value && rows.length > 1) {
      event.preventDefault()
      remove(index)
    } else if (event.key === 'ArrowDown' && following) {
      event.preventDefault()
      focusRow(following)
    } else if (event.key === 'ArrowUp' && index > 0) {
      event.preventDefault()
      focusRow(rows[index - 1])
    }
  }

  const onPaste = (event: ClipboardEvent<HTMLInputElement>, index: number) => {
    const parts = splitUrlInput(event.clipboardData.getData('text'))
    const [first, ...rest] = parts
    const current = rows[index]
    if (parts.length < 2 || !first || !current) return
    event.preventDefault()
    if (current.value.trim()) {
      insertAfter(index, parts)
    } else {
      const room = Math.max(0, max - rows.length)
      const added = rest.slice(0, room).map((value) => newRow(value))
      const next = [...rows.slice(0, index), { ...current, value: first, error: undefined }, ...added, ...rows.slice(index + 1)]
      focusNext.current = (added[added.length - 1] ?? current).id
      onChange(next)
    }
  }

  return (
    <div className="space-y-2">
      <ol className="space-y-2">
        {rows.map((row, index) => {
          const filled = row.value.trim().length > 0
          const valid = looksLikeUrl(row.value)
          const duplicate = filled && (counts.get(key(row.value)) ?? 0) > 1
          const hint = row.error ?? (filled && !valid ? 'Adresse non reconnue' : duplicate ? 'Déjà dans la liste' : null)
          const tone = row.error || (filled && !valid) ? 'error' : duplicate ? 'warn' : filled ? 'ok' : 'idle'
          return (
            <li key={row.id}>
              <div
                className={`group flex items-center gap-2 rounded-md border bg-card pl-3 pr-1 transition-colors focus-within:ring-2 ${
                  tone === 'error'
                    ? 'border-clay/60 focus-within:ring-clay/15'
                    : tone === 'warn'
                      ? 'border-amber/50 focus-within:ring-amber/15'
                      : 'border-line focus-within:border-accent focus-within:ring-accent/15'
                }`}
              >
                <span className="w-5 shrink-0 text-right font-mono text-xs tabular-nums text-ink-400">{index + 1}</span>
                <StatusDot tone={tone} />
                <input
                  ref={(element) => {
                    if (element) refs.current.set(row.id, element)
                    else refs.current.delete(row.id)
                  }}
                  aria-label={`URL ${index + 1}`}
                  aria-invalid={tone === 'error'}
                  className="min-w-0 flex-1 bg-transparent h-9 font-mono text-[13px] outline-none placeholder:text-ink-400"
                  inputMode="url"
                  autoComplete="off"
                  spellCheck={false}
                  placeholder={index === 0 ? 'https://exemple.fr' : 'https://…'}
                  value={row.value}
                  onChange={(event) => update(row.id, event.target.value)}
                  onKeyDown={(event) => onKeyDown(event, index)}
                  onPaste={(event) => onPaste(event, index)}
                />
                <button
                  type="button"
                  aria-label={`Retirer l’URL ${index + 1}`}
                  title="Retirer"
                  className="grid h-7 w-7 shrink-0 place-items-center rounded text-ink-400 opacity-60 transition hover:bg-paper hover:text-clay group-focus-within:opacity-100 group-hover:opacity-100"
                  onClick={() => remove(index)}
                >
                  <svg viewBox="0 0 20 20" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round">
                    <path d="M5 5l10 10M15 5L5 15" />
                  </svg>
                </button>
              </div>
              {hint ? <p className={`mt-1 pl-[3.25rem] text-xs ${tone === 'warn' ? 'text-amber' : 'text-clay'}`}>{hint}</p> : null}
            </li>
          )
        })}
      </ol>
      <button
        type="button"
        className="flex w-full items-center justify-center gap-2 h-9 rounded-md border border-dashed border-line text-sm font-medium text-ink-600 transition-colors hover:border-ink-400 hover:text-ink-950 disabled:cursor-not-allowed disabled:opacity-50"
        disabled={rows.length >= max}
        onClick={() => insertAfter(rows.length - 1)}
      >
        <svg viewBox="0 0 20 20" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
          <path d="M10 4v12M4 10h12" />
        </svg>
        Ajouter une URL
      </button>
    </div>
  )
}

function StatusDot({ tone }: { tone: 'ok' | 'warn' | 'error' | 'idle' }) {
  const color = tone === 'ok' ? 'bg-emerald-500' : tone === 'warn' ? 'bg-amber' : tone === 'error' ? 'bg-clay' : 'bg-line'
  return <span aria-hidden className={`h-2 w-2 shrink-0 rounded-full transition-colors ${color}`} />
}
