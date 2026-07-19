import { describe, expect, it } from 'vitest'
import { classifyNexradPixel } from '../../src/sim/weather/nexrad-palette'

describe('classifyNexradPixel', () => {
  it('transparent = no precip', () => {
    expect(classifyNexradPixel(0, 0, 0, 0)).toBe(0)
    expect(classifyNexradPixel(255, 0, 0, 20)).toBe(0)
  })
  it('greens are light', () => {
    expect(classifyNexradPixel(1, 159, 244, 255)).toBe(1) // n0q light blue-green
    expect(classifyNexradPixel(4, 233, 231, 255)).toBe(1)
    expect(classifyNexradPixel(0, 144, 0, 255)).toBe(1)
  })
  it('yellows/oranges are moderate', () => {
    expect(classifyNexradPixel(255, 255, 0, 255)).toBe(2)
    expect(classifyNexradPixel(231, 192, 0, 255)).toBe(2)
    expect(classifyNexradPixel(255, 144, 0, 255)).toBe(2)
  })
  it('reds/magentas are heavy', () => {
    expect(classifyNexradPixel(214, 0, 0, 255)).toBe(3)
    expect(classifyNexradPixel(192, 0, 192, 255)).toBe(3)
    expect(classifyNexradPixel(255, 0, 255, 255)).toBe(3)
  })
})
