import { Queue } from 'bullmq'
import { env } from '../env'

const connection = { url: env.REDIS_URL, maxRetriesPerRequest: null as null }

export const bullConnection = connection
export const crawlQueue = new Queue('crawl', { connection })
export const pdfQueue = new Queue('pdf', { connection })
export const mailQueue = new Queue('mail', { connection })
export const scheduleQueue = new Queue('schedule', { connection })

export async function closeQueues(): Promise<void> {
  await Promise.all([crawlQueue.close(), pdfQueue.close(), mailQueue.close(), scheduleQueue.close()])
}
