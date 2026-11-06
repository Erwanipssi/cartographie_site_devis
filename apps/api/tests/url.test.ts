import { describe, expect, it } from 'vitest'
import { comparableHost, ensureHttpUrl, isInScope, normalizeUrl } from '../src/lib/url'

describe('normalizeUrl', () => {
  it('met le hôte en minuscules et retire le fragment', () => {
    expect(normalizeUrl('https://Example.COM/A/#section')).toBe('https://example.com/A')
  })

  it('retire les paramètres de tracking et trie la query', () => {
    expect(normalizeUrl('https://example.com/a/?utm_source=x&b=2&a=1&fbclid=abc')).toBe('https://example.com/a?a=1&b=2')
  })

  it('retire le port par défaut et le slash final', () => {
    expect(normalizeUrl('https://example.com:443/a/')).toBe('https://example.com/a')
    expect(normalizeUrl('http://example.com:80/a/')).toBe('http://example.com/a')
  })

  it('conserve la racine', () => {
    expect(normalizeUrl('https://example.com')).toBe('https://example.com/')
  })

  it('refuse les schémas non http', () => {
    expect(normalizeUrl('javascript:alert(1)')).toBeNull()
    expect(normalizeUrl('ftp://example.com/a')).toBeNull()
  })
})

describe('ensureHttpUrl', () => {
  it('ajoute https si le schéma est absent', () => {
    expect(ensureHttpUrl('example.com/docs')).toBe('https://example.com/docs')
  })
})

describe('périmètre', () => {
  it('traite www et l’apex comme le même hôte', () => {
    expect(comparableHost('www.Example.com.')).toBe('example.com')
    expect(isInScope('www.example.com', 'example.com', false)).toBe(true)
  })

  it('n’inclut les sous-domaines que si l’option est active', () => {
    expect(isInScope('blog.example.com', 'example.com', false)).toBe(false)
    expect(isInScope('blog.example.com', 'www.example.com', true)).toBe(true)
    expect(isInScope('blog.example.org', 'example.com', true)).toBe(false)
  })

  it('respecte les domaines à plusieurs niveaux', () => {
    expect(isInScope('www.example.co.uk', 'example.co.uk', false)).toBe(true)
    expect(isInScope('blog.example.co.uk', 'example.co.uk', true)).toBe(true)
  })
})
