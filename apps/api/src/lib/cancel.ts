import { redis } from './redis'

export function analysisChannel(analysisId: string): string {
  return `analysis:${analysisId}`
}

export async function isCancelled(analysisId: string): Promise<boolean> {
  return (await redis.get(cancelKey(analysisId))) === '1'
}

export async function flagCancelled(analysisId: string): Promise<void> {
  await redis.set(cancelKey(analysisId), '1', 'EX', 60 * 60 * 24)
}

function cancelKey(analysisId: string): string {
  return `analysis:${analysisId}:cancel`
}
