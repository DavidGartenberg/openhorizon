import { describe, expect, it } from 'vitest'
import { AT_CLIMB_LIMIT, atFitment, atGainsFor, makeAutothrottle, stepAutothrottle, type AtInputs } from '../src/sim/autothrottle'
import { makeAutopilotState, stepAutopilot, type AutopilotInputs } from '../src/sim/autopilot'
import { Aircraft } from '../src/sim/aircraft'
import { B738 } from '../src/sim/aircraft/b738'
import { trim } from '../src/sim/trim'
import { KT, FT, isa } from '../src/sim/atmosphere'

const DT = 1 / 60
const base: AtInputs = { armSwitch: true, iasKt: 250, targetKt: 250, verticalMode: 'ALT', pitchModeActive: true, altitudeFt: 10000, selectedAltFt: 10000, onGround: false, lever: 0.5 }

describe('autothrottle modes', () => {
  it('OFF with the switch off, ARM until engaged, MCP SPD once a pitch mode flies', () => {
    const s = makeAutothrottle()
    expect(stepAutothrottle(s, DT, { ...base, armSwitch: false })).toBeNull(); expect(s.mode).toBe('OFF')
    expect(stepAutothrottle(s, DT, { ...base, pitchModeActive: false })).toBeNull(); expect(s.mode).toBe('ARM')
    expect(stepAutothrottle(s, DT, base)).not.toBeNull(); expect(s.mode).toBe('MCP SPD')
  })
  it('LVL CHG: N1 climbing toward the selected altitude, RETARD then ARM descending', () => {
    const s = makeAutothrottle()
    stepAutothrottle(s, DT, base)
    for (let i = 0; i < 600; i++) stepAutothrottle(s, DT, { ...base, verticalMode: 'FLC', selectedAltFt: 20000, lever: s.cmd })
    expect(s.mode).toBe('N1'); expect(s.cmd).toBeCloseTo(AT_CLIMB_LIMIT, 2)
    stepAutothrottle(s, DT, { ...base, verticalMode: 'FLC', selectedAltFt: 3000, lever: s.cmd })
    expect(s.mode).toBe('RETARD')
    for (let i = 0; i < 900; i++) stepAutothrottle(s, DT, { ...base, verticalMode: 'FLC', selectedAltFt: 3000, lever: s.cmd })
    expect(s.cmd).toBe(0); expect(s.mode).toBe('ARM')
  })
  it('levers slew no faster than the servo', () => {
    const s = makeAutothrottle()
    stepAutothrottle(s, DT, { ...base, lever: 0 })
    const c = stepAutothrottle(s, DT, { ...base, verticalMode: 'FLC', selectedAltFt: 30000, lever: 0 })!
    expect(c).toBeLessThanOrEqual(0.12 * DT + 1e-9)
  })
  it('pilot override or the disconnect switch disconnects and latches the red light', () => {
    const s = makeAutothrottle()
    stepAutothrottle(s, DT, base)
    expect(stepAutothrottle(s, DT, { ...base, lever: s.cmd + 0.2 })).toBeNull()
    expect(s.engaged).toBe(false); expect(s.disconnectLight).toBe(true)
    // the latched light also blocks silent re-engagement until reset
    expect(stepAutothrottle(s, DT, { ...base, lever: 0.5 })).toBeNull()
    stepAutothrottle(s, DT, { ...base, resetLight: true, speedPressed: true })
    expect(s.engaged).toBe(true); expect(s.disconnectLight).toBe(false)
    stepAutothrottle(s, DT, { ...base, disconnectPressed: true, lever: s.cmd })
    expect(s.engaged).toBe(false); expect(s.disconnectLight).toBe(true)
  })
  it('never engages on the ground', () => {
    const s = makeAutothrottle()
    expect(stepAutothrottle(s, DT, { ...base, onGround: true, speedPressed: true })).toBeNull()
  })
})

