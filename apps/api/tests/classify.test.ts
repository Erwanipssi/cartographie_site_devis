import { describe, expect, it } from 'vitest'
import { classifyContentType } from '../src/lib/classify'

describe('classifyContentType', () => {
  it('se base sur le type MIME', () => {
    expect(classifyContentType('text/html; charset=utf-8', 'https://ex.test/page')).toBe('html')
    expect(classifyContentType('application/xhtml+xml', 'https://ex.test/page')).toBe('html')
    expect(classifyContentType('application/pdf', 'https://ex.test/file.bin')).toBe('pdf')
    expect(classifyContentType('application/x-pdf', 'https://ex.test/file')).toBe('pdf')
    expect(classifyContentType('text/plain', 'https://ex.test/readme')).toBe('other')
  })

  it('retombe sur l’extension seulement si le type est générique', () => {
    expect(classifyContentType('application/octet-stream', 'https://ex.test/guide.PDF')).toBe('pdf')
    expect(classifyContentType('application/octet-stream', 'https://ex.test/guide.html')).toBe('html')
    expect(classifyContentType(null, 'https://ex.test/guide.pdf')).toBe('pdf')
    expect(classifyContentType('application/octet-stream', 'https://ex.test/file.zip')).toBe('other')
  })
})
