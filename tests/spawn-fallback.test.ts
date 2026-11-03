import { describe, expect, it } from 'vitest'
import { chooseFallbackSpawn } from '../src/sim/spawn-fallback'

describe('spawn without airport data', () => {
  it('waits for terrain, then parks on it', () => {
    expect(chooseFallbackSpawn(false, 0, 1000)).toEqual({ kind: 'wait' })
    expect(chooseFallbackSpawn(true, 21.5, 1500)).toEqual({ kind: 'terrain', elevM: 21.5 })
  })
  it('falls back to sea level when no terrain arrives in time', () => {
    expect(chooseFallbackSpawn(false, 0, 20_000)).toEqual({ kind: 'sea' })
    expect(chooseFallbackSpawn(true, Number.NaN, 20_000)).toEqual({ kind: 'sea' })
  })
})
