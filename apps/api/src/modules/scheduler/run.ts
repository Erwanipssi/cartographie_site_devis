import { prisma } from '../../lib/prisma'
import { readConfig, startAnalysis } from '../analyses/service'

export async function executeSchedule(scheduleId: string, manual: boolean): Promise<void> {
  const schedule = await prisma.schedule.findUnique({
    where: { id: scheduleId },
    include: { sites: { include: { site: true } }, recipients: { include: { recipient: true } } },
  })
  if (!schedule) return
  if (!manual && !schedule.enabled) return
  const siteIds = schedule.sites.filter((link) => !link.site.archivedAt).map((link) => link.siteId)
  const emails = schedule.recipients.map((link) => link.recipient.email)
  await startAnalysis({
    siteIds,
    config: readConfig(schedule.config),
    emailOnComplete: schedule.emailOnComplete,
    emails,
    trigger: manual ? 'manual' : 'scheduled',
    scheduleId: schedule.id,
    strict: false,
  })
  await prisma.schedule.update({ where: { id: schedule.id }, data: { lastRunAt: new Date() } })
}
