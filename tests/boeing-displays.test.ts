import { describe, expect, it } from 'vitest'
import { boeingFma, drawBoeingEicas, drawBoeingNd, drawBoeingPfd, drawIsfd, egtFromN1, vsiFraction, type BoeingPfdInput } from '../src/cockpit/boeing-displays'
import { makeRecordingCtx } from './render/canvas-stub'

const pfd: BoeingPfdInput = {
  iasKt: 250, trendKt10s: 5, mach: 0.62, selSpeedKt: 260, vmoKt: 340, stallKt: 130, pitchDeg: 3, rollDeg: 10, slipDeg: 1,
  fd: { pitchDeg: 4, bankDeg: 12 }, altFt: 12340, selAltFt: 15000, baroInHg: 29.92, vsFpm: 1500, hdgDeg: 270, selHdgDeg: 280, trackDeg: 268,
  radioAltFt: 9000, onGround: false, loc: 0.5, gs: -0.3,
  fma: { at: '', roll: 'HDG SEL', rollArmed: '', pitch: 'V/S', pitchArmed: '', ap: 'CMD' },
}

describe('Boeing display logic', () => {
  it('VSI is non-linear: 1000 fpm = half throw, 6000 = full, monotonic, odd', () => {
    expect(vsiFraction(1000)).toBeCloseTo(0.5)
    expect(vsiFraction(2000)).toBeCloseTo(0.75)
    expect(vsiFraction(6000)).toBeCloseTo(1)
    expect(vsiFraction(9000)).toBeCloseTo(1)
    expect(vsiFraction(-1500)).toBeCloseTo(-vsiFraction(1500))
    let prev = -2
    for (let v = -7000; v <= 7000; v += 250) { const f = vsiFraction(v); expect(f).toBeGreaterThanOrEqual(prev); prev = f }
  })
  it('maps autopilot modes to 737 FMA words', () => {
    const base = { master: true, fdOn: true, lateralArmed: false, verticalArmed: false, speedMode: false, onGround: false }
    expect(boeingFma({ ...base, lateral: 'HDG', vertical: 'ALT' })).toMatchObject({ roll: 'HDG SEL', pitch: 'ALT HOLD', ap: 'CMD' })
    expect(boeingFma({ ...base, lateral: 'APR', lateralArmed: true, vertical: 'GS', verticalArmed: true })).toMatchObject({ rollArmed: 'VOR/LOC', pitchArmed: 'G/S' })
    // autoland: LAND ARM → LAND (the flare is not shown) → ROLLOUT (roll box)
    const al = { ...base, lateral: 'APR', vertical: 'GS' }
    expect(boeingFma({ ...al, autoland: 'ARMED' }).land).toBe('LAND ARM')
    expect(boeingFma({ ...al, autoland: 'LAND' })).toMatchObject({ land: 'LAND', roll: 'VOR/LOC', pitch: 'G/S' })
    expect(boeingFma({ ...al, autoland: 'FLARE' })).toMatchObject({ land: 'LAND', pitch: 'G/S', at: 'RETARD' })
    expect(boeingFma({ ...al, autoland: 'ROLLOUT' })).toMatchObject({ roll: 'ROLLOUT', pitch: '' })
    expect(boeingFma({ ...al }).land).toBe('')
    expect(boeingFma({ ...base, master: false, fdOn: true, lateral: 'HDG', vertical: 'VS' })).toMatchObject({ ap: 'FD', pitch: 'V/S' })
    expect(boeingFma({ ...base, master: false, fdOn: false, lateral: 'ROL', vertical: 'PIT' })).toMatchObject({ roll: '', pitch: '', ap: '' })
    expect(boeingFma({ ...base, lateral: 'HDG', vertical: 'FLC', atMode: 'N1' })).toMatchObject({ at: 'N1', pitch: 'MCP SPD' })
    expect(boeingFma({ ...base, lateral: 'HDG', vertical: 'ALT', atMode: 'OFF' }).at).toBe('')
  })
  it('EGT proxy rises with N1 through CFM56-class idle/takeoff values', () => {
    expect(egtFromN1(21, 15)).toBeGreaterThan(330); expect(egtFromN1(21, 15)).toBeLessThan(500)
    expect(egtFromN1(100, 15)).toBeGreaterThan(820); expect(egtFromN1(100, 15)).toBeLessThan(950)
    expect(egtFromN1(60, 15)).toBeGreaterThan(egtFromN1(40, 15))
    expect(egtFromN1(0, 20)).toBe(20)
  })
  it('PFD draws the selected speed/altitude in magenta and FMA in green', () => {
    const c = makeRecordingCtx()
    drawBoeingPfd(c, 768, pfd)
    expect(c.texts.some(t => t.text === '260' && t.color === '#ff4fe0')).toBe(true)
    expect(c.texts.some(t => t.text === '15000' && t.color === '#ff4fe0')).toBe(true)
    expect(c.texts.find(t => t.text === 'HDG SEL')?.color).toBe('#3fe06a')
    expect(c.texts.find(t => t.text === 'CMD')?.color).toBe('#3fe06a')
    expect(c.texts.some(t => t.text === '.620')).toBe(true)
    expect(c.texts.some(t => t.text === 'STD')).toBe(true)
  })
  it('PFD omits the radio altitude above 2500 ft and ILS dots when not tuned', () => {
    const c = makeRecordingCtx()
    drawBoeingPfd(c, 768, { ...pfd, radioAltFt: 1200, loc: undefined, gs: undefined })
    expect(c.texts.some(t => t.text === '1200')).toBe(true)
    const d = makeRecordingCtx()
    drawBoeingPfd(d, 768, pfd)
    expect(d.texts.some(t => t.text === '9000')).toBe(false)
  })
  it('ND, engine display and ISFD draw from their inputs', () => {
    const nd = makeRecordingCtx()
    drawBoeingNd(nd, 768, { hdgDeg: 90, trackDeg: 92, selHdgDeg: 100, gsKt: 300, tasKt: 320, windDirDeg: 270, windKt: 25, rangeNm: 40, airports: [{ id: 'KSFO', nN: 5, nE: 10 }], route: [{ id: 'ALPHA', nN: 1, nE: 5, active: false }, { id: 'BRAVO', nN: 2, nE: 20, active: true }], activeWpt: { id: 'BRAVO', distNm: 19.6, etaZ: '1234.5' }, traffic: [], wx: [] })
    expect(nd.texts.find(t => t.text === 'BRAVO')?.color).toBe('#ff4fe0')
    expect(nd.texts.some(t => t.text === 'KSFO')).toBe(true)
    expect(nd.texts.some(t => t.text === '19.6 NM')).toBe(true)
    const e = makeRecordingCtx()
    drawBoeingEicas(e, 768, { n1Pct: [85.2, 85.2], n1RedlinePct: 104, n1CommandPct: 86, egtC: [760, 760], ffKgH: [1200, 1200], fuelKg: [4000, 3900], tatC: -5, reverse: false })
    expect(e.texts.some(t => t.text === '85.2')).toBe(true)
    expect(e.texts.some(t => t.text === 'TOTAL 7900 KG')).toBe(true)
    drawIsfd(makeRecordingCtx(), 256, { iasKt: 250, altFt: 12340, pitchDeg: 2, rollDeg: 5, baroInHg: 29.92 })
  })
})
