import {
  createAnalysisSchema,
  createRecipientSchema,
  createScheduleSchema,
  createSitesSchema,
  updateScheduleSchema,
  updateSiteSchema,
  type CrawlConfig,
  type OcrStatus,
} from '@cartographie/shared'

export type Site = {
  id: string
  inputUrl: string
  normalizedUrl: string
  hostname: string
  origin: string
  includeSubdomains: boolean
  createdAt: string
}

export type AnalysisStatus = 'pending' | 'running' | 'completed' | 'failed' | 'cancelled'
export type SiteRunStatus = 'pending' | 'crawling' | 'analyzing_pdfs' | 'completed' | 'failed' | 'cancelled'

export type AnalysisSite = {
  id: string
  status: SiteRunStatus
  htmlCount: number
  pdfCount: number
  pdfTextCount: number
  pdfImageCount: number
  pdfPartialCount: number
  pdfErrorCount: number
  otherCount: number
  errorCount: number
  pendingPdfCount: number
  sitemapUrlCount: number | null
  sitemapSource: 'live' | 'partial' | 'cache' | 'none' | null
  durationMs: number | null
  errorMessage: string | null
  startedAt: string | null
  finishedAt: string | null
  site: { id: string; hostname: string; normalizedUrl: string; inputUrl: string; includeSubdomains: boolean }
}

export type AnalysisDetail = {
  id: string
  status: AnalysisStatus
  trigger: 'manual' | 'scheduled'
  config: CrawlConfig
  emailOnComplete: boolean
  notifyEmails: string[]
  failureReason: string | null
  startedAt: string | null
  finishedAt: string | null
  createdAt: string
}

export type Recipient = { id: string; email: string; label: string | null; createdAt: string }

export type Schedule = {
  id: string
  name: string
  cron: string
  timezone: string
  enabled: boolean
  emailOnComplete: boolean
  config: CrawlConfig
  lastRunAt: string | null
  createdAt: string
  siteIds: string[]
  recipientIds: string[]
}

export type PageRow = {
  id: string
  url: string
  httpStatus: number | null
  depth: number
  parentUrl: string | null
  contentType: string | null
  sizeBytes: number | null
}

export type PdfRow = {
  id: string
  url: string
  httpStatus: number | null
  ocrStatus: OcrStatus
  pageCount: number | null
  pagesWithText: number | null
  pagesWithoutText: number | null
  sizeBytes: number | null
  errorMessage: string | null
}

export type ErrorRow = {
  id: string
  url: string
  errorType: string
  httpStatus: number | null
  message: string
  createdAt: string
}

export type PageResult<T> = { items: T[]; total: number; page: number; pageSize: number }

export type Health = { ok: boolean; db: boolean; redis: boolean; worker: boolean; smtp: boolean }

/** Émis quand l'API répond « connexion requise » : l'application affiche alors l'écran de connexion. */
export const AUTH_REQUIRED_EVENT = 'cartographie:auth-required'

function signalAuth(response: Response): void {
  if (response.status === 401) window.dispatchEvent(new Event(AUTH_REQUIRED_EVENT))
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, {
    ...init,
    headers: {
      ...(init?.body ? { 'content-type': 'application/json' } : {}),
      ...init?.headers,
    },
  })
  signalAuth(response)
  if (!response.ok) {
    const body = (await response.json().catch(() => null)) as { error?: { message?: string } } | null
    throw new Error(body?.error?.message ?? `Erreur ${response.status}`)
  }
  return response.json() as Promise<T>
}

function query(params: Record<string, string | number | undefined>): string {
  const search = new URLSearchParams()
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== '') search.set(key, String(value))
  }
  const text = search.toString()
  return text ? `?${text}` : ''
}

