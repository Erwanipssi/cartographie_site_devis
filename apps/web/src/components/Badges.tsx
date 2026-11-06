import { OCR_LABELS, type OcrStatus } from '@cartographie/shared'
import type { ReactNode } from 'react'

const statusClass: Record<string, string> = {
  pending: 'bg-paper text-ink-600',
  running: 'bg-moss text-pine',
  crawling: 'bg-moss text-pine',
  analyzing_pdfs: 'bg-sand text-amber',
  completed: 'bg-moss text-pine',
  failed: 'bg-sand text-clay',
  cancelled: 'bg-sand text-amber',
}

const statusLabel: Record<string, string> = {
  pending: 'En attente',
  running: 'En cours',
  crawling: 'Crawl',
  analyzing_pdfs: 'Analyse PDF',
  completed: 'Terminé',
  failed: 'Échec',
  cancelled: 'Annulé',
  manual: 'Manuel',
  scheduled: 'Planifié',
}

const ocrClass: Record<OcrStatus, string> = {
  pending: 'bg-paper text-ink-600',
  text: 'bg-moss text-pine',
  image: 'bg-sand text-clay',
  partial: 'bg-sand text-amber',
  error: 'bg-paper text-ink-800',
}

export function StatusBadge({ value }: { value: string }) {
  return <span className={`inline-flex rounded-full px-2 py-0.5 text-xs font-semibold ${statusClass[value] ?? 'bg-paper text-ink-600'}`}>{statusLabel[value] ?? value}</span>
}

export function OcrBadge({ value }: { value: OcrStatus }) {
  return <span className={`inline-flex rounded-full px-2 py-0.5 text-xs font-semibold ${ocrClass[value]}`}>{OCR_LABELS[value]}</span>
}

export function Notice({ tone, children }: { tone: 'error' | 'ok' | 'info'; children: ReactNode }) {
  const toneClass = tone === 'error' ? 'bg-sand text-clay' : tone === 'ok' ? 'bg-moss text-pine' : 'bg-card text-ink-800'
  return <p className={`rounded-md px-3 py-2 text-sm ${toneClass}`}>{children}</p>
}
