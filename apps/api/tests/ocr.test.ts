import { describe, expect, it } from 'vitest'
import { classifyOcr, usefulCharCount } from '../src/lib/ocr'

const options = { minChars: 20, textRatio: 0.8, imageRatio: 0.1 }

describe('détection de couche texte', () => {
  it('compte les caractères hors espaces', () => {
    expect(usefulCharCount('  \n\t ')).toBe(0)
    expect(usefulCharCount('a b')).toBe(2)
  })

  it('classe un PDF sans page en erreur', () => {
    expect(classifyOcr([], options)).toBe('error')
  })

  it('classe texte, image et partiel selon les seuils', () => {
    const text = Array.from({ length: 10 }, () => 40)
    const image = Array.from({ length: 10 }, () => 0)
    const partial = Array.from({ length: 10 }, (_, index) => (index < 4 ? 40 : 0))
    expect(classifyOcr(text, options)).toBe('text')
    expect(classifyOcr(image, options)).toBe('image')
    expect(classifyOcr(partial, options)).toBe('partial')
  })

  it('ignore une page sous le minimum de caractères', () => {
    expect(classifyOcr([19, 19, 19], options)).toBe('image')
    expect(classifyOcr([20, 20, 0, 0, 0, 0, 0, 0, 0, 0], options)).toBe('partial')
  })
})
