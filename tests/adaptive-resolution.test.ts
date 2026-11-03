import { describe, expect, it } from 'vitest'
import { AdaptiveResolution } from '../src/render/adaptive-resolution'

/** Simulated GPU: frame time = fixed cost + pixel cost × scale². */
function run(ar: AdaptiveResolution, seconds: number, cost: (scale: number) => number, t0 = 0): number {
  let t = t0
  while (t < t0 + seconds * 1000) {
    const ms = Math.max(1000 / 60, cost(ar.scale)) // vsync-capped
    t += ms
    ar.sample(ms, t)
  }
  return t
}

describe('dynamic resolution controller', () => {
  it('trades resolution for frame rate under GPU load, then holds', () => {
    const ar = new AdaptiveResolution()
    run(ar, 20, (s) => 4 + 30 * s * s) // 34 ms at full res
    expect(ar.scale).toBeLessThan(0.85)
    expect(ar.scale).toBeGreaterThanOrEqual(0.5)
    expect(4 + 30 * ar.scale * ar.scale).toBeLessThan((1000 / 60) * 1.2) // ≈ on target
  })

  it('stops at the floor when even the floor cannot make the target', () => {
    const ar = new AdaptiveResolution()
    run(ar, 30, () => 80)
    expect(ar.scale).toBe(0.5)
  })

  it('recovers full resolution when the load goes away', () => {
    const ar = new AdaptiveResolution()
    let t = run(ar, 15, (s) => 4 + 40 * s * s)
    const low = ar.scale
    t = run(ar, 60, (s) => 2 + 6 * s * s, t)
    expect(low).toBeLessThan(0.8)
    expect(ar.scale).toBe(1)
  })

  it('does not oscillate: a probe that costs frames blocks probing for a while', () => {
    const ar = new AdaptiveResolution()
    const changes: number[] = []
    let t = 0
    // Exactly at the edge: the next 8% step up goes over budget.
    const cost = (s: number): number => 3 + 15.5 * s * s
    while (t < 60_000) {
      const ms = Math.max(1000 / 60, cost(ar.scale))
      t += ms
      if (ar.sample(ms, t) !== null) changes.push(t)
    }
    expect(changes.length).toBeLessThan(12) // not a change every few seconds
  })

  it('ignores stalls and does nothing when disabled', () => {
    const ar = new AdaptiveResolution()
    for (let i = 0; i < 100; i++) ar.sample(1500, i * 1500) // tab in background
    expect(ar.scale).toBe(1)
    const off = new AdaptiveResolution()
    off.enabled = false
    run(off, 20, () => 50)
    expect(off.scale).toBe(1)
  })
})
