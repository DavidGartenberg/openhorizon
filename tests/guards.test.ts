/**
 * Boundary guards (Slice 0) — the finite-number gate every debug hook
 * and UI boundary must pass values through. A NaN that slipped through
 * one hook once froze physics permanently (unhealable accumulator), and
 * a stray string NaN-poisoned the control axes.
 */
import { describe, expect, it } from 'vitest'
import { finiteOr } from '../src/sim/guards'

describe('finiteOr', () => {
  it('passes finite numbers through unchanged', () => {
    expect(finiteOr(0)).toBe(0)
    expect(finiteOr(-3.5)).toBe(-3.5)
    expect(finiteOr(1e9)).toBe(1e9)
  })

  it('rejects NaN and infinities', () => {
    expect(finiteOr(NaN)).toBeNull()
    expect(finiteOr(Infinity)).toBeNull()
    expect(finiteOr(-Infinity)).toBeNull()
  })

  it('accepts numeric strings (console convenience) but not garbage strings', () => {
    expect(finiteOr('280')).toBe(280)
    expect(finiteOr(' 12.5 ')).toBe(12.5)
    expect(finiteOr('FLIGHT')).toBeNull()
    // Number('') === 0 — an empty string must NOT silently become zero.
    expect(finiteOr('')).toBeNull()
    expect(finiteOr('   ')).toBeNull()
  })

  it('rejects every other type (undefined, null, booleans, objects)', () => {
    expect(finiteOr(undefined)).toBeNull()
    expect(finiteOr(null)).toBeNull()
    expect(finiteOr(true)).toBeNull() // Number(true) is 1 — still garbage as a wind speed
    expect(finiteOr({})).toBeNull()
    expect(finiteOr([5])).toBeNull()
  })

  it('returns the fallback instead of null when one is given', () => {
    expect(finiteOr(NaN, 7)).toBe(7)
    expect(finiteOr('x', 0)).toBe(0)
    expect(finiteOr(3, 7)).toBe(3)
  })
})
