import { join } from 'node:path'
import pino from 'pino'

// Le worker et l'API écrivent aussi dans apps/api/data/logs/<processus>.log : la cause d'un arrêt
// reste lisible même quand la console qui l'a lancé est fermée. Écriture synchrone : rien n'est perdu
// si le processus s'arrête brutalement.
const processName = process.argv.some((arg) => /worker\.(ts|js)$/.test(arg)) ? 'worker' : 'api'
const logFile = join(process.cwd(), 'data', 'logs', `${processName}.log`)

const streams: pino.StreamEntry[] = [{ stream: process.stdout }]
if (process.env.NODE_ENV !== 'test') {
  streams.push({ stream: pino.destination({ dest: logFile, mkdir: true, sync: true }) })
}

export const logger = pino(
  {
    level: process.env.LOG_LEVEL ?? 'info',
    base: { service: 'cartographie', process: processName },
    timestamp: pino.stdTimeFunctions.isoTime,
  },
  pino.multistream(streams),
)
