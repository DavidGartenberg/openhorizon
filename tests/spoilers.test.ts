/** 737 flight spoilers / speedbrake (user goal): drag rises, lift dumps,
 *  actuator rate-limits; sans-spoiler types are bit-unchanged. */
import { describe, expect, it } from 'vitest'
import { Aircraft } from '../src/sim/aircraft'
import { B738 } from '../src/sim/aircraft/b738'
import { trim } from '../src/sim/trim'
import { kcasFromKias, KT } from '../src/sim/atmosphere'
const DT = 1/120

function cruise738(): Aircraft {
  const ac = new Aircraft({ ...B738 })
  const tas = kcasFromKias(250, 0) * KT
  const t = trim({ tasMs: tas, altM: 3048, massKg: ac.massKg, flapsDeg: 0, gammaRad: 0, params: B738 })
  ac.applyTrimState(tas, t.alphaRad, 3048, 0, 0, t.elevatorRad, t.throttle, t.rpm)
  return ac
}

describe('speedbrake', () => {
  it('rate-limits to full in ~1.2 s', () => {
    const ac = cruise738()
    ac.spoilerCmd = 1
    for (let t = 0; t < 0.5; t += DT) ac.step(DT)
    expect(ac.spoilerPos).toBeGreaterThan(0.3)
    expect(ac.spoilerPos).toBeLessThan(0.6)
    for (let t = 0; t < 1.0; t += DT) ac.step(DT)
    expect(ac.spoilerPos).toBeCloseTo(1, 2)
  })
  it('deployed: dumps total energy faster and sinks vs clean at identical controls', () => {
    // At FIXED elevator the lift dump drops the nose and the jet trades
    // altitude for speed (it can come out FASTER) — the honest measure of
    // a speedbrake is ENERGY decay: E = h + v²/2g.
    const clean = cruise738()
    const dirty = cruise738()
    dirty.spoilerCmd = 1
    const e = (a: Aircraft) => a.data.altitudeFt * 0.3048 + (a.data.ktas * 0.5144) ** 2 / (2 * 9.81)
    const e0 = e(clean)
    for (let t = 0; t < 10; t += DT) { clean.step(DT); dirty.step(DT) }
    const lossClean = e0 - e(clean)
    const lossDirty = e0 - e(dirty)
    expect(lossDirty).toBeGreaterThan(lossClean + 60) // ≥60 m more energy gone in 10 s
    expect(dirty.data.verticalSpeedFpm).toBeLessThan(clean.data.verticalSpeedFpm - 500) // lift dump sinks it
  })
  it('C172 has no spoiler system: command is inert', () => {
    const ac = new Aircraft()
    ac.spoilerCmd = 1
    for (let t = 0; t < 2; t += DT) ac.step(DT)
    expect(ac.spoilerPos).toBe(0)
  })
})
