/**
 * Briques d'interface partagées : chiffres clés animés, onglets, barres de répartition, états vides.
 * Une seule grammaire visuelle pour toutes les pages.
 */
import type { LucideIcon } from 'lucide-react'
import { animate, motion, useReducedMotion } from 'motion/react'
import { useEffect, useId, useRef, useState, type ReactNode } from 'react'
import { Link } from 'react-router-dom'

export const integer = new Intl.NumberFormat('fr-FR')

/** Compte jusqu'à la valeur au premier affichage puis à chaque changement (progression en direct). */
export function AnimatedNumber({ value, suffix = '' }: { value: number; suffix?: string }) {
  const reduce = useReducedMotion()
  const [shown, setShown] = useState(reduce ? value : 0)
  const previous = useRef(reduce ? value : 0)
  useEffect(() => {
    if (reduce) return
    const controls = animate(previous.current, value, {
      duration: 0.7,
      ease: [0.16, 1, 0.3, 1],
      onUpdate: (latest) => setShown(Math.round(latest)),
    })
    previous.current = value
    return () => controls.stop()
  }, [value, reduce])
  return (
    <>
      {integer.format(reduce ? value : shown)}
      {suffix}
    </>
  )
}

const TONE_TEXT = { neutral: 'text-ink-950', good: 'text-pine', warn: 'text-amber', bad: 'text-clay', accent: 'text-accent' } as const
const TONE_ICON = {
  neutral: 'bg-paper text-ink-600',
  good: 'bg-moss text-pine',
  warn: 'bg-sand text-amber',
  bad: 'bg-red-50 text-clay',
  accent: 'bg-blue-50 text-accent',
} as const
export type Tone = keyof typeof TONE_TEXT

export function StatCard({
  icon: Icon,
  label,
  value,
  suffix,
  hint,
  tone = 'neutral',
  to,
}: {
  icon: LucideIcon
  label: string
  value: number | null
  suffix?: string
  hint?: ReactNode
  tone?: Tone
  to?: string
}) {
  const body = (
    <>
      <div className="flex items-center justify-between gap-2">
        <p className="text-xs font-medium text-ink-600">{label}</p>
        <span className={`grid h-7 w-7 place-items-center rounded-md ${TONE_ICON[tone]}`}>
          <Icon className="h-3.5 w-3.5" aria-hidden />
        </span>
      </div>
      <p className={`mt-2 text-[28px] font-semibold leading-none tabular-nums tracking-tight ${value === null ? 'text-ink-400' : TONE_TEXT[tone]}`}>
        {value === null ? '—' : <AnimatedNumber value={value} suffix={suffix} />}
      </p>
      {hint ? <p className="mt-2 text-xs text-ink-600">{hint}</p> : null}
    </>
  )
  const className = 'card block p-4 transition-all'
  return to ? (
    <Link to={to} className={`${className} hover:-translate-y-px hover:border-ink-400 hover:shadow-sm`}>
      {body}
    </Link>
  ) : (
    <div className={className}>{body}</div>
  )
}

/** Onglets avec un indicateur qui glisse vers l'onglet choisi. */
export function Tabs<T extends string>({ value, onChange, items }: { value: T; onChange: (next: T) => void; items: Array<{ id: T; label: string; icon?: LucideIcon; count?: number }> }) {
  const group = useId()
  return (
    <div className="flex gap-1 overflow-x-auto border-b border-line" role="tablist">
      {items.map((item) => {
        const active = item.id === value
        const Icon = item.icon
        return (
          <button
            key={item.id}
            type="button"
            role="tab"
            aria-selected={active}
            onClick={() => onChange(item.id)}
            className={`relative flex shrink-0 items-center gap-2 px-3 pb-2.5 pt-1.5 text-sm font-medium transition-colors ${active ? 'text-ink-950' : 'text-ink-600 hover:text-ink-950'}`}
          >
            {Icon ? <Icon className="h-4 w-4" aria-hidden /> : null}
            {item.label}
            {item.count !== undefined ? (
              <span className={`rounded px-1.5 text-xs tabular-nums ${active ? 'bg-ink-950 text-white' : 'bg-paper text-ink-600 ring-1 ring-line'}`}>{integer.format(item.count)}</span>
            ) : null}
            {active ? <motion.span layoutId={`tab-${group}`} className="absolute inset-x-1 -bottom-px h-0.5 rounded-full bg-ink-950" transition={{ type: 'spring', stiffness: 500, damping: 40 }} /> : null}
          </button>
        )
      })}
    </div>
  )
}

export type Segment = { key: string; label: string; value: number; color: string }

