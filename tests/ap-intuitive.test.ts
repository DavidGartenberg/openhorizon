import { describe, expect, it } from 'vitest'
import {
  engageThen, goToAltitudeLabel, makeApPanel, parseKnobText, pressAlt, pressAp, pressApr, pressGoToAltitude, pressHdg, pressNav,
  setKnobValue, syncBugs, turnKnob, unavailableReasons,
  type ApAvailability, type ApSnapshot,
} from '../src/sim/ap-panel'

const snap: ApSnapshot = { headingDeg: 87.4, altitudeFt: 3480, verticalSpeedFpm: 0, iasKt: 118.6, rollDeg: 0 }
const none: ApAvailability = { gps: false, nav: false, loc: false, gs: false }
const engaged = () => pressAp(makeApPanel(), snap).panel

describe('engage-then-press: a mode button engages the autopilot for you', () => {
  it('HDG with the autopilot off engages it and selects the mode in one press', () => {
    const r = engageThen(makeApPanel(), snap, (p) => pressHdg(p, snap))
    expect(r.panel).toMatchObject({ master: true, lateral: 'HDG' })
    expect(r.message).toMatch(/AUTOPILOT ENGAGED/); expect(r.message).toMatch(/HDG 087/)
  })
  it('does nothing extra when the autopilot is already on', () => {
    const r = engageThen(engaged(), snap, (p) => pressAlt(p, snap))
    expect(r.panel.vertical).toBe('ALT'); expect(r.message).not.toMatch(/ENGAGED/)
  })
  it('does NOT engage the autopilot when the mode itself cannot work (no nav source, no ILS)', () => {
    const nav = engageThen(makeApPanel(), snap, (p) => pressNav(p, none))
    expect(nav.panel.master).toBe(false); expect(nav.message).toMatch(/NO NAV SOURCE/)
    const apr = engageThen(makeApPanel(), snap, (p) => pressApr(p, snap, none))
    expect(apr.panel.master).toBe(false); expect(apr.message).toMatch(/NO ILS/)
  })
  it('engages for NAV when a source exists', () => {
    const r = engageThen(makeApPanel(), snap, (p) => pressNav(p, { ...none, gps: true }))
    expect(r.panel).toMatchObject({ master: true, lateral: 'NAV' })
  })
})

describe('typed values', () => {
  it('parses what pilots type', () => {
    expect(parseKnobText('altitude', '8000')).toBe(8000)
    expect(parseKnobText('altitude', '8,500 ft')).toBe(8500)
    expect(parseKnobText('altitude', 'FL350')).toBe(35000)
    expect(parseKnobText('altitude', 'fl 240')).toBe(24000)
    expect(parseKnobText('heading', '270°')).toBe(270)
    expect(parseKnobText('heading', 'hdg 090')).toBe(90)
    expect(parseKnobText('ias', '210 kt')).toBe(210)
    expect(parseKnobText('vs', '-1500')).toBe(-1500)
    expect(parseKnobText('vs', '+700')).toBe(700)
    expect(parseKnobText('vs', 'down 1000')).toBe(-1000)
    expect(parseKnobText('altitude', 'abc')).toBeNull()
    expect(parseKnobText('altitude', '')).toBeNull()
  })
  it('sets, clamps and wraps; marks the selection as the pilot\'s own', () => {
    let p = setKnobValue(engaged(), 'altitude', 8000, snap); expect(p.sel.altitudeFt).toBe(8000); expect(p.touched.altitude).toBe(true)
    p = setKnobValue(p, 'altitude', 99999, snap); expect(p.sel.altitudeFt).toBe(50000)
    p = setKnobValue(p, 'altitude', -50, snap); expect(p.sel.altitudeFt).toBe(0)
    p = setKnobValue(p, 'heading', 0, snap); expect(p.sel.headingDeg).toBe(360)
    p = setKnobValue(p, 'heading', 370, snap); expect(p.sel.headingDeg).toBe(10)
    p = setKnobValue(p, 'ias', 5, snap); expect(p.sel.iasKt).toBe(40)
    p = setKnobValue(p, 'ias', 900, snap); expect(p.sel.iasKt).toBe(600)
    p = setKnobValue(p, 'vs', 99999, snap); expect(p.sel.vsFpm).toBe(6000)
    p = setKnobValue(p, 'vs', -1520, snap); expect(p.sel.vsFpm).toBe(-1500)
    expect(p.touched).toMatchObject({ heading: true, altitude: true, ias: true })
  })
  it('rounds altitude to the knob\'s 100 ft and ignores non-finite input', () => {
    expect(setKnobValue(engaged(), 'altitude', 8040, snap).sel.altitudeFt).toBe(8000)
    expect(setKnobValue(engaged(), 'altitude', 8060, snap).sel.altitudeFt).toBe(8100)
    const p = engaged()
    expect(setKnobValue(p, 'altitude', NaN, snap)).toEqual(p)
  })
})

