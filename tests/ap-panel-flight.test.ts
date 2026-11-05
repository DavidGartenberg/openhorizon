/**
 * The flight-guidance panel flying real airplanes through the real control
 * laws (closed loop): the pilot's presses, not hand-built targets.
 */
import { describe, expect, it } from 'vitest'
import { makeAutopilotState, stepAutopilot, type AutopilotInputs } from '../src/sim/autopilot'
import { Aircraft } from '../src/sim/aircraft'
import { C172S } from '../src/sim/aircraft/c172s'
import { B738 } from '../src/sim/aircraft/b738'
import type { AircraftParams } from '../src/sim/aircraft/params'
import { trim } from '../src/sim/trim'
import { KT, FT, isa } from '../src/sim/atmosphere'
import { applyApFeedback, makeApPanel, pressAlt, pressAp, pressFlc, pressHdg, pressVs, toApTargets, turnKnob, type ApPanel, type ApSnapshot } from '../src/sim/ap-panel'

const DT = 1 / 60
const wrap = (a: number): number => ((a + 540) % 360) - 180

function setup(P: AircraftParams, kias: number, altFt: number) {
  const ac = new Aircraft(P)
  const altM = altFt * FT
  const tas = kias * KT * Math.sqrt(1.225 / isa(altM).densityKgM3)
  const t = trim({ tasMs: tas, altM, massKg: ac.massKg, flapsDeg: 0, gammaRad: 0, params: P })
  ac.applyTrimState(tas, t.alphaRad, altM, 0, 0, t.elevatorRad, t.throttle, t.rpm)
  ac.controls.throttle = t.throttle
  ac.step(DT)
  const ap = makeAutopilotState()
  const snap = (): ApSnapshot => ({ headingDeg: ac.data.headingDeg, altitudeFt: ac.data.altitudeFt, verticalSpeedFpm: ac.data.verticalSpeedFpm, iasKt: ac.data.kias, rollDeg: ac.data.rollDeg })
  let panel: ApPanel = makeApPanel()
  const press = (fn: (p: ApPanel, s: ApSnapshot) => { panel: ApPanel }): void => { panel = fn(panel, snap()).panel }
  /** One frame of the app's loop: panel → targets → control laws → airframe. */
  const frame = (throttleHold?: number | (() => number)): void => {
    const d = ac.data
    const tg = toApTargets(panel, snap())
    const inp: AutopilotInputs = {
      iasKt: d.kias, altitudeFt: d.altitudeFt, verticalSpeedFpm: d.verticalSpeedFpm, headingDeg: d.headingDeg, pitchDeg: d.pitchDeg, rollDeg: d.rollDeg,
      masterEnabled: panel.master, lateralMode: tg.lateralMode, verticalMode: tg.verticalMode, underlyingVerticalMode: tg.underlyingVerticalMode,
      headingBugDeg: tg.headingBugDeg, altitudeBugFt: tg.altitudeBugFt, vsTargetFpm: tg.vsTargetFpm, iasTargetKt: tg.iasTargetKt,
      bankCommandDeg: 0, pitchCommandDeg: 0, navDeviation: 0, glideslopeDeviation: 0, trackDeg: d.trackDeg,
    }
    stepAutopilot(ap, DT, inp)
    panel = applyApFeedback(panel, { altsCaptured: ap.altsCaptured })
    if (panel.master) { ac.controls.pitch = ap.pitchCmd; ac.controls.roll = ap.rollCmd; ac.controls.yaw = ap.yawCmd; ac.controls.trim = ap.trimCommand }
    if (throttleHold !== undefined) ac.controls.throttle = typeof throttleHold === 'function' ? throttleHold() : throttleHold
    ac.step(DT)
  }
  const run = (seconds: number, throttleHold?: number | (() => number), each?: (t: number) => void): void => {
    for (let i = 0; i < seconds / DT; i++) { frame(throttleHold); each?.(i * DT) }
  }
  return { ac, ap, press, run, panelRef: () => panel, setPanel: (f: (p: ApPanel) => ApPanel) => { panel = f(panel) } }
}