/** Barre empilée : la répartition d'un total en segments colorés, avec sa légende. */
export function StackedBar({ segments, height = 'h-2.5', legend = true }: { segments: Segment[]; height?: string; legend?: boolean }) {
  const total = segments.reduce((sum, segment) => sum + segment.value, 0)
  return (
    <div className="space-y-2.5">
      <div className={`flex ${height} gap-px overflow-hidden rounded-full bg-paper ring-1 ring-inset ring-line`} role="img" aria-label={segments.map((s) => `${s.label} : ${s.value}`).join(', ')}>
        {total > 0
          ? segments
              .filter((segment) => segment.value > 0)
              .map((segment) => (
                <motion.div
                  key={segment.key}
                  className="h-full"
                  style={{ backgroundColor: segment.color }}
                  initial={{ width: 0 }}
                  animate={{ width: `${(segment.value / total) * 100}%` }}
                  transition={{ duration: 0.6, ease: [0.16, 1, 0.3, 1] }}
                  title={`${segment.label} : ${integer.format(segment.value)}`}
                />
              ))
          : null}
      </div>
      {legend ? (
        <ul className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-ink-600">
          {segments.map((segment) => (
            <li key={segment.key} className="flex items-center gap-1.5">
              <span className="h-2 w-2 rounded-sm" style={{ backgroundColor: segment.color }} aria-hidden />
              {segment.label}
              <span className="font-medium tabular-nums text-ink-950">{integer.format(segment.value)}</span>
              {total > 0 ? <span className="tabular-nums">· {Math.round((segment.value / total) * 100)} %</span> : null}
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  )
}

/** Progression d'une étape (PDF analysés sur PDF découverts…). */
export function ProgressBar({ value, max, tone = 'accent' }: { value: number; max: number; tone?: 'accent' | 'good' }) {
  const share = max > 0 ? Math.min(100, (value / max) * 100) : 0
  return (
    <div className="h-1.5 overflow-hidden rounded-full bg-paper ring-1 ring-inset ring-line">
      <motion.div
        className={`h-full rounded-full ${tone === 'good' ? 'bg-pine' : 'bg-accent'}`}
        initial={false}
        animate={{ width: `${share}%` }}
        transition={{ duration: 0.5, ease: 'easeOut' }}
      />
    </div>
  )
}

export function PageHeader({ eyebrow, title, description, actions }: { eyebrow?: ReactNode; title: ReactNode; description?: ReactNode; actions?: ReactNode }) {
  return (
    <div className="flex flex-wrap items-end justify-between gap-4">
      <div className="min-w-0">
        {eyebrow ? <div className="mb-1 flex items-center gap-2 text-sm text-ink-600">{eyebrow}</div> : null}
        <h1 className="truncate">{title}</h1>
        {description ? <p className="mt-1 max-w-2xl text-sm text-ink-600">{description}</p> : null}
      </div>
      {actions ? <div className="flex flex-wrap items-center gap-2">{actions}</div> : null}
    </div>
  )
}

export function EmptyState({ icon: Icon, title, children }: { icon: LucideIcon; title: string; children?: ReactNode }) {
  return (
    <div className="flex flex-col items-center rounded-lg border border-dashed border-line px-6 py-12 text-center">
      <span className="grid h-10 w-10 place-items-center rounded-full bg-paper text-ink-600 ring-1 ring-line">
        <Icon className="h-5 w-5" aria-hidden />
      </span>
      <p className="mt-3 text-sm font-medium">{title}</p>
      {children ? <div className="mt-1 max-w-sm text-sm text-ink-600">{children}</div> : null}
    </div>
  )
}

export function Skeleton({ className = '' }: { className?: string }) {
  return <div className={`skeleton rounded-md ${className}`} aria-hidden />
}

/** Apparition douce et décalée des blocs d'une page. */
export function Reveal({ children, delay = 0, className }: { children: ReactNode; delay?: number; className?: string }) {
  return (
    <motion.div className={className} initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.35, delay, ease: 'easeOut' }}>
      {children}
    </motion.div>
  )
}

/** Couleurs des statuts OCR, partagées par les graphiques, les barres et l'arborescence. */
export const OCR_COLORS = { text: '#16a34a', partial: '#f59e0b', image: '#dc2626', error: '#71717a', pending: '#d4d4d8' } as const

export function ocrSegments(counts: { text: number; partial: number; image: number; error: number; pending?: number }): Segment[] {
  return [
    { key: 'text', label: 'Avec texte', value: counts.text, color: OCR_COLORS.text },
    { key: 'partial', label: 'Partiels', value: counts.partial, color: OCR_COLORS.partial },
    { key: 'image', label: 'Non OCRisés', value: counts.image, color: OCR_COLORS.image },
    { key: 'error', label: 'Illisibles', value: counts.error, color: OCR_COLORS.error },
    ...(counts.pending ? [{ key: 'pending', label: 'En attente', value: counts.pending, color: OCR_COLORS.pending }] : []),
  ]
}
