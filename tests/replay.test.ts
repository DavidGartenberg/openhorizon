/**
 * Replay plot builder (16d) — pure. Consumes the recorder's 10 Hz
 * samples (never live state) and produces the debrief plots: a
 * plan-view track relative to the final sample, a distance/altitude
 * profile, and the touchdown index (last airborne→ground transition).
 */
import { describe, expect, it } from 'vitest'
import { buildReplayPlots } from '../src/sim/replay'
import type { FlightSample } from '../src/sim/recorder'

/** Straight-in northbound: 100 kt, −500 fpm to touchdown, then rollout. */
function approach(): FlightSample[] {
  const out: FlightSample[] = []
  const mLat = 111_320
  let alt = 1000
  let lat = 37.0
  for (let t = 0; t < 180; t += 0.1) {
    const gnd = alt <= 13
    if (!gnd) alt = Math.max(13, alt - (500 / 60) * 0.1)
    const gsMs = gnd ? Math.max(2, 51 - (t - 118) * 2) : 51.4 // decelerating rollout
    lat += (gsMs * 0.1) / mLat
    out.push({
      t, lat, lon: -122, altFt: alt, iasKt: gnd ? gsMs / 0.5144 : 100,
      vsFpm: gnd ? 0 : -500, headingDeg: 0, pitchDeg: 2, rollDeg: 0,
      aglFt: alt - 13, onGround: gnd,
    })
  }
  return out
}

describe('buildReplayPlots', () => {
  it('produces a monotonic distance profile ending at the last sample', () => {
    const p = buildReplayPlots(approach(), 300)
    expect(p.profile.length).toBeGreaterThan(100)
    for (let i = 1; i < p.profile.length; i++) {
      expect(p.profile[i]!.distM).toBeGreaterThanOrEqual(p.profile[i - 1]!.distM)
    }
    expect(p.totalDistM).toBeGreaterThan(5000)
  })

  it('marks touchdown at the airborne→ground transition', () => {
    const samples = approach()
    const p = buildReplayPlots(samples, 300)
    expect(p.touchdownIdx).not.toBeNull()
    const i = p.touchdownIdx!
    expect(p.plan[i]!.aglFt).toBeLessThan(5)
    expect(p.profile[i - 1]!.onGround).toBe(false)
    expect(p.profile[i]!.onGround).toBe(true)
  })

  it('plan view is relative to the final sample (rollout ends at origin)', () => {
    const p = buildReplayPlots(approach(), 300)
    const last = p.plan[p.plan.length - 1]!
    expect(Math.abs(last.e)).toBeLessThan(1)
    expect(Math.abs(last.n)).toBeLessThan(1)
    // Northbound approach: early samples sit well SOUTH of the end.
    expect(p.plan[0]!.n).toBeLessThan(-5000)
  })

  it('trims to the requested window', () => {
    const p = buildReplayPlots(approach(), 60)
    expect(p.profile[0]!.distM).toBe(0)
    expect(p.profile.length).toBeLessThanOrEqual(601)
  })

  it('handles an empty recorder honestly', () => {
    const p = buildReplayPlots([], 240)
    expect(p.plan).toEqual([])
    expect(p.touchdownIdx).toBeNull()
  })
})

describe('respawn teleports (EGLL acceptance finding)', () => {
  it('plots only the trailing contiguous run — a mid-window teleport is not a 4,600 nm segment', () => {
    // Found live: the recorder buffer spanned a California default spawn,
    // several crash→respawn cycles at Heathrow, and the landing; the
    // profile's distance axis read 4652.8 nm because the spawn teleport
    // entered the cumulative sum as one giant fake segment.
    const run = approach()
    const teleported: typeof run = run.map((s, i) => (
      i < 300 ? { ...s, lat: s.lat + 50, lon: s.lon + 60 } : s // first 30 s: 'another continent'
    ))
    const p = buildReplayPlots(teleported, 300)
    // Only the post-teleport run survives: ~150 s of flight ≈ 7.7 km, not thousands of km.
    expect(p.totalDistM).toBeLessThan(20_000)
    expect(p.totalDistM).toBeGreaterThan(5_000)
    expect(p.plan.length).toBe(run.length - 300)
    // Touchdown still found inside the surviving run.
    expect(p.touchdownIdx).not.toBeNull()
  })
})
