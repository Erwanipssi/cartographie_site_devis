import { lookup } from 'node:dns/promises'
import { BlockList, isIP } from 'node:net'
import { ensureHttpUrl } from './url'

const blockedHosts = new Set(['localhost', 'localhost.localdomain', 'metadata.google.internal'])

let blocks: BlockList | null = null

function privateBlocks(): BlockList {
  if (blocks) return blocks
  const list = new BlockList()
  const ipv4: Array<[string, number]> = [
    ['0.0.0.0', 8],
    ['10.0.0.0', 8],
    ['100.64.0.0', 10],
    ['127.0.0.0', 8],
    ['169.254.0.0', 16],
    ['172.16.0.0', 12],
    ['192.0.0.0', 24],
    ['192.168.0.0', 16],
    ['198.18.0.0', 15],
    ['224.0.0.0', 4],
  ]
  for (const [net, prefix] of ipv4) list.addSubnet(net, prefix, 'ipv4')
  list.addAddress('::', 'ipv6')
  list.addAddress('::1', 'ipv6')
  list.addSubnet('fc00::', 7, 'ipv6')
  list.addSubnet('fe80::', 10, 'ipv6')
  list.addSubnet('ff00::', 8, 'ipv6')
  blocks = list
  return list
}

export function isPrivateAddress(ip: string): boolean {
  const mapped = ip.toLowerCase().startsWith('::ffff:') ? ip.slice(7) : ip
  const candidate = isIP(mapped) ? mapped : ip
  const family = isIP(candidate)
  if (family === 0) return true
  const type = family === 4 ? 'ipv4' : 'ipv6'
  return privateBlocks().check(candidate, type)
}

export function isBlockedHostname(hostname: string): boolean {
  const host = hostname.toLowerCase().replace(/\.$/, '')
  if (blockedHosts.has(host)) return true
  if (host.endsWith('.localhost') || host.endsWith('.local')) return true
  return false
}

export class UrlRejectedError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'UrlRejectedError'
  }
}

export type SafeUrl = {
  normalizedUrl: string
  origin: string
  hostname: string
}

export async function assertPublicHttpUrl(input: string): Promise<SafeUrl> {
  const normalizedUrl = ensureHttpUrl(input)
  if (!normalizedUrl) throw new UrlRejectedError('URL invalide')
  const url = new URL(normalizedUrl)
  if (url.username || url.password) throw new UrlRejectedError('Les URL avec identifiants sont refusées')
  if (isBlockedHostname(url.hostname)) throw new UrlRejectedError('Hôte interdit')
  if (isIP(url.hostname)) {
    if (isPrivateAddress(url.hostname)) throw new UrlRejectedError('Adresse IP privée refusée')
    return { normalizedUrl, origin: url.origin, hostname: url.hostname }
  }
  let addresses: Array<{ address: string }>
  try {
    addresses = await lookup(url.hostname, { all: true, verbatim: true })
  } catch {
    throw new UrlRejectedError('Nom d’hôte introuvable')
  }
  if (addresses.length === 0) throw new UrlRejectedError('Nom d’hôte introuvable')
  if (addresses.some((entry) => isPrivateAddress(entry.address))) {
    throw new UrlRejectedError('L’hôte résout vers une adresse privée')
  }
  return { normalizedUrl, origin: url.origin, hostname: url.hostname }
}

type LookupCallback = (
  err: NodeJS.ErrnoException | null,
  address?: string | Array<{ address: string; family: number }>,
  family?: number,
) => void

export function safeLookup(hostname: string, options: { all?: boolean }, callback: LookupCallback): void {
  if (isBlockedHostname(hostname) || (isIP(hostname) !== 0 && isPrivateAddress(hostname))) {
    callback(Object.assign(new Error('Adresse non autorisée'), { code: 'ESSRF' }))
    return
  }
  if (isIP(hostname) !== 0) {
    const family = isIP(hostname) === 6 ? 6 : 4
    if (options.all) callback(null, [{ address: hostname, family }])
    else callback(null, hostname, family)
    return
  }
  lookup(hostname, { all: true, verbatim: true })
    .then((addresses) => {
      const safe = addresses.filter((entry) => !isPrivateAddress(entry.address))
      if (safe.length === 0) {
        callback(Object.assign(new Error('Adresse non autorisée'), { code: 'ESSRF' }))
        return
      }
      if (options.all) callback(null, safe.map((entry) => ({ address: entry.address, family: entry.family })))
      else callback(null, safe[0]?.address ?? '', safe[0]?.family ?? 4)
    })
    .catch((error: NodeJS.ErrnoException) => callback(error))
}
