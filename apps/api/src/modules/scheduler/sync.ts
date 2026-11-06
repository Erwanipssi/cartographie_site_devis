import type { Schedule } from '@prisma/client'
import { logger } from '../../lib/logger'
import { prisma } from '../../lib/prisma'
import { scheduleQueue } from '../../lib/queues'

export async function syncSchedule(schedule: Pick<Schedule, 'id' | 'cron' | 'timezone' | 'enabled'>): Promise<void> {
  const schedulerId = `schedule:${schedule.id}`
  if (!schedule.enabled) {
    await scheduleQueue.removeJobScheduler(schedulerId).catch((error: unknown) => {
      logger.warn({ err: error, schedulerId }, 'retrait du planificateur ignoré')
    })
    return
  }
  await scheduleQueue.upsertJobScheduler(
    schedulerId,
    { pattern: schedule.cron, tz: schedule.timezone },
    { name: 'run', data: { scheduleId: schedule.id, manual: false } },
  )
}

export async function syncAllSchedules(): Promise<void> {
  const schedules = await prisma.schedule.findMany()
  for (const schedule of schedules) await syncSchedule(schedule)
}

export async function removeScheduleJob(scheduleId: string): Promise<void> {
  await scheduleQueue.removeJobScheduler(`schedule:${scheduleId}`).catch(() => undefined)
}
