import { describe, expect, it } from 'vitest'
import { alertColor, drawBoeingEngineColumn, drawGaBoeingNd, drawGaBoeingPfd, type GaEngineInput, type GaPfdExtras } from '../src/cockpit/boeing-ga-displays'
import { drawBoeingNd, drawBoeingPfd, type BoeingNdInput, type BoeingPfdInput } from '../src/cockpit/boeing-displays'
import { drawMfd, type MfdInput } from '../src/cockpit/mfd'
import { makeRecordingCtx } from './render/canvas-stub'

const pfd: BoeingPfdInput = {
  iasKt: 95, trendKt10s: 0, mach: 0.15, selSpeedKt: 100, vmoKt: 163, stallKt: 48, pitchDeg: 2, rollDeg: -3, slipDeg: 0,
  altFt: 4500, selAltFt: 5000, baroInHg: 29.92, vsFpm: 0, hdgDeg: 90, selHdgDeg: 90, trackDeg: 90, radioAltFt: null, onGround: false,
  vArcs: { whiteLow: 40, whiteHigh: 85, greenLow: 48, greenHigh: 129, yellowLow: 129, yellowHigh: 163 },
  fma: { at: '', roll: '', rollArmed: '', pitch: '', pitchArmed: '', ap: '' },
}
const extras: GaPfdExtras = { com1: { activeMhz: 118.0, standbyMhz: 121.5 }, nav1: { activeMhz: 109.55, standbyMhz: 115.8 }, squawk: '1200', oatC: 12, ktas: 101, groundSpeedKt: 95, windDirDeg: 270, windKt: 8, alerts: ['FUEL LOW', 'AVIONICS BUS OFF'] }
const engine: GaEngineInput = { hasEngine: true, rpm: 2300, redlineRpm: 2700, egtC: 640, chtC: 190, chtMaxC: 260, oilTempC: 85, oilTempMaxC: 120, oilPressPsi: 62, oilPressMaxPsi: 100, oilPressMinGreenPsi: 30, fuelFlowGph: 9.2, fuelLGal: 20, fuelRGal: 18, tankCapGal: 26.5, volts: 27.8, ampsAlt: 12, ampsBat: -2 }

describe('Boeing PFD on a GA airplane', () => {
  it('never draws a radio altimeter that is not fitted', () => {
    const none = makeRecordingCtx()
    drawBoeingPfd(none, 768, { ...pfd, radioAltFt: null })
    expect(none.texts.some(t => t.text === '640')).toBe(false)
    const fitted = makeRecordingCtx()
    drawBoeingPfd(fitted, 768, { ...pfd, radioAltFt: 640 })
    expect(fitted.texts.some(t => t.text === '640')).toBe(true)
  })
  it('colours the V-speed arcs along the tape (white / green / amber)', () => {
    const c = makeRecordingCtx()
    drawBoeingPfd(c, 768, pfd)
    for (const col of ['#ffffff', '#3fe06a', '#ffb020']) expect(c.fills.includes(col), col).toBe(true)
    const none = makeRecordingCtx()
    drawBoeingPfd(none, 768, { ...pfd, vArcs: undefined })
    expect(none.calls.filter(x => x.fn === 'fillRect').length).toBeLessThan(c.calls.filter(x => x.fn === 'fillRect').length)
  })
  it('keeps radios, transponder, air data and alerts on screen in the margins of the 4:3 canvas', () => {
    const c = makeRecordingCtx()
    drawGaBoeingPfd(c, 1024, 768, pfd, extras)
    const t = c.texts.map(x => x.text)
    for (const must of ['COM1', '118.000', '121.500', 'NAV1', '109.55', '115.80', 'XPDR', '1200', 'OAT', '12°C', 'TAS', '101', 'GS', '95', 'WIND', '270°/8']) expect(t, must).toContain(must)
    expect(t.join(' ')).toMatch(/FUEL/); expect(t.join(' ')).toMatch(/AVIONICS/)
    expect(c.texts.find(x => x.text === 'FUEL LOW')?.color).toBe('#ffb020')
  })
  it('warnings that mean loss of function or fuel starvation are red', () => {
    expect(alertColor('FUEL STARV')).toBe('#ff2b2b'); expect(alertColor('ALTERNATOR FAIL')).toBe('#ff2b2b'); expect(alertColor('AVIONICS BUS OFF')).toBe('#ff2b2b')
    expect(alertColor('FUEL LOW')).toBe('#ffb020')
  })
  it('a canvas too narrow for margins still draws the PFD without throwing', () => {
    expect(() => drawGaBoeingPfd(makeRecordingCtx(), 768, 768, pfd, extras)).not.toThrow()
  })
})

