declare module 'robots-parser' {
  interface Robot {
    isAllowed(url: string, userAgent?: string): boolean | undefined
    getSitemaps(): string[]
    /** Crawl-delay en secondes pour cet agent, s’il est déclaré. */
    getCrawlDelay(userAgent?: string): number | undefined
  }
  export default function robotsParser(url: string, contents: string): Robot
}
