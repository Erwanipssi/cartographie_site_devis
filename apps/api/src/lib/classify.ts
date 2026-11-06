export type ResourceKind = 'html' | 'pdf' | 'other'

function pathOf(url: string): string {
  try {
    return new URL(url).pathname.toLowerCase()
  } catch {
    return ''
  }
}

export function looksLikePdf(url: string): boolean {
  return pathOf(url).endsWith('.pdf')
}

export function classifyContentType(contentType: string | null, url: string): ResourceKind {
  const mime = (contentType ?? '').split(';')[0]?.trim().toLowerCase() ?? ''
  if (mime === 'text/html' || mime === 'application/xhtml+xml') return 'html'
  if (mime === 'application/pdf' || mime === 'application/x-pdf') return 'pdf'
  if (mime === '' || mime === 'application/octet-stream' || mime === 'binary/octet-stream') {
    const path = pathOf(url)
    if (path.endsWith('.pdf')) return 'pdf'
    if (path.endsWith('.html') || path.endsWith('.htm') || path.endsWith('.xhtml') || path.endsWith('/')) return 'html'
  }
  return 'other'
}
