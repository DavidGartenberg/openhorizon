import { describe, expect, it } from 'vitest'
import { chooseFallbackSpawn, needsRepark } from '../src/sim/spawn-fallback'

describe('spawn without airport data', () => {
  it('waits for the finest terrain, then parks on it', () => {
    expect(chooseFallbackSpawn(false, true, 18, 1000)).toEqual({ kind: 'wait' }) // only a coarse ring yet
    expect(chooseFallbackSpawn(true, true, 21.5, 1500)).toEqual({ kind: 'terrain', elevM: 21.5 })
  })
  it('after the budget takes a coarse ring, or sea level with nothing loaded', () => {
    expect(chooseFallbackSpawn(false, true, 18, 20_000)).toEqual({ kind: 'terrain', elevM: 18 })
    expect(chooseFallbackSpawn(false, false, 0, 20_000)).toEqual({ kind: 'sea' })
    expect(chooseFallbackSpawn(true, true, Number.NaN, 20_000)).toEqual({ kind: 'sea' })
  })
  it('re-parks a stationary spawn when finer terrain moves the ground under it', () => {
    expect(needsRepark(18, 21.4, 0, 0.2)).toBe(true)
    expect(needsRepark(18, 18.1, 0, 0.2)).toBe(false) // within tolerance
    expect(needsRepark(18, 21.4, 12, 40)).toBe(false) // the pilot is already taxiing
  })
})