/** Dial the selected altitude to exactly `target` from wherever it is. */
const selectAltitude = (target: number) => (p: ApPanel): ApPanel => turnKnob(p, 'altitude', (target - p.sel.altitudeFt) / 100)

/** Dial the vertical-speed target to exactly `fpm`. */
const selectVs = (fpm: number) => (p: ApPanel): ApPanel => turnKnob(p, 'vs', (fpm - p.sel.vsFpm) / 100)

describe('panel-driven autopilot on a Cessna 172', () => {
  it('climbs on VS to a selected altitude and captures it without overshoot, then holds', () => {
    const t = setup(C172S, 100, 3000)
    t.press(pressAp)
    t.run(5)
    t.setPanel(selectAltitude(4500))
    t.press(pressVs)
    t.setPanel(selectVs(400))
    let maxAlt = 0
    t.run(330, () => (t.ap.verticalMode === 'ALT' ? 0.78 : 1), () => { maxAlt = Math.max(maxAlt, t.ac.data.altitudeFt) })
    expect(t.ac.data.altitudeFt).toBeGreaterThan(4450); expect(t.ac.data.altitudeFt).toBeLessThan(4550)
    expect(maxAlt).toBeLessThan(4580)
    expect(Math.abs(t.ac.data.verticalSpeedFpm)).toBeLessThan(80)
    expect(t.ap.verticalMode).toBe('ALT')
  })
  it('descends on VS to a lower selected altitude and captures it', () => {
    const t = setup(C172S, 100, 5000)
    t.press(pressAp); t.run(4)
    t.setPanel(selectAltitude(3500))
    t.press(pressVs)
    t.setPanel(selectVs(-500))
    t.run(300, () => (t.ap.verticalMode === 'ALT' ? 0.7 : 0.3))
    expect(t.ac.data.altitudeFt).toBeGreaterThan(3440); expect(t.ac.data.altitudeFt).toBeLessThan(3560)
  })
  it('ALT hold keeps the altitude of the press through a disturbance', () => {
    const t = setup(C172S, 100, 4000)
    t.press(pressAp); t.run(2); t.press(pressAlt)
    t.ac.velBody.z += 3 // a gust-like vertical kick
    let worst = 0
    t.run(60, undefined, () => { worst = Math.max(worst, Math.abs(t.ac.data.altitudeFt - 4000)) })
    expect(worst).toBeLessThan(40); expect(Math.abs(t.ac.data.altitudeFt - 4000)).toBeLessThan(15)
  })
  it('HDG turns to a selected heading and rolls out on it, bank within limits', () => {
    const t = setup(C172S, 100, 3000)
    t.press(pressAp); t.run(3)
    t.setPanel(p => turnKnob(p, 'heading', 90, { headingDeg: t.ac.data.headingDeg, altitudeFt: 3000, verticalSpeedFpm: 0, iasKt: 100, rollDeg: 0 }))
    t.press(pressHdg)
    let maxBank = 0
    t.run(90, 0.8, () => { maxBank = Math.max(maxBank, Math.abs(t.ac.data.rollDeg)) })
    expect(Math.abs(wrap(t.ac.data.headingDeg - 90))).toBeLessThan(3)
    expect(maxBank).toBeLessThan(31); expect(Math.abs(t.ac.data.rollDeg)).toBeLessThan(3)
  })
})

describe('panel-driven autopilot on a Boeing 737-800', () => {
  it('level change (FLC) climbs to the selected altitude and captures it', () => {
    const t = setup(B738, 250, 10000)
    t.press(pressAp); t.run(4)
    t.setPanel(selectAltitude(12000))
    t.press(pressFlc)
    let maxAlt = 0
    t.run(240, 0.9, () => { maxAlt = Math.max(maxAlt, t.ac.data.altitudeFt) })
    expect(t.ac.data.altitudeFt).toBeGreaterThan(11940); expect(t.ac.data.altitudeFt).toBeLessThan(12080)
    expect(maxAlt).toBeLessThan(12150)
  })
})
