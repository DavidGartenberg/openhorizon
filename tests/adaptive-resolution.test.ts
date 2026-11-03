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
    let t = 0
    for (let i = 0; i < 100; i++) { t += i % 10 === 0 ? 8000 : 10; ar.sample(i % 10 === 0 ? 8000 : 10, t) } // a background tab coming back
    expect(ar.scale).toBe(1)
    const off = new AdaptiveResolution()
    off.enabled = false
    run(off, 20, () => 50)
    expect(off.scale).toBe(1)
    expect(off.lite).toBe(false)
  })

  it('a single hitch (a shader compiling) costs no resolution', () => {
    const ar = new AdaptiveResolution()
    let t = run(ar, 10, () => 10)
    t += 900; ar.sample(900, t)
    run(ar, 10, () => 10, t)
    expect(ar.scale).toBe(1)
    expect(ar.lite).toBe(false)
  })

  it('a very slow machine (0.4 fps) still adapts: the floor, then the lite tier', () => {
    const ar = new AdaptiveResolution()
    run(ar, 120, (s) => 200 + 2300 * s * s)
    expect(ar.scale).toBe(0.5)
    expect(ar.lite).toBe(true)
  })
})

/** Simulated GPU with a lite tier: its pixel cost is `liteFactor` of the full tier's. */
function runTiered(ar: AdaptiveResolution, seconds: number, fixed: number, pixel: number, liteFactor: number, t0 = 0, onFlip?: (lite: boolean, t: number) => void): number {
  let t = t0
  while (t < t0 + seconds * 1000) {
    const ms = Math.max(1000 / 60, fixed + pixel * ar.scale * ar.scale * (ar.lite ? liteFactor : 1))
    t += ms
    const was = ar.lite
    ar.sample(ms, t)
    if (ar.lite !== was) onFlip?.(ar.lite, t)
  }
  return t
}

describe('dynamic resolution: the lite tier below the floor', () => {
  it('is never used while lowering resolution alone holds the target', () => {
    const ar = new AdaptiveResolution()
    runTiered(ar, 120, 4, 40, 0.5) // 14 ms at the floor
    expect(ar.lite).toBe(false)
  })

  it('stays on, without flapping, where only it holds the target', () => {
    const ar = new AdaptiveResolution()
    let flips = 0
    runTiered(ar, 180, 10, 60, 0.5, 0, () => flips++)
    expect(ar.lite).toBe(true)
    expect(flips).toBe(1)
  })

  it('comes back off once the load goes away', () => {
    const ar = new AdaptiveResolution()
    const t = runTiered(ar, 60, 10, 60, 0.5)
    expect(ar.lite).toBe(true)
    runTiered(ar, 120, 2, 8, 0.5, t) // e.g. out over the ocean
    expect(ar.lite).toBe(false)
    expect(ar.scale).toBe(1)
  })

  it('does not retry a restore that could not hold for longer and longer', () => {
    // The lite tier has headroom at full scale; the full tier misses even
    // at the floor. Each restore fails; the waits between them double.
    const ar = new AdaptiveResolution()
    const restores: number[] = []
    runTiered(ar, 600, 7, 50, 0.05, 0, (lite, t) => { if (!lite) restores.push(t) })
    expect(restores.length).toBeGreaterThan(0)
    expect(restores.length).toBeLessThanOrEqual(4)
    for (let i = 2; i < restores.length; i++) expect(restores[i]! - restores[i - 1]!).toBeGreaterThan(1.5 * (restores[i - 1]! - restores[i - 2]!))
    expect(ar.lite).toBe(true)
  })

  it('reset() leaves the lite tier', () => {
    const ar = new AdaptiveResolution()
    runTiered(ar, 60, 10, 60, 0.5)
    expect(ar.lite).toBe(true)
    ar.reset()
    expect(ar.lite).toBe(false)
    expect(ar.scale).toBe(1)
  })
})
