import { describe, expect, it } from 'vitest'
import { LightningScheduler, boltSegments, stormActivity } from '../src/sim/weather/lightning'
import { seededRandom } from '../src/sim/environment/rng'

describe('lightning', () => {
  it('only storms make lightning; heavier storms strike more often and closer', () => {
    expect(stormActivity({ weather: ['-RA'], heavyCellDistM: null })).toBeNull()
    const ts = stormActivity({ weather: ['TSRA'], heavyCellDistM: null })!
    const heavy = stormActivity({ weather: ['+TSRA'], heavyCellDistM: null })!
    const vc = stormActivity({ weather: ['VCTS'], heavyCellDistM: null })!
    expect(heavy.meanIntervalS).toBeLessThan(ts.meanIntervalS)
    expect(vc.minM).toBeGreaterThan(ts.minM)
    const radar = stormActivity({ weather: [], heavyCellDistM: 9000 })!
    expect(radar.minM).toBeLessThan(9000)
    expect(radar.maxM).toBeGreaterThan(9000)
  })

  it('strikes as a Poisson process at the storm rate, thunder at 343 m/s', () => {
    const s = new LightningScheduler()
    const rnd = seededRandom(3)
    const strikes = []
    for (let t = 0; t < 3600; t += 0.1) {
      const k = s.step(t, { weather: ['TSRA'], heavyCellDistM: null }, rnd)
      if (k) strikes.push(k)
    }
    expect(strikes.length).toBeGreaterThan(3600 / 9 * 0.75)
    expect(strikes.length).toBeLessThan(3600 / 9 * 1.25)
    for (const k of strikes) {
      expect(k.distanceM).toBeGreaterThanOrEqual(1200)
      expect(k.distanceM).toBeLessThanOrEqual(12_000)
      expect(k.thunderDelayS).toBeCloseTo(k.distanceM / 343, 6)
    }
    expect(s.step(4000, { weather: [], heavyCellDistM: null }, rnd)).toBeNull()
  })

  it('draws a connected, forked channel from the cloud base to the ground', () => {
    const seg = boltSegments(1500, 42)
    expect(seg.length % 6).toBe(0)
    const ys = seg.filter((_, i) => i % 3 === 1)
    expect(Math.max(...ys)).toBeCloseTo(1500, 6)
    expect(Math.min(...ys)).toBeLessThanOrEqual(0.0001)
    expect(seg.length / 6).toBeGreaterThan(128) // main channel 2^7 + forks
    expect(boltSegments(1500, 42)).toEqual(seg) // deterministic per seed
  })
})
