/** Halos and sun dogs in thin high ice cloud; aurora at high latitude. */
import { describe, expect, it } from 'vitest'
import { auroraStrength, haloStrength } from '../src/render/sky-optics'

describe('sky optics', () => {
  it('halos need thin high cirrus with the sun out, and no low deck', () => {
    expect(haloStrength([{ cover: 'SCT', baseMslFt: 25_000 }], 30, 0.7)).toBeGreaterThan(0.9)
    expect(haloStrength([], 30, 0.9)).toBe(0) // clear sky: no crystals
    expect(haloStrength([{ cover: 'SCT', baseMslFt: 4_000 }], 30, 0.7)).toBe(0) // cumulus, not cirrus
    expect(haloStrength([{ cover: 'SCT', baseMslFt: 25_000 }, { cover: 'OVC', baseMslFt: 2_000 }], 30, 0.07)).toBe(0) // under an overcast
    expect(haloStrength([{ cover: 'SCT', baseMslFt: 25_000 }], -3, 0.7)).toBe(0) // night
  })
  it('aurora: never at mid-latitudes, strongest toward the auroral zone, varies night to night', () => {
    expect(auroraStrength(37.5, new Date('2026-11-03T08:00:00Z'))).toBe(0)
    const nights = Array.from({ length: 60 }, (_, i) => auroraStrength(64, new Date(Date.UTC(2026, 0, 1 + i, 23))))
    expect(Math.max(...nights)).toBeGreaterThan(0.8)
    expect(Math.min(...nights)).toBeLessThan(0.15)
    const d = new Date('2026-01-15T23:00:00Z')
    expect(auroraStrength(58, d)).toBeLessThanOrEqual(auroraStrength(66, d))
  })
})
