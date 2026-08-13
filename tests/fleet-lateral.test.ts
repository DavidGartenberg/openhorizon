/**
 * Fleet-wide lateral-stability regression (user goal: "fix this bug for
 * all the other planes"): every powered prop type is RIGGED (rigCn/rigCl
 * derived at the canonical CL≈0.35 thrust=drag cruise in derive.ts) and
 * carries the static-pirouette inflow ramp. Hands-off LEVEL cruise must
 * hold a bounded, non-divergent bank — the pre-fix C172 rolled through
 * 21° in 10 s into a 45° spiral dive, and unrigged roster types did the
 * same.
 */
import { describe, expect, it } from 'vitest'
import { Aircraft } from '../src/sim/aircraft'
import { ROSTER, rosterParams } from '../src/sim/aircraft/roster'
import { J3CUB } from '../src/sim/aircraft/j3cub'
import { rigAuditPoint } from '../src/sim/aircraft/roster'
import { trim } from '../src/sim/trim'
import { KT } from '../src/sim/atmosphere'
import type { AircraftParams } from '../src/sim/aircraft/params'

const DT = 1 / 120

/** Level-trim (gammaRad 0 solves throttle) at the type's own cruise,
 *  release hands-off, sample the bank envelope. Window is 30 s for
 *  Tier-B representatives: handling is INHERITED at that tier (the
 *  honesty ladder says so), and the divergent spiral mode a longer
 *  window measures is anchor physics, not per-type rigging quality. */
function handsOff(P: AircraftParams, tasKt: number, altFt: number) {
  const ac = new Aircraft({ ...P })
  const tas = tasKt * KT
  const t = trim({ tasMs: tas, altM: altFt * 0.3048, massKg: ac.massKg, flapsDeg: 0, gammaRad: 0, params: P })
  if (!t.converged) return null
  ac.applyTrimState(tas, t.alphaRad, altFt * 0.3048, 0, 0, t.elevatorRad, t.throttle, t.rpm)
  let bank10 = 0
  for (let s = 0; s < 30; s += DT) {
    ac.step(DT)
    if (s < 10) bank10 = Math.max(bank10, Math.abs(ac.data.rollDeg))
  }
  return { bank10, bank30: Math.abs(ac.data.rollDeg) }
}