describe('Boeing engine strip for piston / turboprop / glider', () => {
  it('reads every engine value the G1000 strip showed, and colours cautions', () => {
    const c = makeRecordingCtx()
    drawBoeingEngineColumn(c, 0, 0, 205, 700, engine)
    const t = c.texts.map(x => x.text)
    for (const must of ['RPM', '2300', 'EGT °C', '640', 'CHT °C', '190', 'OIL °C', '85', 'OIL PSI', '62', 'FF GPH', '9.2', 'FUEL L', '20.0', 'FUEL R', '18.0']) expect(t, must).toContain(must)
    const low = makeRecordingCtx()
    drawBoeingEngineColumn(low, 0, 0, 205, 700, { ...engine, oilPressPsi: 12, chtC: 250, rpm: 2750 })
    expect(low.texts.find(x => x.text === '12')?.color).toBe('#ffb020')
    expect(low.texts.find(x => x.text === '250')?.color).toBe('#ffb020')
    expect(low.texts.find(x => x.text === '2750')?.color).toBe('#ff2b2b')
  })
  it('a turboprop shows prop speed and torque, never piston CHT or mixture EGT', () => {
    const c = makeRecordingCtx()
    drawBoeingEngineColumn(c, 0, 0, 205, 700, { ...engine, kind: 'turboprop', torquePct: 72 })
    const t = c.texts.map(x => x.text)
    expect(t).toContain('NP  RPM'); expect(t).toContain('TRQ %'); expect(t).toContain('72')
    expect(t).not.toContain('CHT °C'); expect(t).not.toContain('EGT °C')
  })
  it('a twin shows one RPM box per engine; a hand-propped airplane shows no bus readouts', () => {
    const c = makeRecordingCtx()
    drawBoeingEngineColumn(c, 0, 0, 205, 700, { ...engine, engines: 2 })
    expect(c.texts.filter(x => x.text === '2300')).toHaveLength(2)
    const cub = makeRecordingCtx()
    drawBoeingEngineColumn(cub, 0, 0, 205, 700, { ...engine, hasElectrical: false })
    expect(cub.texts.map(x => x.text)).toContain('NO ELECTRICAL SYSTEM')
    expect(cub.texts.some(x => x.text.startsWith('VOLTS'))).toBe(false)
  })
  it('a glider shows NO ENGINE, not invented gauges', () => {
    const c = makeRecordingCtx()
    drawBoeingEngineColumn(c, 0, 0, 205, 700, { ...engine, hasEngine: false })
    expect(c.texts.map(x => x.text)).toEqual(['NO ENGINE'])
  })
})

describe('Boeing ND on the GA MFD', () => {
  const nd: BoeingNdInput = {
    hdgDeg: 90, trackDeg: 90, selHdgDeg: 90, gsKt: 95, tasKt: 101, windDirDeg: 270, windKt: 8, rangeNm: 20,
    airports: [{ id: 'KSFO', nN: 2, nE: 6 }], route: [], traffic: [], wx: [],
    airspace: [{ ring: [{ nN: 3, nE: 3 }, { nN: 3, nE: 9 }, { nN: -3, nE: 9 }, { nN: -3, nE: 3 }], color: '#3a7bd5', dash: [], label: '25/SFC' }],
    glideRingNm: 6,
  }
  it('draws airspace outlines with the Class D floor/ceiling tag and the glide ring', () => {
    const c = makeRecordingCtx()
    drawBoeingNd(c, 768, nd)
    expect(c.texts.some(t => t.text === '25/SFC' && t.color === '#3a7bd5')).toBe(true)
    expect(c.calls.some(x => x.fn === 'arc' && Math.abs((x.args[2] as number) - 6 * (560 / 20)) < 1e-6)).toBe(true)
    const plain = makeRecordingCtx()
    drawBoeingNd(plain, 768, { ...nd, airspace: undefined, glideRingNm: undefined })
    expect(plain.texts.some(t => t.text === '25/SFC')).toBe(false)
  })
  it('fits the square ND inside a wide MFD page rectangle', () => {
    expect(() => drawGaBoeingNd(makeRecordingCtx(), 205, 0, 819, 700, nd)).not.toThrow()
  })
  it('the MFD softkey row and page logic survive the skin: skin draws MAP + strip, other pages stay', () => {
    const calls: string[] = []
    const skin = { eis: () => { calls.push('eis') }, map: () => { calls.push('map') } }
    const base = { page: 'map', rpm: 0, fuelFlowGph: 0, mixture: 1, engineTemps: { oilTempC: 0, oilPressPsi: 0, chtC: 0 }, fuelLeftKg: 0, fuelRightKg: 0, electrical: { busVoltage: 0, alternatorAmps: 0, batteryAmps: 0 } } as unknown as MfdInput
    const c = makeRecordingCtx()
    drawMfd(c, 1024, 768, { ...base, skin })
    expect(calls).toEqual(['eis', 'map'])
    expect(c.texts.map(t => t.text)).toContain('ENGINE') // softkey labels still painted by the MFD itself
    calls.length = 0
    drawMfd(makeRecordingCtx(), 1024, 768, { ...base, page: 'lean', skin })
    expect(calls).toEqual(['eis']) // lean page is the MFD's own
  })
})
