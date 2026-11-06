export function parseSitemapLocs(xml: string): { index: boolean; locs: string[] } {
  const index = /<sitemapindex[\s>]/i.test(xml)
  const locs = [...xml.matchAll(/<loc>\s*([^<]+?)\s*<\/loc>/gi)]
    .map((match) => decodeXml(match[1]?.trim() ?? ''))
    .filter(Boolean)
  return { index, locs }
}

function decodeXml(value: string): string {
  return value
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
}

function escapeXml(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&apos;')
}

/** Sitemap reconstitué à partir des URL découvertes par le crawl (dédoublonnées, triées). */
export function buildSitemapXml(entries: Array<{ url: string; lastmod?: Date | null }>): string {
  const byUrl = new Map<string, Date | null>()
  for (const entry of entries) if (!byUrl.has(entry.url)) byUrl.set(entry.url, entry.lastmod ?? null)
  const body = [...byUrl.keys()]
    .sort()
    .map((url) => {
      const lastmod = byUrl.get(url)
      return `  <url>\n    <loc>${escapeXml(url)}</loc>${lastmod ? `\n    <lastmod>${lastmod.toISOString().slice(0, 10)}</lastmod>` : ''}\n  </url>`
    })
    .join('\n')
  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${body}${body ? '\n' : ''}</urlset>\n`
}
