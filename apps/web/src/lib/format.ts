export function formatBytes(value: number | null | undefined): string {
  if (value == null) return '—'
  if (value < 1024) return `${value} o`
  if (value < 1024 * 1024) return `${Math.round(value / 1024)} Ko`
  return `${(value / 1024 / 1024).toFixed(1)} Mo`
}

export function formatDuration(value: number | null | undefined): string {
  if (value == null) return '—'
  const seconds = Math.max(0, Math.round(value / 1000))
  if (seconds < 60) return `${seconds} s`
  return `${Math.floor(seconds / 60)} min ${seconds % 60} s`
}

export function formatDate(value: string | null | undefined): string {
  if (!value) return '—'
  return new Intl.DateTimeFormat('fr-FR', { dateStyle: 'short', timeStyle: 'short' }).format(new Date(value))
}

export function analyzedPdfCount(row: { pdfTextCount: number; pdfImageCount: number; pdfPartialCount: number; pdfErrorCount: number }): number {
  return row.pdfTextCount + row.pdfImageCount + row.pdfPartialCount + row.pdfErrorCount
}
