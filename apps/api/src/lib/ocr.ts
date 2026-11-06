import type { OcrStatus } from '@cartographie/shared'

export function usefulCharCount(text: string): number {
  return text.match(/[^\s]/g)?.length ?? 0
}

export function classifyOcr(
  charCounts: number[],
  options: { minChars: number; textRatio: number; imageRatio: number },
): Exclude<OcrStatus, 'pending'> {
  if (charCounts.length === 0) return 'error'
  const withText = charCounts.filter((count) => count >= options.minChars).length
  const ratio = withText / charCounts.length
  if (ratio >= options.textRatio) return 'text'
  if (ratio < options.imageRatio) return 'image'
  return 'partial'
}