export const api = {
  health: () => request<Health>('/api/health'),
  sites: () => request<{ sites: Site[] }>('/api/sites'),
  addSites: (urls: string[]) =>
    request<{ created: Site[]; restored: Site[]; existing: Site[]; rejected: Array<{ url: string; reason: string }> }>('/api/sites', {
      method: 'POST',
      body: JSON.stringify(createSitesSchema.parse({ urls })),
    }),
  updateSite: (id: string, includeSubdomains: boolean) =>
    request<{ site: Site }>(`/api/sites/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(updateSiteSchema.parse({ includeSubdomains })),
    }),
  deleteSite: (id: string) => request<{ ok: boolean }>(`/api/sites/${id}`, { method: 'DELETE' }),
  createAnalysis: (input: { siteIds: string[]; config: CrawlConfig; emailOnComplete: boolean; recipientIds: string[] }) =>
    request<{ analysis: { id: string; status: AnalysisStatus } }>('/api/analyses', {
      method: 'POST',
      body: JSON.stringify(createAnalysisSchema.parse(input)),
    }),
  analyses: (page = 1) =>
    request<{
      analyses: Array<{
        id: string
        status: AnalysisStatus
        trigger: 'manual' | 'scheduled'
        createdAt: string
        startedAt: string | null
        finishedAt: string | null
        emailOnComplete: boolean
        failureReason: string | null
        siteCount: number
      }>
      total: number
      page: number
      pageSize: number
    }>(`/api/analyses?page=${page}`),
  analysis: (id: string) => request<{ analysis: AnalysisDetail; totals: Record<string, number> }>(`/api/analyses/${id}`),
  analysisSites: (id: string) => request<{ sites: AnalysisSite[] }>(`/api/analyses/${id}/sites`),
  cancelAnalysis: (id: string) => request<{ ok: boolean }>(`/api/analyses/${id}/cancel`, { method: 'POST' }),
  pages: (analysisId: string, analysisSiteId: string, params: Record<string, string | number | undefined>) =>
    request<PageResult<PageRow>>(`/api/analyses/${analysisId}/sites/${analysisSiteId}/pages${query(params)}`),
  pdfs: (analysisId: string, analysisSiteId: string, params: Record<string, string | number | undefined>) =>
    request<PageResult<PdfRow>>(`/api/analyses/${analysisId}/sites/${analysisSiteId}/pdfs${query(params)}`),
  errors: (analysisId: string, analysisSiteId: string, params: Record<string, string | number | undefined>) =>
    request<PageResult<ErrorRow>>(`/api/analyses/${analysisId}/sites/${analysisSiteId}/errors${query(params)}`),
  sendMail: (id: string, recipientIds: string[]) =>
    request<{ queued: true }>(`/api/analyses/${id}/email`, { method: 'POST', body: JSON.stringify({ recipientIds }) }),
  recipients: () => request<{ recipients: Recipient[] }>('/api/recipients'),
  addRecipient: (email: string, label?: string) =>
    request<{ recipient: Recipient }>('/api/recipients', {
      method: 'POST',
      body: JSON.stringify(createRecipientSchema.parse({ email, label: label || undefined })),
    }),
  deleteRecipient: (id: string) => request<{ ok: boolean }>(`/api/recipients/${id}`, { method: 'DELETE' }),
  deliveries: (analysisId?: string) => request<{ deliveries: Array<{ id: string; analysisId: string; recipients: string[]; status: string; error: string | null; trigger: string; sentAt: string | null; createdAt: string }> }>(`/api/mail-deliveries${analysisId ? `?analysisId=${analysisId}` : ''}`),
  schedules: () => request<{ schedules: Schedule[] }>('/api/schedules'),
  createSchedule: (input: unknown) =>
    request<{ schedule: Schedule }>('/api/schedules', {
      method: 'POST',
      body: JSON.stringify(createScheduleSchema.parse(input)),
    }),
  updateSchedule: (id: string, input: unknown) =>
    request<{ schedule: Schedule }>(`/api/schedules/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(updateScheduleSchema.parse(input)),
    }),
  deleteSchedule: (id: string) => request<{ ok: boolean }>(`/api/schedules/${id}`, { method: 'DELETE' }),
  runSchedule: (id: string) => request<{ started: boolean }>(`/api/schedules/${id}/run`, { method: 'POST' }),
}

export function exportUrl(analysisId: string): string {
  return `/api/analyses/${analysisId}/export`
}

export function sitemapUrl(analysisId: string, analysisSiteId: string): string {
  return `/api/analyses/${analysisId}/sites/${analysisSiteId}/sitemap.xml`
}

export type TriageStatus = 'image' | 'partial' | 'error'

export type PdfToFix = {
  url: string
  name: string
  ocrStatus: TriageStatus
  pageCount: number | null
  pagesWithoutText: number | null
  sizeBytes: number | null
  parentUrl: string | null
  errorMessage: string | null
  site: string
  analysisSiteId: string
}

export type PdfsToFixResult = PageResult<PdfToFix> & { counts: Record<TriageStatus, number> }

export function pdfsToFix(analysisId: string, params: Record<string, string | number | undefined>): Promise<PdfsToFixResult> {
  const search = new URLSearchParams()
  for (const [key, value] of Object.entries(params)) if (value !== undefined && value !== '') search.set(key, String(value))
  return fetch(`/api/analyses/${analysisId}/pdfs-to-fix?${search}`).then(async (response) => {
    signalAuth(response)
    if (!response.ok) throw new Error(`Erreur ${response.status}`)
    return response.json() as Promise<PdfsToFixResult>
  })
}

export function pdfsToFixCsvUrl(analysisId: string, statuses: TriageStatus[]): string {
  return `/api/analyses/${analysisId}/pdfs-to-fix.csv?status=${statuses.join(',')}`
}

export type A11yIssue = 'untagged' | 'notitle' | 'nolang'

export type PdfAccessibility = {
  url: string
  name: string
  ocrStatus: string
  tagged: boolean | null
  title: string | null
  titleStatus: 'ok' | 'missing' | 'generic' | null
  lang: string | null
  parentUrl: string | null
  site: string
  analysisSiteId: string
  issues: A11yIssue[]
}

export type PdfsAccessibilityResult = PageResult<PdfAccessibility> & {
  counts: { checked: number; conform: number } & Record<A11yIssue, number>
}

export function pdfsAccessibility(analysisId: string, params: Record<string, string | number | undefined>): Promise<PdfsAccessibilityResult> {
  const search = new URLSearchParams()
  for (const [key, value] of Object.entries(params)) if (value !== undefined && value !== '') search.set(key, String(value))
  return fetch(`/api/analyses/${analysisId}/pdfs-accessibility?${search}`).then(async (response) => {
    signalAuth(response)
    if (!response.ok) throw new Error(`Erreur ${response.status}`)
    return response.json() as Promise<PdfsAccessibilityResult>
  })
}

export function pdfsAccessibilityCsvUrl(analysisId: string, issues: A11yIssue[]): string {
  return `/api/analyses/${analysisId}/pdfs-accessibility.csv?issue=${issues.join(',')}`
}

export type AuthState = { required: boolean; authenticated: boolean }

export const auth = {
  session: () => request<AuthState>('/api/auth/session'),
  login: (password: string) => request<{ authenticated: boolean }>('/api/auth/login', { method: 'POST', body: JSON.stringify({ password }) }),
  logout: () => request<{ authenticated: boolean }>('/api/auth/logout', { method: 'POST', body: '{}' }),
}
