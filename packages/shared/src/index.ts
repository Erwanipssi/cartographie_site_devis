import { z } from 'zod'

export const crawlModeSchema = z.enum(['sitemap', 'crawl'])
export type CrawlMode = z.infer<typeof crawlModeSchema>

export const crawlConfigSchema = z.object({
  // sitemap : pages du sitemap + PDF liés depuis ces pages ; crawl : suit tous les liens.
  mode: crawlModeSchema.default('crawl'),
  maxDepth: z.number().int().min(0).max(8).default(3),
  maxPages: z.number().int().min(1).max(5000).default(200),
  maxPdfs: z.number().int().min(1).max(2000).default(100),
  concurrency: z.number().int().min(1).max(10).default(4),
  delayMs: z.number().int().min(0).max(5000).default(200),
  timeoutMs: z.number().int().min(3000).max(60_000).default(15_000),
  respectRobots: z.boolean().default(true),
  pdfMaxBytes: z.number().int().positive().max(104_857_600).default(52_428_800),
  ocrMinChars: z.number().int().min(1).max(1000).default(20),
  textRatio: z.number().min(0.05).max(1).default(0.8),
  imageRatio: z.number().min(0).max(0.95).default(0.1),
})

export type CrawlConfig = z.infer<typeof crawlConfigSchema>

export const createSitesSchema = z.object({
  urls: z.array(z.string().min(1).max(2000)).min(1).max(100),
})

export const updateSiteSchema = z.object({
  includeSubdomains: z.boolean(),
})

export const createAnalysisSchema = z.object({
  siteIds: z.array(z.string().min(1)).min(1).max(50),
  config: crawlConfigSchema.optional(),
  emailOnComplete: z.boolean().optional(),
  recipientIds: z.array(z.string()).optional(),
})

export const createRecipientSchema = z.object({
  email: z.string().email('Adresse e-mail invalide'),
  label: z.string().max(80).optional(),
})

export const sendMailSchema = z.object({
  recipientIds: z.array(z.string().min(1)).min(1).max(30),
})

export const cronSchema = z
  .string()
  .trim()
  .regex(/^(\S+\s+){4}\S+$/, 'Expression cron en 5 champs, par exemple « 0 7 * * 1 »')

export const createScheduleSchema = z.object({
  name: z.string().trim().min(1).max(120),
  cron: cronSchema,
  timezone: z.string().min(1).max(64).default('Europe/Paris'),
  enabled: z.boolean().default(true),
  siteIds: z.array(z.string().min(1)).min(1).max(50),
  config: crawlConfigSchema.optional(),
  emailOnComplete: z.boolean().default(true),
  recipientIds: z.array(z.string()).default([]),
})

export const updateScheduleSchema = z.object({
  name: z.string().trim().min(1).max(120).optional(),
  cron: cronSchema.optional(),
  timezone: z.string().min(1).max(64).optional(),
  enabled: z.boolean().optional(),
  siteIds: z.array(z.string().min(1)).min(1).max(50).optional(),
  config: crawlConfigSchema.optional(),
  emailOnComplete: z.boolean().optional(),
  recipientIds: z.array(z.string()).optional(),
})

export const ocrStatusSchema = z.enum(['pending', 'text', 'image', 'partial', 'error'])
export type OcrStatus = z.infer<typeof ocrStatusSchema>

export const OCR_LABELS: Record<OcrStatus, string> = {
  pending: 'En attente',
  text: 'OCRisé / texte',
  image: 'Non OCRisé',
  partial: 'Partiel',
  error: 'Erreur',
}

export function splitUrlInput(text: string): string[] {
  return [...new Set(text.split(/[\s,;]+/).map((part) => part.trim()).filter(Boolean))]
}
