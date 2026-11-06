import * as cheerio from 'cheerio'

const SKIP = /^(mailto:|tel:|javascript:|data:|blob:)/i

export function extractLinks(html: string, baseUrl: string): string[] {
  const $ = cheerio.load(html)
  const links: string[] = []
  $('a[href], area[href]').each((_, element) => {
    const href = $(element).attr('href')?.trim()
    if (!href || href.startsWith('#') || SKIP.test(href)) return
    try {
      const url = new URL(href, baseUrl)
      if (url.protocol !== 'http:' && url.protocol !== 'https:') return
      links.push(url.toString())
    } catch {
      /* lien illisible */
    }
  })
  return links
}
