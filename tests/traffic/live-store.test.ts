/**
 * Live ADS-B client store (14b) — pure. Polls arrive every ~10 s; the
 * store dead-reckons targets between polls, blends new fixes in over
 * ~2 s (no teleports), corrects for the provider-reported position age,
 * expires targets unseen for 30 s, and caps to the 40 nearest.
 */
import { describe, expect, it } from 'vitest'
import { LiveTrafficStore, type LiveTargetWire } from '../../src/sim/traffic/live'

const M_PER_DEG_LAT = 111_319.5

const wire = (over: Partial<LiveTargetWire> = {}): LiveTargetWire => ({
  id: 'abc123', cs: 'TEST1', t: 'C172', lat: 37.0, lon: -122.0,
  altFt: 3000, gnd: false, gsKt: 120, trk: 90, vsFpm: 0, ageS: 0,
  ...over,
})

describe('LiveTrafficStore', () => {
  it('dead-reckons between polls (east at 120 kt for 10 s ≈ 617 m)', () => {
    const s = new LiveTrafficStore()
    s.ingest([wire()], 0, 37, -122)
    for (let i = 0; i < 100; i++) s.step(0.1, i * 100)
    const t = [...s.targets.values()][0]!
    const eastM = (t.lon - -122.0) * M_PER_DEG_LAT * Math.cos((37 * Math.PI) / 180)
    expect(eastM).toBeGreaterThan(590)
    expect(eastM).toBeLessThan(645)
    expect(Math.abs(t.lat - 37.0)).toBeLessThan(1e-5) // track 090: no north drift
  })

  it('climbs by vsFpm between polls', () => {
    const s = new LiveTrafficStore()
    s.ingest([wire({ vsFpm: 600 })], 0, 37, -122)
    for (let i = 0; i < 100; i++) s.step(0.1, i * 100)
    expect([...s.targets.values()][0]!.altFt).toBeCloseTo(3100, -1)
  })

  it('blends a new fix in without teleporting, converging in ~3 s', () => {
    const s = new LiveTrafficStore()
    s.ingest([wire({ gsKt: 0 })], 0, 37, -122)
    s.step(0.1, 100)
    const before = [...s.targets.values()][0]!
    const lat0 = before.lat
    // New fix 0.005° north (~556 m) — a big jump.
    s.ingest([wire({ gsKt: 0, lat: 37.005 })], 200, 37, -122)
    s.step(1 / 60, 220)
    const justAfter = [...s.targets.values()][0]!
    expect(Math.abs(justAfter.lat - lat0)).toBeLessThan(0.001) // no teleport
    for (let i = 0; i < 180; i++) s.step(1 / 60, 220 + i * 16)
    expect([...s.targets.values()][0]!.lat).toBeCloseTo(37.005, 4) // converged
  })

  it('leads a stale fix by its reported age along track', () => {
    const s = new LiveTrafficStore()
    // 120 kt east, fix already 10 s old → authoritative position leads
    // the wire position by ~617 m immediately.
    s.ingest([wire({ ageS: 10 })], 0, 37, -122)
    for (let i = 0; i < 240; i++) s.step(1 / 60, i * 16) // ~4 s: blend done
    const t = [...s.targets.values()][0]!
    const eastM = (t.lon - -122.0) * M_PER_DEG_LAT * Math.cos((37 * Math.PI) / 180)
    expect(eastM).toBeGreaterThan(590 + 200) // 10 s lead + ~4 s DR
  })

  it('expires targets unseen for 30 s', () => {
    const s = new LiveTrafficStore()
    s.ingest([wire()], 0, 37, -122)
    s.step(0.1, 29_000)
    expect(s.targets.size).toBe(1)
    s.step(0.1, 31_000)
    expect(s.targets.size).toBe(0)
  })

  it('caps to the 40 nearest targets', () => {
    const s = new LiveTrafficStore()
    const rows: LiveTargetWire[] = []
    for (let i = 0; i < 45; i++) {
      rows.push(wire({ id: `t${i}`, lat: 37 + i * 0.01 })) // farther with i
    }
    s.ingest(rows, 0, 37, -122)
    expect(s.targets.size).toBe(40)
    expect(s.targets.has('t0')).toBe(true)
    expect(s.targets.has('t44')).toBe(false)
  })
})
