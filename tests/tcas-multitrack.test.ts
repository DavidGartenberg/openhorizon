/**
 * TCAS multi-track integrity (14c) — the Phase-11 inventory found every
 * AI track fed as literal id 'AI' (one shared hysteresis state) and that
 * `states` never evicted departed tracks. With live ADS-B ids churning
 * every poll, both are real: two intruders must hold INDEPENDENT
 * hysteresis, and a departed id must not bequeath its widened gate to a
 * later track that reuses it.
 */
import { describe, expect, it } from 'vitest'
import { TcasComputer } from '../src/sim/tcas'

const OWN = { altFt: 3000, aglFt: 2500, vsFpm: 0 }

/** Head-on closer: tau = range/closure, level altitude. */
const closing = (id: string, rangeM: number, closureMs: number) => ({
  id,
  relNorthM: rangeM, relEastM: 0,
  relVnMs: -closureMs, relVeMs: 0,
  altFt: 3000, vsFpm: 0,
})

describe('TCAS multi-track (14c)', () => {
  it('two intruders hold independent levels under distinct ids', () => {
    const tcas = new TcasComputer({ taOnly: true })
    // A: tau 25 s → TA at this SL; B: far and opening → NONE.
    const out = tcas.step(0.5, OWN, [
      closing('AAA', 5000, 200),
      { id: 'BBB', relNorthM: 30_000, relEastM: 0, relVnMs: 50, relVeMs: 0, altFt: 3000, vsFpm: 0 },
    ])
    const byId = Object.fromEntries(out.tracks.map((t) => [t.id, t.level]))
    expect(byId.AAA).toBe('TA')
    expect(byId.BBB).toBe('NONE')
  })

  it('hysteresis is per-id: an active TA widens only its own gate', () => {
    const tcas = new TcasComputer({ taOnly: true })
    // Own 3000 ft/AGL 2500 = SL4: TA tau 30 s, retained gate 36 s.
    // Step 1: A solidly TA (tau 25); B in the hysteresis-only band
    // (tau 33 — beyond the fresh 30 s gate, inside the 1.2× gate).
    tcas.step(0.5, OWN, [closing('A', 5000, 200), closing('B', 6600, 200)])
    // Step 2: both in the hysteresis-only band — A retains TA through
    // ITS widened gate; B never alerted → floors at PROX (inside 6 nm).
    const out = tcas.step(0.5, OWN, [closing('A', 6600, 200), closing('B', 6600, 200)])
    const byId = Object.fromEntries(out.tracks.map((t) => [t.id, t.level]))
    expect(byId.A).toBe('TA')
    expect(byId.B).toBe('PROX')
  })

  it('evicts states for tracks absent from the input', () => {
    const tcas = new TcasComputer({ taOnly: true })
    tcas.step(0.5, OWN, [closing('A', 5000, 200), closing('B', 30_000, -50)])
    expect(tcas.trackedCount).toBe(2)
    tcas.step(0.5, OWN, [closing('B', 30_000, -50)])
    expect(tcas.trackedCount).toBe(1)
    // A returns in the hysteresis-only band: a RETAINED state would hold
    // TA; the evicted (fresh) state floors at PROX instead.
    const out = tcas.step(0.5, OWN, [closing('A', 6600, 200), closing('B', 30_000, -50)])
    expect(out.tracks.find((t) => t.id === 'A')!.level).toBe('PROX')
  })

  it('holds 30 live-style tracks and drops to zero when they leave', () => {
    const tcas = new TcasComputer({ taOnly: true })
    const many = Array.from({ length: 30 }, (_, i) => closing(`hex${i}`, 20_000 + i * 500, -10))
    tcas.step(0.5, OWN, many)
    expect(tcas.trackedCount).toBe(30)
    tcas.step(0.5, OWN, [])
    expect(tcas.trackedCount).toBe(0)
  })
})
