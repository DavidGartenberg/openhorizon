import { describe, expect, it } from 'vitest'
import { touchdownSmoke } from '../src/sim/touchdown'

describe('touchdown tyre smoke', () => {
  it('only on the air → ground transition, scaled by speed and firmness', () => {
    expect(touchdownSmoke(true, true, 70, 2)).toBe(0) // rolling, not a touchdown
    expect(touchdownSmoke(false, false, 70, 2)).toBe(0) // still flying
    expect(touchdownSmoke(false, true, 15, 2)).toBe(0) // slow taildragger: no smoke
    const greaser = touchdownSmoke(false, true, 70, 0.3)
    const firm = touchdownSmoke(false, true, 70, 2.5)
    expect(greaser).toBeGreaterThan(0)
    expect(firm).toBeGreaterThan(greaser)
    expect(touchdownSmoke(false, true, 40, 2.5)).toBeLessThan(firm)
  })
})
