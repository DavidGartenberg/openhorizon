import { describe, expect, it } from 'vitest'
import {
  apEnvelopeFault, applyApFeedback, defaultSelectedAltitude, disconnectAp, makeApPanel, pressAlt, pressAp, pressApr, pressFlc, pressHdg, pressNav, pressVs, toApTargets, turnKnob,
  type ApAvailability, type ApSnapshot,
} from '../src/sim/ap-panel'

const snap: ApSnapshot = { headingDeg: 87.4, altitudeFt: 3480, verticalSpeedFpm: 520, iasKt: 118.6, rollDeg: 0 }
const none: ApAvailability = { gps: false, nav: false, loc: false, gs: false }
const engaged = () => pressAp(makeApPanel(), snap).panel

describe('autopilot engagement', () => {
  it('engages wings level / pitch hold and syncs only the selections the pilot has not set', () => {
    const r = pressAp(makeApPanel(), snap)
    expect(r.panel).toMatchObject({ master: true, lateral: 'ROL', vertical: 'PIT' })
    expect(r.panel.sel).toMatchObject({ headingDeg: 87, iasKt: 119, altitudeFt: 3500 })
    expect(r.message).toBe('AUTOPILOT ENGAGED')
    let p = turnKnob(makeApPanel(), 'altitude', 20, snap) // pilot dialled 5,500 first
    p = pressAp(p, snap).panel
    expect(p.sel.altitudeFt).toBe(defaultSelectedAltitude(3480) + 2000)
  })
  it('pressing AP again, or an envelope disconnect, drops every mode', () => {
    let p = pressHdg(engaged(), snap).panel
    p = pressVs(p, snap).panel
    const off = pressAp(p, snap)
    expect(off.panel).toMatchObject({ master: false, lateral: 'ROL', vertical: 'PIT' }); expect(off.message).toBe('AUTOPILOT OFF')
    expect(disconnectAp(p)).toMatchObject({ master: false, lateral: 'ROL', vertical: 'PIT' })
  })
  it('mode buttons are refused until the autopilot is engaged', () => {
    for (const r of [pressHdg(makeApPanel(), snap), pressAlt(makeApPanel(), snap), pressVs(makeApPanel(), snap), pressFlc(makeApPanel(), snap), pressNav(makeApPanel(), { ...none, gps: true }), pressApr(makeApPanel(), snap, { ...none, loc: true })]) {
      expect(r.message).toBe('ENGAGE THE AUTOPILOT FIRST'); expect(r.panel.master).toBe(false)
    }
  })
})

describe('lateral modes', () => {
  it('HDG follows the bug; an untouched bug is the current heading, a set one is kept; pressing again reverts', () => {
    const r = pressHdg(engaged(), { ...snap, headingDeg: 200.2 })
    expect(r.panel.lateral).toBe('HDG')
    let p = turnKnob(engaged(), 'heading', 15, snap)
    p = pressHdg(p, { ...snap, headingDeg: 200 }).panel
    expect(p.sel.headingDeg).toBe(102); expect(p.lateral).toBe('HDG')
    expect(pressHdg(p, snap).panel.lateral).toBe('ROL')
  })
  it('heading knob wraps through north', () => {
    expect(turnKnob(makeApPanel(), 'heading', 20, { ...snap, headingDeg: 350 }).sel.headingDeg).toBe(10)
    expect(turnKnob(makeApPanel(), 'heading', -10, { ...snap, headingDeg: 5 }).sel.headingDeg).toBe(355)
    expect(turnKnob(makeApPanel(), 'heading', 1, { ...snap, headingDeg: 359 }).sel.headingDeg).toBe(360)
  })
  it('NAV and APR need a real source and say so honestly', () => {
    expect(pressNav(engaged(), none).message).toMatch(/NO NAV SOURCE/); expect(pressNav(engaged(), none).panel.lateral).toBe('ROL')
    expect(pressNav(engaged(), { ...none, gps: true }).panel.lateral).toBe('NAV')
    expect(pressNav(engaged(), { ...none, nav: true }).message).toMatch(/VOR/)
    expect(pressApr(engaged(), snap, none).message).toMatch(/NO ILS TUNED/)
    const ok = pressApr(engaged(), snap, { gps: false, nav: true, loc: true, gs: true })
    expect(ok.panel).toMatchObject({ lateral: 'APR', vertical: 'GS' })
    const locOnly = pressApr(engaged(), snap, { gps: false, nav: true, loc: true, gs: false })
    expect(locOnly.panel).toMatchObject({ lateral: 'APR', vertical: 'PIT' }); expect(locOnly.message).toMatch(/LOC ONLY/)
    expect(pressApr(ok.panel, snap, { gps: false, nav: true, loc: true, gs: true }).panel).toMatchObject({ lateral: 'ROL', vertical: 'PIT' })
  })
})

