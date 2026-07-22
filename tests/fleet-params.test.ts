import { describe, expect, it } from 'vitest'
import { Aircraft } from '../src/sim/aircraft'
import { C172S } from '../src/sim/aircraft/c172s'
import type { AircraftParams } from '../src/sim/aircraft/params'
import { trim } from '../src/sim/trim'
import { KT } from '../src/sim/atmosphere'

/** Deep-cloned params object (distinct identity, identical numbers). */
function cloneParams(): AircraftParams {
  return JSON.parse(JSON.stringify(C172S)) as AircraftParams
}

/** Fly 30 s of identical open-loop inputs from an identical trimmed start. */
function flySignature(ac: Aircraft): number[] {
  const t = trim({ tasMs: 60, altM: 1000, massKg: ac.massKg, flapsDeg: 0, gammaRad: 0, params: ac.P })
  ac.applyTrimState(60, t.alphaRad, 1000, 0, t.gammaRad, t.elevatorRad, t.throttle, t.rpm)
  const sig: number[] = []
  for (let i = 0; i < 30 * 120; i++) {
    // Small scripted control wiggle so the trajectory exercises all axes.
    ac.controls.pitch = 0.05 * Math.sin(i / 240)
    ac.controls.roll = 0.04 * Math.sin(i / 300)
    ac.controls.yaw = 0.03 * Math.sin(i / 350)
    ac.step(1 / 120)
    if (i % 360 === 0) {
      sig.push(ac.data.kias, ac.data.altitudeFt, ac.data.headingDeg, ac.data.rollDeg, ac.data.rpm)
    }
  }
  return sig
}

describe('fleet params threading (11a)', () => {
  it('a cloned-C172S Aircraft flies a bit-identical trajectory to the default', () => {
    // Guards the whole 10a/11a refactor: same numbers through a different
    // object identity must be the same airplane, exactly.
    const a = flySignature(new Aircraft())
    const b = flySignature(new Aircraft(cloneParams()))
    expect(b).toEqual(a)
  })

  it('changed aero params change behavior (wing area reaches computeAero)', () => {
    // The physics call sites pass this.P explicitly; if any fell back to the
    // module default, this doubled wing would stall like a stock 172. 1-g
    // stall speed scales with 1/sqrt(S): doubled S → ~0.707× the stall TAS.
    const big = cloneParams()
    big.wingAreaM2 = C172S.wingAreaM2 * 2
    const stallOf = (ac: Aircraft): number => {
      const t = trim({ tasMs: 40, altM: 1000, massKg: ac.massKg, flapsDeg: 0, throttle: 0.3, params: ac.P })
      ac.applyTrimState(40, t.alphaRad, 1000, 0, t.gammaRad, t.elevatorRad, 0.3, t.rpm)
      // Decelerate with steadily increasing aft stick until stallFraction breaks.
      for (let i = 0; i < 40 * 120; i++) {
        ac.controls.throttle = 0.2
        ac.controls.pitch = Math.min(0.9, i / (15 * 120))
        ac.step(1 / 120)
        if (ac.data.stallFraction > 0.5) return ac.data.ktas
      }
      return NaN
    }
    const stock = stallOf(new Aircraft())
    const bigWing = stallOf(new Aircraft(big))
    expect(Number.isFinite(stock)).toBe(true)
    expect(Number.isFinite(bigWing)).toBe(true)
    // Meaningfully slower — well beyond numeric noise, near the √2 ratio.
    expect(bigWing).toBeLessThan(stock * 0.85)
  })

  it('changed propulsion params change behavior (rated power reaches stepPropulsion)', () => {
    const weak = cloneParams()
    weak.ratedPowerW = C172S.ratedPowerW * 0.4
    const staticThrust = (params?: AircraftParams): number => {
      const ac = params ? new Aircraft(params) : new Aircraft()
      ac.spawnOnGround(0, 0, 0, 0)
      ac.controls.throttle = 1
      ac.controls.brakeLeft = ac.controls.brakeRight = 1
      for (let i = 0; i < 6 * 120; i++) ac.step(1 / 120)
      return ac.data.thrustN
    }
    const stock = staticThrust()
    const derated = staticThrust(weak)
    expect(derated).toBeLessThan(stock * 0.75)
    expect(derated).toBeGreaterThan(50) // still an engine, not a NaN
  })

  it('flap clamp follows the params detent count, not a hardcoded 0..3', () => {
    const oneDetent: AircraftParams = {
      ...cloneParams(),
      flapDetentsDeg: [0], flapDCl0: [0], flapDClMax: [0], flapDCd: [0], flapDCm: [0],
    }
    const ac = new Aircraft(oneDetent)
    ac.spawnOnGround(0, 0, 0, 0)
    ac.controls.flapsIndex = 3 // pilot mashes the lever on a flapless type
    for (let i = 0; i < 5 * 120; i++) ac.step(1 / 120)
    expect(ac.data.flapsDeg).toBe(0)
  })

  it('sanity: the trimmed reference speed is a plausible 60 m/s cruise', () => {
    const ac = new Aircraft()
    const t = trim({ tasMs: 60, altM: 1000, massKg: ac.massKg, flapsDeg: 0, gammaRad: 0 })
    expect(t.converged).toBe(true)
    expect(60 / KT).toBeGreaterThan(100) // 60 m/s ≈ 117 kt — in the envelope
  })
})
