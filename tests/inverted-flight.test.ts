/**
 * Inverted flight is a systems problem, not an aerodynamic one: a
 * cambered wing flies upside down fine, but gravity-fed fuel pickups and
 * wet-sump oil don't. Closed-loop on the real airframes — the airplane is
 * rolled and held inverted with the same fuel + engine chain main.ts runs.
 */
import { describe, expect, it } from 'vitest'
import { Aircraft } from '../src/sim/aircraft'
import { C172S } from '../src/sim/aircraft/c172s'
import { B738 } from '../src/sim/aircraft/b738'
import type { AircraftParams } from '../src/sim/aircraft/params'
import { rosterParams } from '../src/sim/aircraft/roster'
import { trim } from '../src/sim/trim'
import { KT, FT, isa } from '../src/sim/atmosphere'
import { makeFuelState, negativeGToleranceS, stepFuel } from '../src/sim/systems/fuel'
import { makeEngineStartState, stepEngineStart } from '../src/sim/systems/engine-start'

const DT = 1 / 60
const wrap = (a: number): number => ((a + 540) % 360) - 180

interface Run { engineOutAtS: number | null; minAltFt: number; sampled: Array<{ t: number; roll: number; g: number; running: boolean }>; ac: Aircraft }

/** Roll to `targetRoll` and hold it; pitch holds roughly level flight. */
function fly(P: AircraftParams, kias: number, altFt: number, targetRoll: number, seconds: number): Run {
  const ac = new Aircraft(P)
  const altM = altFt * FT
  const tas = kias * KT * Math.sqrt(1.225 / isa(altM).densityKgM3)
  const t = trim({ tasMs: tas, altM, massKg: ac.massKg, flapsDeg: 0, gammaRad: 0, params: P })
  ac.applyTrimState(tas, t.alphaRad, altM, 0, 0, t.elevatorRad, t.throttle, t.rpm)
  ac.controls.throttle = t.throttle
  ac.controls.mixture = 1
  const fuel = makeFuelState(ac.fuelKg / 2, ac.fuelKg / 2)
  const eng = makeEngineStartState()
  eng.status = 'running'
  const tol = negativeGToleranceS(P)
  ac.step(DT)
  const out: Run = { engineOutAtS: null, minAltFt: altFt, sampled: [], ac }
  for (let i = 0; i < seconds / DT; i++) {
    const d = ac.data, tt = i * DT
    ac.controls.roll = Math.max(-1, Math.min(1, wrap((tt < 2 ? 0 : targetRoll) - d.rollDeg) / 40))
    const inverted = Math.abs(d.rollDeg) > 120
    ac.controls.pitch = inverted
      ? Math.max(-1, Math.min(1, 0.5 * d.verticalSpeedFpm / 1000 - 0.15))
      : Math.max(-1, Math.min(1, -0.003 * d.verticalSpeedFpm / 10))
    ac.step(DT)
    stepFuel(fuel, DT, { selector: 'BOTH', boostPumpOn: false, demandKgS: ac.prop.fuelFlowKgS, loadFactorG: ac.data.loadFactorG, negGToleranceS: tol })
    stepEngineStart(eng, DT, { masterBattery: true, starterEngaged: false, magneto: 'both', mixtureRich: true, throttleFrac: ac.controls.throttle, fuelAvailable: fuel.fuelFlowing, hotEngine: false, floodedEngine: false, primed: false, hasElectrical: true, handPropPull: false })
    ac.engineRunning = eng.status === 'running'
    ac.fuelKg = fuel.leftKg + fuel.rightKg
    if (!ac.engineRunning && out.engineOutAtS === null) out.engineOutAtS = tt
    out.minAltFt = Math.min(out.minAltFt, ac.data.altitudeFt)
    if (i % Math.round(2 / DT) === 0) out.sampled.push({ t: tt, roll: ac.data.rollDeg, g: ac.data.loadFactorG, running: ac.engineRunning })
    if (ac.crashed) break
  }
  return out
}

describe('inverted flight', () => {
  it('the C172 really can be held inverted aerodynamically (the engine is what stops it)', () => {
    const r = fly(C172S, 110, 6000, 180, 10)
    const settled = r.sampled.filter(s => s.t >= 6)
    expect(settled.every(s => Math.abs(s.roll) > 150 && s.g < 0)).toBe(true)
  })
  it('a C172 held inverted loses its engine within ~10 s, then can no longer climb', () => {
    const r = fly(C172S, 110, 6000, 180, 40)
    expect(r.engineOutAtS).not.toBeNull()
    expect(r.engineOutAtS!).toBeGreaterThan(6)
    expect(r.engineOutAtS!).toBeLessThan(14)
  })
  it('a 737 held inverted loses its engines too, but later than a piston single', () => {
    expect(negativeGToleranceS(B738)).toBeGreaterThan(negativeGToleranceS(C172S))
  })
  it('the Extra 300L is built for it: engine keeps running inverted indefinitely', () => {
    const E = rosterParams('E300')!
    expect(E.invertedCapable).toBe(true)
    const r = fly(E, 120, 6000, 180, 40)
    expect(r.engineOutAtS).toBeNull()
  })
  it('upright flight, climbs and turns never starve the engine', () => {
    const r = fly(C172S, 110, 6000, 0, 60)
    expect(r.engineOutAtS).toBeNull()
    const turn = fly(C172S, 110, 6000, 45, 60)
    expect(turn.engineOutAtS).toBeNull()
  })
})