describe('vertical modes and altitude capture', () => {
  it('ALT holds the altitude at the press, independent of the selected altitude', () => {
    let p = turnKnob(engaged(), 'altitude', 30, snap)
    p = pressAlt(p, snap).panel
    const t = toApTargets(p, snap)
    expect(t.verticalMode).toBe('ALT'); expect(t.altitudeBugFt).toBe(3480); expect(p.sel.altitudeFt).toBe(6500)
  })
  it('VS engages at the current rate rounded to 100 and arms the capture when the selected altitude is ahead', () => {
    let p = turnKnob(engaged(), 'altitude', 20, snap) // select 5,500
    p = pressVs(p, snap).panel
    expect(p.sel.vsFpm).toBe(500)
    expect(toApTargets(p, snap)).toMatchObject({ verticalMode: 'ALTS', underlyingVerticalMode: 'VS', vsTargetFpm: 500, altitudeBugFt: p.sel.altitudeFt })
    // descending toward a higher selected altitude: nothing to capture
    const away = turnKnob(p, 'vs', -10)
    expect(toApTargets(away, snap)).toMatchObject({ verticalMode: 'VS' })
    // right up to the capture the arm stays on (the control law decides when)
    expect(toApTargets(p, { ...snap, altitudeFt: p.sel.altitudeFt - 60 }).verticalMode).toBe('ALTS')
    // past it, heading away: nothing to arm
    expect(toApTargets(p, { ...snap, altitudeFt: p.sel.altitudeFt + 60 }).verticalMode).toBe('VS')
  })
  it('FLC engages at the current speed and arms the capture toward the selected altitude, up or down', () => {
    let p = turnKnob(engaged(), 'altitude', -20, snap) // select 1,500
    p = pressFlc(p, snap).panel
    expect(p.sel.iasKt).toBe(119)
    expect(toApTargets(p, snap)).toMatchObject({ verticalMode: 'ALTS', underlyingVerticalMode: 'FLC', iasTargetKt: 119 })
  })
  it('a speed the pilot set is not overwritten when FLC is pressed', () => {
    let p = turnKnob(engaged(), 'ias', 11, snap)
    p = pressFlc(p, snap).panel
    expect(p.sel.iasKt).toBe(130)
  })
  it('after the capture the panel is in ALT hold at the selected altitude, and stays there', () => {
    let p = turnKnob(engaged(), 'altitude', 20, snap)
    p = pressVs(p, snap).panel
    p = turnKnob(p, 'vs', 5)
    const held = applyApFeedback(p, { altsCaptured: true })
    expect(held).toMatchObject({ vertical: 'ALT', altHoldFt: p.sel.altitudeFt })
    expect(toApTargets(held, { ...snap, altitudeFt: held.altHoldFt + 8, verticalSpeedFpm: 0 })).toMatchObject({ verticalMode: 'ALT', altitudeBugFt: held.altHoldFt })
    expect(applyApFeedback(p, { altsCaptured: false })).toBe(p) // nothing captured yet
    expect(applyApFeedback({ ...p, master: false }, { altsCaptured: true }).vertical).toBe('VS') // autopilot off: nothing to hold
  })
  it('knobs clamp; each mode button toggles back to pitch hold', () => {
    expect(turnKnob(makeApPanel(), 'altitude', 9999).sel.altitudeFt).toBe(50_000)
    expect(turnKnob(makeApPanel(), 'altitude', -9999).sel.altitudeFt).toBe(0)
    expect(turnKnob(makeApPanel(), 'vs', 999).sel.vsFpm).toBe(6000)
    expect(turnKnob(makeApPanel(), 'ias', -999).sel.iasKt).toBe(40)
    for (const press of [pressAlt, pressVs, pressFlc]) {
      const on = press(engaged(), snap).panel
      expect(press(on, snap).panel.vertical).toBe('PIT')
    }
  })
  it('default selected altitude is the next 100 ft above', () => {
    expect(defaultSelectedAltitude(3480)).toBe(3500); expect(defaultSelectedAltitude(3500)).toBe(3600); expect(defaultSelectedAltitude(-20)).toBe(0)
  })
})

describe('envelope protection', () => {
  const ok = { rollDeg: 20, pitchDeg: 5, kias: 120, vneKt: 163, stallFraction: 0.05, onGround: false }
  it('is quiet in normal flight', () => { expect(apEnvelopeFault(ok)).toBeNull() })
  it.each([
    ['BANK ANGLE', { rollDeg: -70 }], ['PITCH ATTITUDE', { pitchDeg: 35 }], ['PITCH ATTITUDE', { pitchDeg: -30 }],
    ['STALL', { stallFraction: 0.6 }], ['OVERSPEED', { kias: 170 }], ['ON THE GROUND', { onGround: true }],
  ])('disconnects for %s', (reason, over) => { expect(apEnvelopeFault({ ...ok, ...over })).toBe(reason) })
})
