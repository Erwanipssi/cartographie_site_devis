import { describe, expect, it } from 'vitest'
import { assertPublicHttpUrl, isBlockedHostname, isPrivateAddress, UrlRejectedError } from '../src/lib/ssrf'

describe('isPrivateAddress', () => {
  it('bloque les plages privées, loopback et le lien local', () => {
    expect(isPrivateAddress('127.0.0.1')).toBe(true)
    expect(isPrivateAddress('10.1.2.3')).toBe(true)
    expect(isPrivateAddress('172.16.0.1')).toBe(true)
    expect(isPrivateAddress('172.31.255.255')).toBe(true)
    expect(isPrivateAddress('192.168.1.20')).toBe(true)
    expect(isPrivateAddress('169.254.169.254')).toBe(true)
    expect(isPrivateAddress('0.0.0.0')).toBe(true)
    expect(isPrivateAddress('::1')).toBe(true)
    expect(isPrivateAddress('::ffff:127.0.0.1')).toBe(true)
  })

  it('laisse passer une adresse publique', () => {
    expect(isPrivateAddress('1.1.1.1')).toBe(false)
    expect(isPrivateAddress('172.15.1.1')).toBe(false)
    expect(isPrivateAddress('172.32.0.1')).toBe(false)
    expect(isPrivateAddress('8.8.8.8')).toBe(false)
  })
})

describe('assertPublicHttpUrl', () => {
  it('refuse localhost, les IP privées et les identifiants', async () => {
    await expect(assertPublicHttpUrl('http://127.0.0.1/admin')).rejects.toBeInstanceOf(UrlRejectedError)
    await expect(assertPublicHttpUrl('http://localhost/')).rejects.toBeInstanceOf(UrlRejectedError)
    await expect(assertPublicHttpUrl('http://10.0.0.5/')).rejects.toBeInstanceOf(UrlRejectedError)
    await expect(assertPublicHttpUrl('http://user:pass@example.com/')).rejects.toBeInstanceOf(UrlRejectedError)
    await expect(assertPublicHttpUrl('file:///etc/passwd')).rejects.toBeInstanceOf(UrlRejectedError)
  })

  it('reconnaît les hôtes interdits', () => {
    expect(isBlockedHostname('localhost')).toBe(true)
    expect(isBlockedHostname('metadata.google.internal')).toBe(true)
    expect(isBlockedHostname('app.local')).toBe(true)
    expect(isBlockedHostname('example.com')).toBe(false)
  })
})
