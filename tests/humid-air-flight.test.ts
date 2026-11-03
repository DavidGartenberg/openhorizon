/**
 * Humid air in flight (weather/humidity.ts): water vapour makes the air
 * lighter and takes a piston engine's oxygen. The aircraft and the trim
 * solver must agree on it (a humid-day final spawn otherwise arrives
 * mistrimmed), and a hot day's Mach must follow the real temperature.
 */
import { describe, expect, it } from 'vitest'
import { Aircraft } from '../src/sim/aircraft'
import { B738 } from '../src/sim/aircraft/b738'
import { trim } from '../src/sim/trim'
import { isa, KT, R_AIR } from '../src/sim/atmosphere'
import type { SurfaceHumidity } from '../src/sim/weather/humidity'

const DT = 1 / 120
const MUGGY: SurfaceHumidity = { dewPointC: 26, stationPressurePa: isa(0).pressurePa }

/** Full-power C172 climb on a hot day: the trimmed rate, and the flown
 *  rate 2 s on (before the documented hands-off roll-off sets in). */
function climb(humidity: SurfaceHumidity | null): { trimFpm: number; flownFpm: number } {
  const ac = new Aircraft()
  ac.isaTempOffsetC = 15
  ac.humidity = humidity
  const altM = 300, tas = 75 * KT
  const t = trim({ tasMs: tas, altM, massKg: ac.massKg, flapsDeg: 0, throttle: 1, isaTempOffsetC: 15, humidity })
  expect(t.converged).toBe(true)
  ac.applyTrimState(tas, t.alphaRad, altM, 0, t.gammaRad, t.elevatorRad, t.throttle, t.rpm)
  for (let s = 0; s < 2; s += DT) ac.step(DT)
  return { trimFpm: (Math.sin(t.gammaRad) * tas) / 0.00508, flownFpm: ac.data.verticalSpeedFpm }
}

describe('humid air', () => {
  it('is thinner and starves a piston engine: a full-power climb on a muggy day is weaker', () => {
    const dry = climb(null), wet = climb(MUGGY)
    expect(dry.trimFpm).toBeGreaterThan(500)
    expect(wet.trimFpm).toBeLessThan(dry.trimFpm * 0.96) // ≈3% charge and ≈1% density
    expect(wet.trimFpm).toBeGreaterThan(dry.trimFpm * 0.85) // a few per cent, not a different airplane
    // The airplane flies what the trim promised, dry or humid.
    expect(Math.abs(dry.flownFpm - dry.trimFpm)).toBeLessThan(25)
    expect(Math.abs(wet.flownFpm - wet.trimFpm)).toBeLessThan(25)
  })

  it('trim and flight agree on it: a humid trim flies like a dry day, a dry trim sinks', () => {
    const fly = (air: SurfaceHumidity | null, trimFor: SurfaceHumidity | null): number => {
      const ac = new Aircraft(B738)
      ac.humidity = air
      ac.isaTempOffsetC = 12
      const altM = 450, tas = 150 * KT
      const t = trim({ tasMs: tas, altM, massKg: ac.massKg, flapsDeg: 15, gammaRad: 0, params: B738, isaTempOffsetC: 12, humidity: trimFor })
      ac.resetFlaps(3)
      ac.applyTrimState(tas, t.alphaRad, altM, 0, t.gammaRad, t.elevatorRad, t.throttle, t.rpm)
      for (let s = 0; s < 6; s += DT) ac.step(DT)
      return ac.data.verticalSpeedFpm
    }
    // This configuration drifts a little on its own; the reference is a dry day.
    const baseline = fly(null, null)
    const matched = fly(MUGGY, MUGGY), dryTrim = fly(MUGGY, null)
    expect(Math.abs(matched - baseline)).toBeLessThan(15)
    expect(dryTrim - baseline).toBeLessThan(-40) // trimmed for denser air: it sinks
  })

  it('a hot day’s speed of sound follows its temperature', () => {
    const ac = new Aircraft(B738)
    ac.isaTempOffsetC = 20
    const altM = 1000
    ac.applyTrimState(130, 0.05, altM, 0, 0, 0, 0.6, 0)
    ac.step(DT)
    const T = isa(altM).temperatureK + 20
    const air = (ac as unknown as { air: { speedOfSoundMs: number } }).air
    expect(air.speedOfSoundMs).toBeCloseTo(Math.sqrt(1.4 * R_AIR * T), 6)
  })
})
