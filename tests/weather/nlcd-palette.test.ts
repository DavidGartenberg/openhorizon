import { describe, expect, it } from 'vitest'
import { classifyNlcdPixel } from '../../src/world/nlcd-palette'

describe('classifyNlcdPixel', () => {
  it('maps exact legend colors to biomes', () => {
    expect(classifyNlcdPixel(28, 95, 44, 255)?.key).toBe('evergreen')
    expect(classifyNlcdPixel(171, 108, 40, 255)?.key).toBe('crops')
    expect(classifyNlcdPixel(235, 0, 0, 255)?.key).toBe('dev-med')
    expect(classifyNlcdPixel(179, 172, 159, 255)?.key).toBe('barren')
  })
  it('water defers (null color) so the ocean/elevation fallback rules', () => {
    const w = classifyNlcdPixel(70, 107, 159, 255)
    expect(w?.key).toBe('water')
    expect(w?.color).toBeNull()
  })
  it('transparent and off-legend pixels return null', () => {
    expect(classifyNlcdPixel(0, 0, 0, 0)).toBeNull()
    expect(classifyNlcdPixel(255, 255, 255, 255)).toBeNull()
  })
})
