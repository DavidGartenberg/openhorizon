import { describe, expect, it } from 'vitest'
import { atGainsFor, makeAutothrottle, stepAutothrottle } from '../src/sim/autothrottle'
import { makeAutopilotState, stepAutopilot, type AutopilotInputs } from '../src/sim/autopilot'
import { Aircraft } from '../src/sim/aircraft'
import { C172S } from '../src/sim/aircraft/c172s'
import { rosterParams, ROSTER } from '../src/sim/aircraft/roster'
import type { AircraftParams } from '../src/sim/aircraft/params'
import { trim } from '../src/sim/trim'
import { KT, FT, isa } from '../src/sim/atmosphere'

const DT = 1 / 60

/** Level flight on the real autopilot's ALT hold while the A/T chases a new
 *  speed, using this airplane's own gain class. */
function fly(P: AircraftParams, kind: string, altFt: number, startKt: number, targetKt: number, seconds: number) {
  const ac = new Aircraft(P)
  const altM = altFt * FT
  const tas = startKt * KT * Math.sqrt(1.225 / isa(altM).densityKgM3)
  const t = trim({ tasMs: tas, altM, massKg: ac.massKg, flapsDeg: 0, gammaRad: 0, params: P })
  ac.applyTrimState(tas, t.alphaRad, altM, 0, 0, t.elevatorRad, t.throttle, t.rpm)
  ac.controls.throttle = t.throttle
  const ap = makeAutopilotState(), at = makeAutothrottle(atGainsFor(kind))
  const api: AutopilotInputs = {
    iasKt: startKt, altitudeFt: altFt, verticalSpeedFpm: 0, headingDeg: 0, pitchDeg: 0, rollDeg: 0, masterEnabled: true,
    lateralMode: 'HDG', verticalMode: 'ALT', headingBugDeg: 0, altitudeBugFt: altFt, vsTargetFpm: 0, iasTargetKt: targetKt,
    bankCommandDeg: 0, pitchCommandDeg: 0, navDeviation: 0, glideslopeDeviation: 0,
  }
  ac.step(DT)
  let worstAfter = 0, overshoot = 0, minAlt = Infinity, maxAlt = -Infinity, maxLever = 0
  const n = Math.round(seconds / DT)
  for (let i = 0; i < n; i++) {
    const d = ac.data
    Object.assign(api, { iasKt: d.kias, altitudeFt: d.altitudeFt, verticalSpeedFpm: d.verticalSpeedFpm, headingDeg: d.headingDeg, pitchDeg: d.pitchDeg, rollDeg: d.rollDeg, trackDeg: d.trackDeg })
    stepAutopilot(ap, DT, api)
    ac.controls.pitch = ap.pitchCmd; ac.controls.roll = ap.rollCmd; ac.controls.yaw = ap.yawCmd; ac.controls.trim = ap.trimCommand
    const cmd = stepAutothrottle(at, DT, {
      armSwitch: true, engageAirborne: true, iasKt: d.kias, targetKt, verticalMode: 'ALT', pitchModeActive: true,
      altitudeFt: d.altitudeFt, selectedAltFt: altFt, onGround: false, lever: ac.controls.throttle,
    })
    if (cmd !== null) ac.controls.throttle = cmd
    ac.step(DT)
    const err = ac.data.kias - targetKt
    if (i * DT > seconds * 0.6) worstAfter = Math.max(worstAfter, Math.abs(err))
    overshoot = Math.max(overshoot, Math.sign(targetKt - startKt) * err)
    minAlt = Math.min(minAlt, ac.data.altitudeFt); maxAlt = Math.max(maxAlt, ac.data.altitudeFt)
    maxLever = Math.max(maxLever, ac.controls.throttle)
  }
  return { final: ac.data.kias, worstAfter, overshoot, altBand: maxAlt - minAlt, maxLever, engaged: at.engaged }
}

const kindOf = (designator: string): string => ROSTER.find((r) => r.spec.designator === designator)?.spec.powerplant.kind ?? 'piston'

describe('autothrottle holds the selected speed across the fleet (closed loop, ALT hold)', () => {
  const cases: { name: string; P: () => AircraftParams | null; kind: string; altFt: number; from: number; to: number }[] = [
    { name: 'Cessna 172S speeds up', P: () => C172S, kind: 'piston', altFt: 5000, from: 100, to: 115 },
    { name: 'Cessna 172S slows down', P: () => C172S, kind: 'piston', altFt: 5000, from: 115, to: 95 },
    { name: 'Cirrus SR22 speeds up', P: () => rosterParams('SR22'), kind: kindOf('SR22'), altFt: 8000, from: 130, to: 150 },
    { name: 'King Air 350 speeds up', P: () => rosterParams('B350'), kind: kindOf('B350'), altFt: 12000, from: 170, to: 200 },
    { name: 'TBM 930 slows down', P: () => rosterParams('TBM9'), kind: kindOf('TBM9'), altFt: 12000, from: 220, to: 180 },
    { name: 'Citation CJ2 speeds up', P: () => rosterParams('C25A'), kind: kindOf('C25A'), altFt: 12000, from: 190, to: 230 },
  ]
  for (const c of cases) {
    it(`${c.name}: settles within ±4 kt, overshoot < 8 kt, altitude stays within 60 ft`, () => {
      const P = c.P()
      expect(P).not.toBeNull()
      const r = fly(P!, c.kind, c.altFt, c.from, c.to, 300)
      expect(r.engaged).toBe(true)
      expect(r.worstAfter).toBeLessThan(4)
      expect(r.overshoot).toBeLessThan(8)
      expect(r.altBand).toBeLessThan(60)
    })
  }
  it('an unreachable speed pegs the lever at its limit without hunting (power-limited TBM)', () => {
    const r = fly(rosterParams('TBM9')!, 'turboprop', 12000, 190, 240, 300)
    expect(r.maxLever).toBeLessThanOrEqual(1)
    expect(r.maxLever).toBeGreaterThan(0.98)
    expect(r.final).toBeGreaterThan(180) // flying at full power, not stalled or collapsing
    expect(r.final).toBeLessThan(215)
    expect(r.altBand).toBeLessThan(80)
  })
})
