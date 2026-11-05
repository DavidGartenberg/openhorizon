import { describe, expect, it } from 'vitest'
import { AOA_BANDS, aoaFraction, compassLabel, dialFraction, drawOverlay, overlayScale, tapeOffset, vsTapeFraction, type OverlayState } from '../src/ui/instrument-overlay'
import { makeRecordingCtx } from './render/canvas-stub'

const base: OverlayState = {
  headingDeg: 324, headingBugDeg: 360, iasKt: 221, tasKt: 236, groundSpeedKt: 230, altitudeFt: 3850, baroInHg: 29.78, verticalSpeedFpm: -3060,
  engines: [{ lever: 23, value: 38, redline: 104 }, { lever: 23, value: 38, redline: 104 }], fuelPct: 50, aoaDeg: 2, aoaStallDeg: 14,
  flapsFrac: 0, flapsDeg: 0, trim: 0.15, greenLowKt: 90, greenHighKt: 250, yellowHighKt: 340,
}
const texts = (st: Partial<OverlayState>): string[] => { const c = makeRecordingCtx(); drawOverlay(c, 1280, 720, { ...base, ...st }); return c.texts.map(t => t.text) }

describe('instrument overlay layout helpers', () => {
  it('compass labels: cardinals, then tens', () => {
    expect([0, 30, 60, 90, 120, 180, 270, 330].map(compassLabel)).toEqual(['N', '3', '6', 'E', '12', 'S', 'W', '33'])
    expect(compassLabel(-30)).toBe('33'); expect(compassLabel(362)).toBe('N')
  })
  it('tape offset puts higher values above the centre', () => {
    expect(tapeOffset(230, 221, 10)).toBeCloseTo(-0.9); expect(tapeOffset(210, 221, 10)).toBeCloseTo(1.1); expect(tapeOffset(221, 221, 10)).toBe(0)
  })
  it('dial fraction clamps; AOA marker rises toward stall; bands run green to red', () => {
    expect(dialFraction(55)).toBeCloseTo(0.5); expect(dialFraction(-3)).toBe(0); expect(dialFraction(500)).toBe(1)
    expect(aoaFraction(2, 14)).toBeLessThan(aoaFraction(10, 14)); expect(aoaFraction(99, 14)).toBe(1); expect(aoaFraction(-99, 14)).toBe(0)
    expect(AOA_BANDS[0].color).toBe('#2fc05a'); expect(AOA_BANDS[3].color).toBe('#e5483b'); expect(AOA_BANDS[3].to).toBe(1)
  })
  it('VS tape is non-linear and odd', () => {
    expect(vsTapeFraction(1000)).toBeCloseTo(0.5); expect(vsTapeFraction(-6000)).toBeCloseTo(-1); expect(vsTapeFraction(-3060)).toBeLessThan(vsTapeFraction(-1000))
  })
  it('scale follows the viewport within limits', () => {
    expect(overlayScale(1280, 720)).toBe(1); expect(overlayScale(320, 200)).toBe(0.55); expect(overlayScale(5120, 2880)).toBe(1.5)
  })
})

describe('instrument overlay content', () => {
  it('shows every instrument from real state', () => {
    const t = texts({})
    for (const must of ['324°', 'AIRSPEED', '221', 'TAS 236KT', 'ENGINE #1', 'ENGINE #2', 'FUEL', '50%', 'AOA', 'ALTITUDE', '3850', '29.78 IN', 'VS', '-3060', 'FLAPS', 'TRIM']) expect(t, must).toContain(must)
    expect(t).toContain('--- KTS'); expect(t).toContain('----') // nothing selected → dashes
  })
  it('selected speed and altitude replace the dashes when the autopilot provides them', () => {
    const t = texts({ selSpeedKt: 250, selAltFt: 5000 })
    expect(t).toContain('250 KTS'); expect(t).toContain('5000'); expect(t).not.toContain('--- KTS')
  })
  it('instruments the airplane lacks are not drawn', () => {
    const glider = texts({ engines: [], fuelPct: undefined, flapsFrac: undefined, trim: undefined })
    for (const gone of ['ENGINE #1', 'FUEL', 'FLAPS', 'TRIM']) expect(glider, gone).not.toContain(gone)
    expect(texts({}).includes('CRS')).toBe(false) // no nav tuned → no course pointer
    expect(texts({ courseDeg: 3 })).toContain('CRS')
  })
  it('alerts and first-officer callouts show as banners; four engines get four dials', () => {
    const t = texts({ alert: 'PULL UP', alertRed: true, callout: 'positive rate', engines: Array.from({ length: 4 }, () => ({ lever: 50, value: 60, redline: 104 })) })
    expect(t).toContain('PULL UP'); expect(t).toContain('First officer: positive rate'); expect(t).toContain('ENGINE #4')
  })
})