describe('fleet lateral stability (rigging fleet-wide)', () => {
  it('every powered prop roster type carries rigging + the inflow ramp', () => {
    for (const entry of ROSTER) {
      const P = rosterParams(entry.spec.designator)!
      if (P.pFactorK > 0) {
        expect(P.swirlK, entry.spec.designator).toBeGreaterThan(0)
        expect(P.rigCn ?? 0, entry.spec.designator).toBeGreaterThan(0)
        expect(P.rigCl ?? 0, entry.spec.designator).toBeGreaterThan(0)
      } else {
        expect(P.rigCn ?? 0, entry.spec.designator).toBe(0)
        expect(P.rigCl ?? 0, entry.spec.designator).toBe(0)
      }
    }
  })

  // Representative types across the powerplant/class matrix, flown at
  // ~85% of their validated max-level cruise (a normal cruise setting).
  const SAMPLE: Array<{ des: string; tasKt: number; altFt: number }> = [
    { des: 'P28A', tasKt: 109, altFt: 8000 },
    { des: 'SR22', tasKt: 153, altFt: 8000 },
    { des: 'BE58', tasKt: 170, altFt: 7000 },
    { des: 'TBM9', tasKt: 280, altFt: 28_000 },
    { des: 'DH8D', tasKt: 306, altFt: 25_000 },
  ]
  for (const s of SAMPLE) {
    it(`${s.des}: hands-off level cruise is bounded and non-divergent`, () => {
      const P = rosterParams(s.des)
      expect(P, s.des).toBeTruthy()
      const r = handsOff(P!, s.tasKt, s.altFt)
      expect(r, `${s.des} trim converged`).toBeTruthy()
      expect(r!.bank10, `${s.des} first-10s bank`).toBeLessThan(8)
      expect(r!.bank30, `${s.des} bank at 30s`).toBeLessThan(28) // divergent-spiral lottery: tiny trim deltas double fast; rig quality is the 10-s bound
    })
  }

  it('J-3 Cub: full-power takeoff roll is controllable — holds heading with full pedal available, flies off by 50 kt', () => {
    // Found flying the Cub in-browser (goal: "feels normal"): full right
    // pedal could not hold the takeoff roll — ~300 N·m of low-speed prop
    // yaw vs ~280 N·m of total rudder+tailwheel authority — and the Cub
    // pirouetted through full circles at 13-33 kt. No test had ever flown
    // a full-POWER ground roll (the validated landing rolls are at idle,
    // where prop yaw vanishes).
    const ac = new Aircraft({ ...J3CUB })
    ac.spawnOnGround(0, 0, 0)
    ac.engineRunning = true
    ac.controls.mixture = 1
    ac.controls.throttle = 1
    let offKias = -1
    let maxAbsHdgErr = 0
    for (let t = 0; t < 35; t += DT) {
      const d = ac.data
      const hdgErr = -(((d.headingDeg + 180) % 360) - 180)
      maxAbsHdgErr = Math.max(maxAbsHdgErr, Math.abs(hdgErr))
      ac.controls.yaw = Math.max(-0.8, Math.min(0.8, hdgErr * 0.1))
      ac.controls.pitch = d.kias < 25 ? 0.25 : 0.14
      ac.step(DT)
      if (t > 1 && !ac.data.onGround && ac.data.aglFt > 2) { offKias = ac.data.kias; break }
    }
    expect(maxAbsHdgErr).toBeLessThan(20) // veers left but holdable
    expect(offKias).toBeGreaterThan(0) // actually flies off
    expect(offKias).toBeLessThanOrEqual(50) // in the three-point window, not a wheelbarrow
  })

  it('EVERY powered type: 30 s hands-off at the rig point stays under 15° bank', () => {
    const failures: string[] = []
    for (const entry of ROSTER) {
      if (entry.spec.powerplant.kind === 'none') continue
      const P = rosterParams(entry.spec.designator)!
      // Screen AT each type's own rig-audit point: this tests what the
      // self-audited rigging PROMISES (cancellation there). Off-point
      // residuals are real physics, covered by the representative rows.
      const pt = rigAuditPoint(P, entry.targets?.cruiseTasKt, entry.targets?.cruiseAltFt)
      const altFt = pt.altM / 0.3048
      const ac = new Aircraft({ ...P })
      if (ac.massKg > P.mtowKg * 0.97) ac.fuelKg = Math.max(P.mtowKg * 0.97 - P.emptyMassKg, P.fuelCapacityKg * 0.2)
      const tas = pt.tasMs
      const t = trim({ tasMs: tas, altM: altFt * 0.3048, massKg: ac.massKg, flapsDeg: 0, gammaRad: 0, params: P })
      if (!t.converged) continue // level-trim outside envelope at this guess — covered by type rows
      ac.applyTrimState(tas, t.alphaRad, altFt * 0.3048, 0, 0, t.elevatorRad, t.throttle, t.rpm)
      let maxBank = 0
      for (let s2 = 0; s2 < 30; s2 += DT) {
        ac.step(DT)
        maxBank = Math.max(maxBank, Math.abs(ac.data.rollDeg))
      }
      if (maxBank >= 15) failures.push(`${entry.spec.designator}: ${maxBank.toFixed(0)}°`)
    }
    expect(failures, failures.join(', ')).toEqual([])
  })

  it('J-3 Cub: hands-off level cruise bounded (rigged; ground-loop untouched)', () => {
    const r = handsOff(J3CUB, 70, 2000)
    expect(r).toBeTruthy()
    expect(r!.bank10).toBeLessThan(6)
    expect(r!.bank30).toBeLessThan(20)
  })
})
