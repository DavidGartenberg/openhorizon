/**
 * Heavy rain through the environment: the airframe pays the CLmax and drag
 * penalty (weather/heavy-rain.ts) only in the rain shaft, at or below the
 * top of the deck it falls from, and on top of any ice.
 */
import { describe, expect, it } from 'vitest'
import { Environment, type EnvironmentState } from '../../src/sim/environment'
import { B738 } from '../../src/sim/aircraft/b738'
import { v3 } from '../../src/math/vec'

const state = (over: Partial<EnvironmentState> = {}): EnvironmentState => ({
  timeS: 600, dt: 1 / 60, n: 0, e: 0, altM: 900, aglM: 880, tasMs: 75, headingRad: 0, trackRad: 0,
  groundSpeedMs: 75, onGround: false, loadFactorG: 1, flapsDeg: 15, rollRate: 0, oatC: 18, inCloud: 0,
  weather: [], sunElevDeg: 30, cloudCover: 0.8, overWater: false, groundElevAt: null, windN: 0, windE: 0,
  turbulenceRollGust: 0, ...over,
})
const hooks = () => ({ iceCdInc: 0, clMaxFactor: 1, rollGustRate: 0, brakeMuScale: 1, latMuScale: 1, rollingScale: 1, wingFailure: 0 as -1 | 0 | 1 })

describe('heavy rain on the airframe (environment)', () => {
  it('costs lift margin and adds drag under a thunderstorm deck', () => {
    const env = new Environment(B738)
    env.toggles.windshear = false
    const h = hooks()
    env.step(state({ weather: ['+TSRA'], rainTopM: 9000 }), v3(), h)
    expect(env.status.rainMmH).toBe(60)
    expect(h.clMaxFactor).toBeLessThan(0.96)
    expect(h.clMaxFactor).toBeGreaterThan(0.9)
    expect(h.iceCdInc).toBeGreaterThan(0.002)
  })

  it('stops above the deck the rain falls from, and is nothing in drizzle', () => {
    const env = new Environment(B738)
    const h = hooks()
    env.step(state({ weather: ['+RA'], rainTopM: 2500, altM: 3500, aglM: 3480 }), v3(), h)
    expect(env.status.rainMmH).toBe(0)
    expect(h.clMaxFactor).toBe(1)
    expect(h.iceCdInc).toBe(0)
    const drizzle = hooks()
    env.step(state({ weather: ['-RA'], rainTopM: 2500 }), v3(), drizzle)
    expect(drizzle.clMaxFactor).toBe(1)
    expect(drizzle.iceCdInc).toBe(0)
  })

  it('adds to the ice penalty rather than replacing it', () => {
    const iced = (weather: string[]): ReturnType<typeof hooks> => {
      const env = new Environment(B738)
      env.antiIce = 'off'
      const h = hooks()
      for (let i = 0; i < 60 * 120; i++) env.step(state({ dt: 1 / 60, timeS: i / 60, oatC: -4, inCloud: 1, weather, rainTopM: 6000 }), v3(), h)
      return h
    }
    const dry = iced([]), wet = iced(['+RA'])
    expect(dry.clMaxFactor).toBeLessThan(1)
    expect(wet.clMaxFactor).toBeLessThan(dry.clMaxFactor)
    expect(wet.iceCdInc).toBeGreaterThan(dry.iceCdInc)
  })
})
