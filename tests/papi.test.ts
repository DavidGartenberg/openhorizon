/**
 * PAPI logic (Phase 13d) — pure, exact transitions. Standard 4-box PAPI
 * on a 3° path: unit setting angles 2.5/2.83/3.17/3.5°; a unit shows
 * WHITE when the observer is above its setting angle. On slope = 2W2R,
 * high = 4W, low = 4R (FAA AIM 2-1-2 geometry).
 */
import { describe, expect, it } from 'vitest'
import { PAPI_ANGLES_DEG, papiAngleDeg, papiWhiteCount } from '../src/world/papi'

describe('papiWhiteCount transitions', () => {
  it('on a 3.0° path shows 2 white 2 red', () => {
    expect(papiWhiteCount(3.0)).toBe(2)
  })
  it('well high (3.6°) shows 4 white, well low (2.4°) shows 4 red', () => {
    expect(papiWhiteCount(3.6)).toBe(4)
    expect(papiWhiteCount(2.4)).toBe(0)
  })
  it('each unit flips exactly at its setting angle', () => {
    for (let i = 0; i < 4; i++) {
      const a = PAPI_ANGLES_DEG[i]!
      expect(papiWhiteCount(a + 0.01)).toBe(i + 1)
      expect(papiWhiteCount(a - 0.01)).toBe(i)
    }
  })
  it('2.9° is still inside the on-slope band (2W); 2.7° low = 1W, 3.2° high = 3W', () => {
    expect(papiWhiteCount(2.9)).toBe(2)
    expect(papiWhiteCount(2.7)).toBe(1)
    expect(papiWhiteCount(3.2)).toBe(3)
  })
})

describe('papiAngleDeg geometry', () => {
  it('recovers 3.0° from tan geometry at 1,000 m', () => {
    const h = Math.tan((3.0 * Math.PI) / 180) * 1000
    expect(papiAngleDeg(1000, h)).toBeCloseTo(3.0, 6)
  })
  it('is 0° level with the array and 90° directly overhead', () => {
    expect(papiAngleDeg(500, 0)).toBeCloseTo(0, 9)
    expect(papiAngleDeg(0, 300)).toBeCloseTo(90, 9)
  })
})
