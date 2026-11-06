import { describe, expect, it } from 'vitest'
import { extractLinks } from '../src/lib/links'

describe('extractLinks', () => {
  it('résout les liens HTML et ignore les schémas non navigables', () => {
    const html = `
      <a href="/docs">Docs</a>
      <a href="mailto:a@b.c">Mail</a>
      <area href="guide.pdf" />
      <a href="javascript:alert(1)">x</a>
      <a href="#haut">haut</a>
    `
    expect(extractLinks(html, 'https://example.com/base/page')).toEqual([
      'https://example.com/docs',
      'https://example.com/base/guide.pdf',
    ])
  })
})