describe('autothrottle holds MCP speed on a real 737-800 (closed loop with ALT HOLD)', () => {
  function fly(startKt: number, targetKt: number, seconds: number): { final: number; worstAfter: number; overshoot: number } {
    const ac = new Aircraft(B738)
    const altFt = 10000, altM = altFt * FT
    const tas = startKt * KT * Math.sqrt(1.225 / isa(altM).densityKgM3) // CAS → TAS (low Mach)
    const t = trim({ tasMs: tas, altM, massKg: ac.massKg, flapsDeg: 0, gammaRad: 0, params: B738 })
    ac.applyTrimState(tas, t.alphaRad, altM, 0, 0, t.elevatorRad, t.throttle, t.rpm)
    ac.controls.throttle = t.throttle
    const ap = makeAutopilotState(), at = makeAutothrottle()
    const api: AutopilotInputs = {
      iasKt: startKt, altitudeFt: altFt, verticalSpeedFpm: 0, headingDeg: 0, pitchDeg: 0, rollDeg: 0, masterEnabled: true,
      lateralMode: 'HDG', verticalMode: 'ALT', headingBugDeg: 0, altitudeBugFt: altFt, vsTargetFpm: 0, iasTargetKt: targetKt,
      bankCommandDeg: 0, pitchCommandDeg: 0, navDeviation: 0, glideslopeDeviation: 0,
    }
    let worstAfter = 0, overshoot = 0
    const n = Math.round(seconds / DT)
    ac.step(DT) // populate air data before the loops read it
    expect(Math.abs(ac.data.kias - startKt)).toBeLessThan(3) // really starts at startKt
    for (let i = 0; i < n; i++) {
      const d = ac.data
      Object.assign(api, { iasKt: d.kias, altitudeFt: d.altitudeFt, verticalSpeedFpm: d.verticalSpeedFpm, headingDeg: d.headingDeg, pitchDeg: d.pitchDeg, rollDeg: d.rollDeg, trackDeg: d.trackDeg })
      stepAutopilot(ap, DT, api)
      ac.controls.pitch = ap.pitchCmd; ac.controls.roll = ap.rollCmd; ac.controls.yaw = ap.yawCmd; ac.controls.trim = ap.trimCommand
      const cmd = stepAutothrottle(at, DT, { ...base, iasKt: d.kias, targetKt, altitudeFt: d.altitudeFt, selectedAltFt: altFt, lever: ac.controls.throttle })
      if (cmd !== null) ac.controls.throttle = cmd
      ac.step(DT)
      const err = ac.data.kias - targetKt
      if (i * DT > seconds * 0.6) worstAfter = Math.max(worstAfter, Math.abs(err))
      overshoot = Math.max(overshoot, Math.sign(targetKt - startKt) * err)
    }
    return { final: ac.data.kias, worstAfter, overshoot }
  }
  it('accelerates 250 → 280 kt and settles within ±4 kt, overshoot < 8 kt', () => {
    const r = fly(250, 280, 240)
    expect(r.worstAfter).toBeLessThan(4)
    expect(r.overshoot).toBeLessThan(8)
  })
  it('slows 280 → 240 kt and settles within ±4 kt', () => {
    const r = fly(280, 240, 300)
    expect(r.worstAfter).toBeLessThan(4)
    expect(r.overshoot).toBeLessThan(8)
  })
})

describe('autothrottle fitment and per-class gains', () => {
  it('real A/T on the airliner deck, an assist on every other powered airplane, none on gliders', () => {
    expect(atFitment('jet', true, 20000)).toBe('full')
    expect(atFitment('jet', false, 3000)).toBe('assist') // light jet without a deck A/T
    expect(atFitment('turboprop', false, 1200)).toBe('assist')
    expect(atFitment('piston', false, 150)).toBe('assist')
    expect(atFitment('none', false, 0)).toBe('none')
    expect(atFitment('piston', false, 0)).toBe('none') // no fuel capacity = no engine
  })
  it('jets keep the 0.94 climb limit; props may use the whole lever travel', () => {
    expect(atGainsFor('jet').climbLimit).toBe(0.94)
    expect(atGainsFor('turboprop').climbLimit).toBe(1)
    expect(atGainsFor('piston').climbLimit).toBe(1)
    const s = makeAutothrottle(atGainsFor('piston'))
    stepAutothrottle(s, DT, base)
    for (let i = 0; i < 900; i++) stepAutothrottle(s, DT, { ...base, verticalMode: 'FLC', selectedAltFt: 20000, lever: s.cmd })
    expect(s.cmd).toBeCloseTo(1, 2)
  })
  it('engageAirborne engages with the switch on and no autopilot; never on the ground; not after a disconnect', () => {
    const s = makeAutothrottle(atGainsFor('piston'))
    const noAp = { ...base, pitchModeActive: false, engageAirborne: true }
    expect(stepAutothrottle(s, DT, { ...noAp, onGround: true })).toBeNull()
    expect(s.engaged).toBe(false)
    expect(stepAutothrottle(s, DT, noAp)).not.toBeNull()
    expect(s.engaged).toBe(true); expect(s.mode).toBe('MCP SPD')
    stepAutothrottle(s, DT, { ...noAp, disconnectPressed: true, lever: s.cmd })
    expect(s.engaged).toBe(false)
    expect(stepAutothrottle(s, DT, noAp)).toBeNull() // latched light blocks silent re-engagement
  })
})
