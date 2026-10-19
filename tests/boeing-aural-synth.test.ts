import {describe,expect,it} from 'vitest'
import {synthAltitudeAlert,synthClacker,synthFireBell,synthIntermittentHorn,synthStickShaker,synthSteadyHorn,synthWailer} from '../src/audio/boeing-aural-synth'
import {dominantAural} from '../src/audio/boeing-aurals-audio'

const SR = 48000
const loops = {synthWailer,synthSteadyHorn,synthIntermittentHorn,synthClacker,synthStickShaker,synthFireBell}

/** Zero-crossing rate ≈ 2 × dominant frequency for a tonal signal. */
function zcrHz(x: Float32Array, from = 0, to = x.length): number {
  let n = 0
  for (let i = from + 1; i < to; i++) if ((x[i - 1]! < 0) !== (x[i]! < 0)) n++
  return n / 2 / ((to - from) / SR)
}
/** Envelope onsets: rising crossings of a fraction of the peak. */
function onsets(x: Float32Array, frac = 0.5, holdS = 0.03): number {
  let peak = 0; for (const v of x) peak = Math.max(peak, Math.abs(v))
  let n = 0, last = -Infinity
  for (let i = 0; i < x.length; i++) if (Math.abs(x[i]!) > peak * frac && i - last > holdS * SR) { n++; last = i }
  return n
}

describe('737NG aural synthesis', () => {
  it.each(Object.entries(loops))('%s is finite, bounded, non-silent and loops without a click', (_n, fn) => {
    const x = fn(SR)
    expect(x.length).toBeGreaterThan(SR * 0.2)
    let peak = 0, maxStep = 0
    for (let i = 0; i < x.length; i++) { expect(Number.isFinite(x[i]!)).toBe(true); peak = Math.max(peak, Math.abs(x[i]!)); if (i) maxStep = Math.max(maxStep, Math.abs(x[i]! - x[i - 1]!)) }
    expect(peak).toBeLessThanOrEqual(1); expect(peak).toBeGreaterThan(0.3)
    // the wrap (last → first sample) must be no bigger a jump than the signal's own steps
    expect(Math.abs(x[0]! - x[x.length - 1]!)).toBeLessThanOrEqual(maxStep * 1.5 + 1e-3)
  })
  it('wailer sweeps between ~1.0 and ~1.5 kHz', () => {
    const x = synthWailer(SR), q = Math.round(x.length / 8)
    const low = zcrHz(x, 0, q), high = zcrHz(x, Math.round(x.length / 2) - q / 2, Math.round(x.length / 2) + q / 2)
    expect(low).toBeGreaterThan(900); expect(low).toBeLessThan(1200)
    expect(high).toBeGreaterThan(1350); expect(high).toBeLessThan(1650)
  })
  it('intermittent horn is keyed on/off at 2 Hz; the steady horn never drops out', () => {
    const ih = synthIntermittentHorn(SR), half = ih.length / 2
    let onE = 0, offE = 0
    for (let i = 0; i < ih.length; i++) (i < half ? (onE += ih[i]! ** 2) : (offE += ih[i]! ** 2))
    expect(offE).toBeLessThan(onE * 1e-6)
    const sh = synthSteadyHorn(SR), win = SR * 0.05
    for (let s = 0; s + win <= sh.length; s += win) { let e = 0; for (let i = s; i < s + win; i++) e += sh[i]! ** 2; expect(e / win).toBeGreaterThan(0.02) }
  })
  it('clacker strikes ≈ 12 times a second; shaker rattles ≈ 22 Hz', () => {
    const c = synthClacker(SR)
    expect(onsets(c, 0.5, 0.04) / (c.length / SR)).toBeCloseTo(12, 0)
    const s = synthStickShaker(SR)
    expect(onsets(s, 0.6, 0.025)).toBeGreaterThanOrEqual(20)
    expect(onsets(s, 0.6, 0.025)).toBeLessThanOrEqual(23)
  })
  it('altitude alert is a single decaying chime', () => {
    const a = synthAltitudeAlert(SR)
    let first = 0, last = 0; const w = SR * 0.1
    for (let i = 0; i < w; i++) { first += a[i]! ** 2; last += a[a.length - 1 - i]! ** 2 }
    expect(last).toBeLessThan(first * 0.05)
  })
  it('only the most urgent continuous aural sounds', () => {
    expect(dominantAural(new Set(['apWailer','stickShaker']))).toBe('stickShaker')
    expect(dominantAural(new Set(['gearHorn','fireBell','clacker']))).toBe('fireBell')
    expect(dominantAural(new Set())).toBeUndefined()
  })
})
