#!/usr/bin/env node
// Démarrage complet en une commande : `corepack pnpm start`.
// 1. Docker (lance Docker Desktop sous Windows si besoin)  2. PostgreSQL + Redis
// 3. apps/api/.env  4. migrations  5. API + worker + interface.
import { spawn, spawnSync } from 'node:child_process'
import { copyFileSync, existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const isWindows = process.platform === 'win32'
const step = (text) => console.log(`\n\x1b[1m▸ ${text}\x1b[0m`)
const fail = (text) => {
  console.error(`\n\x1b[31m✖ ${text}\x1b[0m`)
  process.exit(1)
}
// Sous Windows, corepack/pnpm sont des .cmd : il faut un shell, auquel on passe une ligne de commande
// complète (les arguments sont fixes et sans espace) plutôt qu'une liste, dépréciée avec shell: true.
const commandLine = (command, args) => [command, ...args].join(' ')
const run = (command, args, options = {}) =>
  isWindows
    ? spawnSync(commandLine(command, args), { cwd: root, encoding: 'utf8', shell: true, ...options })
    : spawnSync(command, args, { cwd: root, encoding: 'utf8', ...options })
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
const dockerReady = () => run('docker', ['info'], { stdio: 'ignore' }).status === 0

async function waitFor(check, seconds, label) {
  for (let elapsed = 0; elapsed < seconds; elapsed += 2) {
    if (check()) return
    if (elapsed > 0 && elapsed % 20 === 0) console.log(`  … ${label} (${elapsed} s)`)
    await sleep(2000)
  }
  fail(`${label} : délai dépassé (${seconds} s)`)
}

step('Docker')
if (!dockerReady()) {
  const desktop = 'C:\\Program Files\\Docker\\Docker\\Docker Desktop.exe'
  if (isWindows && existsSync(desktop)) {
    console.log('  Docker est arrêté : lancement de Docker Desktop…')
    spawn(desktop, [], { detached: true, stdio: 'ignore' }).unref()
    await waitFor(dockerReady, 180, 'Démarrage de Docker')
  } else {
    fail('Docker ne répond pas. Démarrez Docker puis relancez la commande.')
  }
}
console.log('  OK')

step('PostgreSQL et Redis')
const up = run('docker', ['compose', 'up', '-d', 'postgres', 'redis'], { stdio: 'inherit' })
if (up.status !== 0) fail('docker compose up a échoué')
const pgReady = () => run('docker', ['compose', 'exec', '-T', 'postgres', 'pg_isready', '-U', 'cartographie'], { stdio: 'ignore' }).status === 0
const redisReady = () => run('docker', ['compose', 'exec', '-T', 'redis', 'redis-cli', 'ping'], { stdio: 'pipe' }).stdout?.includes('PONG')
await waitFor(() => pgReady() && redisReady(), 60, 'Attente de PostgreSQL et Redis')
console.log('  OK')

step('Configuration')
const envFile = join(root, 'apps', 'api', '.env')
if (!existsSync(envFile)) {
  copyFileSync(join(root, '.env.example'), envFile)
  console.log('  apps/api/.env créé depuis .env.example')
} else {
  console.log('  apps/api/.env présent')
}

step('Migrations de la base')
const migrate = run('corepack', ['pnpm', '--filter', '@cartographie/api', 'db:deploy'], { stdio: 'pipe' })
const migrateOutput = `${migrate.stdout ?? ''}${migrate.stderr ?? ''}`
if (migrate.status === 0) {
  console.log(/No pending migrations/i.test(migrateOutput) ? '  Base à jour' : '  Migrations appliquées')
} else if (/EPERM/.test(migrateOutput)) {
  // Sur certains postes Windows, une stratégie de sécurité empêche Prisma de lancer son moteur de migration.
  console.warn('  ⚠ Prisma ne peut pas lancer son moteur de migration sur ce poste (EPERM).')
  console.warn('    Si une migration est en attente, appliquez son SQL à la main (voir README).')
} else {
  console.error(migrateOutput)
  fail('Échec des migrations')
}

step('API, worker et interface')
console.log('  Interface : http://localhost:5173   API : http://localhost:3001/api/health')
console.log('  Journaux du worker : apps/api/data/logs/worker.log   (Ctrl+C pour tout arrêter)\n')
const dev = isWindows
  ? spawn(commandLine('corepack', ['pnpm', 'dev']), { cwd: root, stdio: 'inherit', shell: true })
  : spawn('corepack', ['pnpm', 'dev'], { cwd: root, stdio: 'inherit' })
const stop = () => dev.kill('SIGINT')
process.on('SIGINT', stop)
process.on('SIGTERM', stop)
dev.on('exit', (code) => process.exit(code ?? 0))
