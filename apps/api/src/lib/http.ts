export class ApiError extends Error {
  constructor(
    public statusCode: number,
    message: string,
    public code = 'BAD_REQUEST',
    public details: unknown = null,
  ) {
    super(message)
    this.name = 'ApiError'
  }
}

export function pageWindow(query: { page?: string; pageSize?: string }): { page: number; pageSize: number; skip: number; take: number } {
  const page = Math.max(1, Number(query.page ?? 1) || 1)
  const pageSize = Math.min(100, Math.max(1, Number(query.pageSize ?? 25) || 25))
  return { page, pageSize, skip: (page - 1) * pageSize, take: pageSize }
}

export function assertTimezone(timezone: string): void {
  try {
    Intl.DateTimeFormat('fr-FR', { timeZone: timezone })
  } catch {
    throw new ApiError(400, 'Fuseau horaire invalide', 'INVALID_TIMEZONE')
  }
}