describe('go to the selected altitude (CLIMB / DESCEND / HOLD)', () => {
  it('labels itself by what it will do', () => {
    const dial = (alt: number) => setKnobValue(engaged(), 'altitude', alt, snap)
    expect(goToAltitudeLabel(dial(8000), snap)).toBe('CLIMB TO 8,000')
    expect(goToAltitudeLabel(dial(2000), snap)).toBe('DESCEND TO 2,000')
    expect(goToAltitudeLabel(dial(3500), snap)).toBe('HOLD 3,500')
    expect(goToAltitudeLabel(engaged(), snap)).toBe('HOLD 3,480') // nothing dialled: level off here
  })
  it('climbs at a sensible rate by distance, capped to what the airplane can do', () => {
    const dial = (alt: number) => setKnobValue(engaged(), 'altitude', alt, snap)
    expect(pressGoToAltitude(dial(8000), snap).panel).toMatchObject({ vertical: 'VS', sel: { vsFpm: 1500 } })
    expect(pressGoToAltitude(dial(4200), snap).panel.sel.vsFpm).toBe(1000)
    expect(pressGoToAltitude(dial(3800), snap).panel.sel.vsFpm).toBe(500)
    // a light single cannot climb 1,500 fpm
    expect(pressGoToAltitude(dial(8000), snap, { climbFpm: 500, descendFpm: 500 }).panel.sel.vsFpm).toBe(500)
    expect(pressGoToAltitude(dial(8000), snap, { climbFpm: 2000, descendFpm: 2000 }).panel.sel.vsFpm).toBe(1500) // still gentle
  })
  it('descends with a negative rate', () => {
    const r = pressGoToAltitude(setKnobValue(engaged(), 'altitude', 1000, snap), snap)
    expect(r.panel).toMatchObject({ vertical: 'VS', sel: { vsFpm: -1500 } })
    expect(r.message).toBe('DESCEND TO 1,000 FT AT 1,500 FPM')
  })
  it('within 100 ft of the target, or with nothing dialled, it holds altitude instead', () => {
    const near = pressGoToAltitude(setKnobValue(engaged(), 'altitude', 3500, snap), snap)
    expect(near.panel).toMatchObject({ vertical: 'ALT' }); expect(near.message).toBe('HOLDING 3,500 FT')
    const none_ = pressGoToAltitude(engaged(), snap)
    expect(none_.panel).toMatchObject({ vertical: 'ALT' }); expect(none_.panel.altHoldFt).toBe(3480)
    expect(none_.message).toMatch(/HOLDING 3,480 FT/); expect(none_.message).toMatch(/DIAL/i)
  })
  it('leaves the lateral mode alone', () => {
    const p = pressHdg(setKnobValue(engaged(), 'altitude', 8000, snap), snap).panel
    expect(pressGoToAltitude(p, snap).panel.lateral).toBe('HDG')
  })
})

describe('sync bugs to the present', () => {
  it('sets heading, altitude and speed to the airplane and un-pins them', () => {
    let p = setKnobValue(setKnobValue(setKnobValue(engaged(), 'altitude', 9000, snap), 'heading', 200, snap), 'ias', 250, snap)
    const r = syncBugs(p, { ...snap, headingDeg: 134.2, altitudeFt: 5120, iasKt: 140.4 })
    expect(r.panel.sel).toMatchObject({ headingDeg: 134, altitudeFt: 5200, iasKt: 140 })
    expect(r.panel.touched).toEqual({ heading: false, altitude: false, ias: false })
    expect(r.message).toMatch(/HDG 134/); expect(r.message).toMatch(/5,200/); expect(r.message).toMatch(/140/)
    p = r.panel; expect(p.master).toBe(true)
  })
})

describe('why a button will not work', () => {
  it('says what to do, only for what is unavailable', () => {
    const r = unavailableReasons(none, { hasAutoland: true })
    expect(r.nav).toMatch(/flight plan|VOR/i); expect(r.apr).toMatch(/ILS/i); expect(r.land).toMatch(/ILS/i)
    const ok = unavailableReasons({ gps: true, nav: false, loc: true, gs: true }, { hasAutoland: true })
    expect(ok).toEqual({})
    expect(unavailableReasons({ ...none, loc: true }, { hasAutoland: true }).land).toMatch(/glideslope/i)
    expect(unavailableReasons({ gps: false, nav: true, loc: true, gs: true }, { hasAutoland: false }).land).toMatch(/not available/i)
  })
})

describe('knob steps unchanged', () => {
  it('altitude still moves 100 ft per detent', () => {
    expect(turnKnob(engaged(), 'altitude', 3, snap).sel.altitudeFt).toBe(3500 + 300)
  })
})
