/**
 * METAR wind → sea state (13e): glassy under light air, slope growing
 * with wind, whitecaps appearing ~15 kt and fully developed ~25 kt
 * (Beaufort 4-6 behavior at spec coarseness).
 */
import { describe, expect, it } from 'vitest'
import { seaState } from '../../src/sim/weather/sea-state'

const KT = 0.514444

describe('seaState', () => {
  it('2 kt is glassy with zero whitecaps', () => {
    const s = seaState(2 * KT)
    expect(s.slopeScale).toBeLessThanOrEqual(0.15)
    expect(s.whitecap).toBe(0)
  })
  it('whitecaps are absent below 15 kt', () => {
    expect(seaState(14 * KT).whitecap).toBe(0)
    expect(seaState(10 * KT).whitecap).toBe(0)
  })
  it('20 kt shows partial whitecaps; 25+ kt fully developed', () => {
    const w20 = seaState(20 * KT).whitecap
    expect(w20).toBeGreaterThan(0.2)
    expect(w20).toBeLessThan(0.8)
    expect(seaState(26 * KT).whitecap).toBe(1)
  })
  it('slope scale grows monotonically with wind and saturates', () => {
    let prev = -1
    for (const kt of [0, 5, 10, 15, 20, 30, 40, 60]) {
      const s = seaState(kt * KT)
      expect(s.slopeScale).toBeGreaterThanOrEqual(prev)
      prev = s.slopeScale
    }
    expect(seaState(60 * KT).slopeScale).toBeLessThanOrEqual(1.7)
  })
})
