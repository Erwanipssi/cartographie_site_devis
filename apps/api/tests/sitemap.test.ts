import { describe, expect, it } from 'vitest'
import { buildSitemapXml, parseSitemapLocs } from '../src/lib/sitemap'

describe('parseSitemapLocs', () => {
  it('lit un index avec espace de noms', () => {
    const xml = `<?xml version="1.0"?>
      <sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
        <sitemap><loc>https://example.com/a.xml</loc></sitemap>
      </sitemapindex>`
    expect(parseSitemapLocs(xml)).toEqual({ index: true, locs: ['https://example.com/a.xml'] })
  })

  it('décode les entités des URL', () => {
    const xml = `<urlset><url><loc>https://example.com/a?x=1&amp;y=2</loc></url></urlset>`
    expect(parseSitemapLocs(xml)).toEqual({ index: false, locs: ['https://example.com/a?x=1&y=2'] })
  })
})

describe('buildSitemapXml', () => {
  it('produit un urlset trié, dédoublonné et échappé', () => {
    const xml = buildSitemapXml([{ url: 'https://ex.fr/b?x=1&y=2' }, { url: 'https://ex.fr/a' }, { url: 'https://ex.fr/a' }])
    expect(xml).toContain('<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">')
    expect(xml.match(/<loc>/g)).toHaveLength(2)
    expect(xml.indexOf('https://ex.fr/a')).toBeLessThan(xml.indexOf('https://ex.fr/b'))
    expect(xml).toContain('<loc>https://ex.fr/b?x=1&amp;y=2</loc>')
    expect(parseSitemapLocs(xml).locs).toEqual(['https://ex.fr/a', 'https://ex.fr/b?x=1&y=2'])
  })
})
