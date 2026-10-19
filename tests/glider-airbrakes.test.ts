import { describe, expect, it } from 'vitest'
import { Aircraft } from '../src/sim/aircraft'
import { rosterParams } from '../src/sim/aircraft/roster'
import { trim } from '../src/sim/trim'
import { KT } from '../src/sim/atmosphere'

const DT = 1 / 120
const GLIDERS = ['AS21', 'DG80', 'LS8', 'DISC'] as const

describe('glider airbrakes', () => {
  it('fits the supported glider fleet and preserves the verified ASK 21 no-flap configuration', () => {
    for (const designator of GLIDERS) {
      const p = rosterParams(designator)!
      expect(p.spoilers, designator).toMatchObject({ groundAutoDeploy: false })
      expect(p.spoilers!.dCd, designator).toBeGreaterThan(0)
      expect(p.spoilers!.dCl, designator).toBeGreaterThan(0)
    }
    expect(rosterParams('AS21')!.flapDetentsDeg).toEqual([0])
  })

  it('travels over the documented one-second ASK 21 extension and retracts/reset cleanly', () => {
    const ac = new Aircraft(rosterParams('AS21')!)
    ac.applyTrimState(49 * KT, 0.04, 1000, 0, 0, 0, 0, 0)
    ac.spoilerCmd = 2
    for (let i = 0; i < 60; i++) ac.step(DT)
    expect(ac.spoilerPos).toBeCloseTo(0.5, 2)
    for (let i = 0; i < 90; i++) ac.step(DT)
    expect(ac.spoilerPos).toBe(1)
    ac.spoilerCmd = -1
    for (let i = 0; i < 120; i++) ac.step(DT)
    expect(ac.spoilerPos).toBeCloseTo(0, 12)

    ac.spoilerCmd = 1
    for (let i = 0; i < 30; i++) ac.step(DT)
    ac.spawnOnGround(0, 0, 0)
    expect(ac.spoilerCmd).toBe(0)
    expect(ac.spoilerPos).toBe(0)
  })

  it('leaves clean glider flight unchanged when the lever is closed', () => {
    const p = rosterParams('AS21')!
    const clean = new Aircraft(p)
    const legacy = new Aircraft({ ...p, spoilers: undefined })
    for (const ac of [clean, legacy]) ac.applyTrimState(49 * KT, 0.04, 1000, 0, 0, 0, 0, 0)
    for (let i = 0; i < 240; i++) { clean.step(DT); legacy.step(DT) }
    expect(clean.posNed).toEqual(legacy.posNed)
    expect(clean.velBody).toEqual(legacy.velBody)
    expect(clean.quat).toEqual(legacy.quat)
  })

  it('produces a steeper equilibrium descent at the same safe speed and mass', () => {
    const p = rosterParams('AS21')!
    const tasMs = 55 * KT
    const massKg = p.mtowKg * 0.9
    const clean = trim({ tasMs, altM: 1000, massKg, flapsDeg: 0, throttle: 0, params: p })
    const deployed = trim({
      tasMs, altM: 1000, massKg, flapsDeg: 0, throttle: 0, params: p,
      extraCd: p.spoilers!.dCd,
      extraClDump: p.spoilers!.dCl,
    })
    expect(clean.converged).toBe(true)
    expect(deployed.converged).toBe(true)
    expect(deployed.gammaRad).toBeLessThan(clean.gammaRad - 0.05)
  })

  for (const designator of GLIDERS) {
    it(`${designator} live command advances its actuator and removes more flight energy`, () => {
      const p = rosterParams(designator)!
      const tasMs = Math.max(p.vSpeeds.glide * KT, 55 * KT)
      const massKg = p.mtowKg * 0.9
      const steady = trim({ tasMs, altM: 1200, massKg, flapsDeg: 0, throttle: 0, params: p })
      expect(steady.converged).toBe(true)
      const clean = new Aircraft(p)
      const deployed = new Aircraft(p)
      for (const ac of [clean, deployed]) {
        ac.fuelKg = 0
        ac.payloadKg = Math.max(massKg - p.emptyMassKg, 0)
        ac.applyTrimState(tasMs, steady.alphaRad, 1200, steady.gammaRad, 0, steady.elevatorRad, 0, 0)
      }
      deployed.spoilerCmd = 1
      const energyM = (ac: Aircraft) => ac.data.altitudeFt * 0.3048 + (ac.data.ktas * KT) ** 2 / (2 * 9.81)
      for (let i = 0; i < 8 / DT; i++) { clean.step(DT); deployed.step(DT) }
      expect(deployed.spoilerPos).toBe(1)
      expect(energyM(deployed), designator).toBeLessThan(energyM(clean) - 8)
    })
  }

  it('does not turn an armed glider lever into jet touchdown autodeploy', () => {
    const ac = new Aircraft(rosterParams('AS21')!)
    ac.spawnOnGround(0, 0, 0)
    ac.spoilerArmed = true
    for (let i = 0; i < 30; i++) ac.step(DT)
    expect(ac.spoilerCmd).toBe(0)
    expect(ac.spoilerPos).toBe(0)
  })
})
