import { createScheduleSchema, updateScheduleSchema } from '@cartographie/shared'
import type { Schedule, ScheduleRecipient, ScheduleSite } from '@prisma/client'
import type { FastifyInstance } from 'fastify'
import type { ZodTypeProvider } from 'fastify-type-provider-zod'
import { z } from 'zod'
import { ApiError, assertTimezone } from '../lib/http'
import { prisma } from '../lib/prisma'
import { readConfig } from '../modules/analyses/service'
import { executeSchedule } from '../modules/scheduler/run'
import { removeScheduleJob, syncSchedule } from '../modules/scheduler/sync'

const include = { sites: true, recipients: true } as const

type ScheduleWithLinks = Schedule & { sites: ScheduleSite[]; recipients: ScheduleRecipient[] }

function present(schedule: ScheduleWithLinks) {
  return {
    id: schedule.id,
    name: schedule.name,
    cron: schedule.cron,
    timezone: schedule.timezone,
    enabled: schedule.enabled,
    emailOnComplete: schedule.emailOnComplete,
    config: schedule.config,
    lastRunAt: schedule.lastRunAt,
    createdAt: schedule.createdAt,
    siteIds: schedule.sites.map((item) => item.siteId),
    recipientIds: schedule.recipients.map((item) => item.recipientId),
  }
}

async function assertSites(siteIds: string[]): Promise<void> {
  const count = await prisma.site.count({ where: { id: { in: siteIds }, archivedAt: null } })
  if (count !== new Set(siteIds).size) throw new ApiError(400, 'Un ou plusieurs sites sont inconnus', 'UNKNOWN_SITE')
}

export async function registerSchedules(app: FastifyInstance): Promise<void> {
  const route = app.withTypeProvider<ZodTypeProvider>()

  route.get('/api/schedules', async () => {
    const schedules = await prisma.schedule.findMany({ include, orderBy: { createdAt: 'desc' } })
    return { schedules: schedules.map(present) }
  })

  route.post('/api/schedules', { schema: { body: createScheduleSchema } }, async (request, reply) => {
    assertTimezone(request.body.timezone)
    await assertSites(request.body.siteIds)
    const config = readConfig(request.body.config ?? {})
    const schedule = await prisma.schedule.create({
      data: {
        name: request.body.name,
        cron: request.body.cron,
        timezone: request.body.timezone,
        enabled: request.body.enabled,
        emailOnComplete: request.body.emailOnComplete,
        config,
        sites: { create: [...new Set(request.body.siteIds)].map((siteId) => ({ siteId })) },
        recipients: { create: [...new Set(request.body.recipientIds)].map((recipientId) => ({ recipientId })) },
      },
      include,
    })
    try {
      await syncSchedule(schedule)
    } catch (error) {
      await prisma.schedule.delete({ where: { id: schedule.id } })
      throw new ApiError(400, error instanceof Error ? error.message : 'Expression cron refusée', 'INVALID_CRON')
    }
    return reply.code(201).send({ schedule: present(schedule) })
  })

  route.patch('/api/schedules/:id', { schema: { params: z.object({ id: z.string().min(1) }), body: updateScheduleSchema } }, async (request) => {
    const current = await prisma.schedule.findUnique({ where: { id: request.params.id }, include })
    if (!current) throw new ApiError(404, 'Planification introuvable', 'NOT_FOUND')
    if (request.body.timezone) assertTimezone(request.body.timezone)
    if (request.body.siteIds) await assertSites(request.body.siteIds)
    const config = request.body.config ? readConfig(request.body.config) : undefined
    const schedule = await prisma.$transaction(async (tx) => {
      if (request.body.siteIds) {
        await tx.scheduleSite.deleteMany({ where: { scheduleId: current.id } })
        await tx.scheduleSite.createMany({
          data: [...new Set(request.body.siteIds)].map((siteId) => ({ scheduleId: current.id, siteId })),
        })
      }
      if (request.body.recipientIds) {
        await tx.scheduleRecipient.deleteMany({ where: { scheduleId: current.id } })
        await tx.scheduleRecipient.createMany({
          data: [...new Set(request.body.recipientIds)].map((recipientId) => ({ scheduleId: current.id, recipientId })),
        })
      }
      return tx.schedule.update({
        where: { id: current.id },
        data: {
          name: request.body.name,
          cron: request.body.cron,
          timezone: request.body.timezone,
          enabled: request.body.enabled,
          emailOnComplete: request.body.emailOnComplete,
          config,
        },
        include,
      })
    })
    await syncSchedule(schedule)
    return { schedule: present(schedule) }
  })

  route.delete('/api/schedules/:id', { schema: { params: z.object({ id: z.string().min(1) }) } }, async (request) => {
    const schedule = await prisma.schedule.findUnique({ where: { id: request.params.id } })
    if (!schedule) throw new ApiError(404, 'Planification introuvable', 'NOT_FOUND')
    await removeScheduleJob(schedule.id)
    await prisma.schedule.delete({ where: { id: schedule.id } })
    return { ok: true }
  })

  route.post('/api/schedules/:id/run', { schema: { params: z.object({ id: z.string().min(1) }) } }, async (request) => {
    const schedule = await prisma.schedule.findUnique({ where: { id: request.params.id } })
    if (!schedule) throw new ApiError(404, 'Planification introuvable', 'NOT_FOUND')
    await executeSchedule(schedule.id, true)
    return { started: true }
  })
}
