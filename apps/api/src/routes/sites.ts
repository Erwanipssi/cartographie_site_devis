import { createSitesSchema, updateSiteSchema } from '@cartographie/shared'
import type { FastifyInstance } from 'fastify'
import type { ZodTypeProvider } from 'fastify-type-provider-zod'
import { z } from 'zod'
import { ApiError } from '../lib/http'
import { prisma } from '../lib/prisma'
import { assertPublicHttpUrl, UrlRejectedError } from '../lib/ssrf'

export async function registerSites(app: FastifyInstance): Promise<void> {
  const route = app.withTypeProvider<ZodTypeProvider>()

  route.get('/api/sites', async () => {
    const sites = await prisma.site.findMany({ where: { archivedAt: null }, orderBy: { createdAt: 'desc' } })
    return { sites }
  })

  route.post('/api/sites', { schema: { body: createSitesSchema } }, async (request) => {
    const created = []
    const restored = []
    const existing = []
    const rejected: Array<{ url: string; reason: string }> = []
    const seen = new Set<string>()
    for (const raw of request.body.urls) {
      try {
        const safe = await assertPublicHttpUrl(raw)
        if (seen.has(safe.normalizedUrl)) continue
        seen.add(safe.normalizedUrl)
        const found = await prisma.site.findUnique({ where: { normalizedUrl: safe.normalizedUrl } })
        if (found && !found.archivedAt) {
          existing.push(found)
          continue
        }
        if (found) {
          restored.push(
            await prisma.site.update({
              where: { id: found.id },
              data: { archivedAt: null, inputUrl: raw.trim(), origin: safe.origin, hostname: safe.hostname },
            }),
          )
          continue
        }
        created.push(
          await prisma.site.create({
            data: {
              inputUrl: raw.trim(),
              normalizedUrl: safe.normalizedUrl,
              origin: safe.origin,
              hostname: safe.hostname,
            },
          }),
        )
      } catch (error) {
        rejected.push({ url: raw, reason: error instanceof UrlRejectedError ? error.message : 'URL refusée' })
      }
    }
    return { created, restored, existing, rejected }
  })

  route.patch('/api/sites/:id', { schema: { params: z.object({ id: z.string().min(1) }), body: updateSiteSchema } }, async (request) => {
    const site = await prisma.site.findFirst({ where: { id: request.params.id, archivedAt: null } })
    if (!site) throw new ApiError(404, 'Site introuvable', 'NOT_FOUND')
    const updated = await prisma.site.update({
      where: { id: site.id },
      data: { includeSubdomains: request.body.includeSubdomains },
    })
    return { site: updated }
  })

  route.delete('/api/sites/:id', { schema: { params: z.object({ id: z.string().min(1) }) } }, async (request) => {
    const site = await prisma.site.findFirst({ where: { id: request.params.id, archivedAt: null } })
    if (!site) throw new ApiError(404, 'Site introuvable', 'NOT_FOUND')
    await prisma.scheduleSite.deleteMany({ where: { siteId: site.id } })
    await prisma.site.update({ where: { id: site.id }, data: { archivedAt: new Date() } })
    return { ok: true }
  })
}
