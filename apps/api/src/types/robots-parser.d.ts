declare module 'robots-parser' {
  interface Robot {
    isAllowed(url: string, userAgent?: string): boolean | undefined
    getSitemaps(): string[]
  }
  export default function robotsParser(url: string, contents: string): Robot
}
