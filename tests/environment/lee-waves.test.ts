/**
 * Mountain lee waves: standing waves downwind of a ridge in a stable
 * airstream: λ = 2πU/N, sink on the lee slope, lift ≈ ¾λ downwind, no flow
 * through the ground, decaying downstream, killed by convection.
 */
import { describe, expect, it } from 'vitest'
import { leeWaveUpdraft, upwindRidge, LEE_WAVE_N } from '../../src/sim/environment/thermals'
import { Environment, type EnvironmentState } from '../../src/sim/environment'
import { C172S } from '../../src/sim/aircraft/c172s'
import { v3 } from '../../src/math/vec'

describe('mountain lee waves', () => {
  const U = 20, lambda = (2 * Math.PI * U) / LEE_WAVE_N

  it('has the wavelength 2πU/N (≈11 km in a 20 m/s wind), lift and sink alternating every half wave', () => {
    expect(lambda).toBeGreaterThan(10_000)
    expect(lambda).toBeLessThan(12_500)
    const w = (x: number): number => leeWaveUpdraft(x, 3000, 800, U, 1)
    expect(w(lambda / 4)).toBeLessThan(0) // sink on the lee slope
    expect(w((3 * lambda) / 4)).toBeGreaterThan(0) // the primary wave
    expect(w((7 * lambda) / 4)).toBeGreaterThan(0) // the next crest, one λ on
    expect(w((5 * lambda) / 4)).toBeLessThan(0)
    expect(w((7 * lambda) / 4)).toBeLessThan(w((3 * lambda) / 4)) // decaying downstream
  })

  it('is about N·A strong (A = half the prominence) and grows with the ridge', () => {
    const peak = (h: number): number => leeWaveUpdraft((3 * lambda) / 4, 4000, h, U, 1) / Math.exp(-0.75 / 3)
    expect(peak(800)).toBeCloseTo(LEE_WAVE_N * 400, 1)
    expect(peak(1200)).toBeGreaterThan(peak(600))
    expect(peak(40)).toBe(0) // no ridge, no wave
  })

  it('needs wind and stable air, and has no flow through the ground', () => {
    expect(leeWaveUpdraft((3 * lambda) / 4, 3000, 800, 5, 1)).toBe(0) // light wind
    expect(leeWaveUpdraft((3 * lambda) / 4, 3000, 800, U, 0)).toBe(0) // convective day
    expect(leeWaveUpdraft((3 * lambda) / 4, 0, 800, U, 1)).toBeCloseTo(0, 12)
    expect(Math.abs(leeWaveUpdraft((3 * lambda) / 4, 200, 800, U, 1))).toBeLessThan(Math.abs(leeWaveUpdraft((3 * lambda) / 4, 2000, 800, U, 1)))
    expect(leeWaveUpdraft(-1000, 3000, 800, U, 1)).toBe(0) // upwind of the crest
  })

  it('finds the ridge upwind along the wind', () => {
    // Ridge 900 m high running east-west, 8 km north of the origin; wind from the north.
    const elev = (n: number): number => 900 * Math.exp(-(((n - 8000) / 1500) ** 2))
    const r = upwindRidge((n) => elev(n), 0, 0, -U, 0) // blowing toward the south
    expect(r!.distanceM).toBeCloseTo(8000, -3)
    expect(r!.prominenceM).toBeGreaterThan(850)
    expect(upwindRidge(() => 0, 0, 0, -U, 0)).toBeNull()
  })

  it('the environment adds the wave lift into the air an aircraft flies through', () => {
    const elev = (n: number): number => 900 * Math.exp(-(((n - 8000) / 1500) ** 2))
    const env = new Environment(C172S)
    const state = (n: number): EnvironmentState => ({
      timeS: 600, dt: 1 / 60, n, e: 0, altM: 3000, aglM: 3000 - elev(n), tasMs: 50, headingRad: 0, trackRad: 0,
      groundSpeedMs: 50, onGround: false, loadFactorG: 1, flapsDeg: 0, rollRate: 0, oatC: -5, inCloud: 0,
      weather: [], sunElevDeg: -10, cloudCover: 0, overWater: false, groundElevAt: (nn) => elev(nn), windN: -14, windE: 0,
      turbulenceRollGust: 0,
    })
    const hooks = { iceCdInc: 0, clMaxFactor: 1, rollGustRate: 0, brakeMuScale: 1, latMuScale: 1, rollingScale: 1, wingFailure: 0 as -1 | 0 | 1 }
    const lam = (2 * Math.PI * 1.4 * 14) / LEE_WAVE_N
    const w = v3()
    env.step(state(8000 - 0.75 * lam), w, hooks) // ¾λ south (downwind) of the crest
    expect(env.status.leeWaveMs).toBeGreaterThan(1.5)
    expect(w.z).toBeLessThan(-1.5) // NED: the air rises
  })
})
