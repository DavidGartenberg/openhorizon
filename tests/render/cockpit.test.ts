import { describe, expect, it } from 'vitest'
import { cycleFuelSelector, stepMagneto, dragToAxisValue, nearestFlapDetent, tuneFrequency } from '../../src/render/cockpit'

describe('cycleFuelSelector (floor fuel selector click-cycle)', () => {
  it('cycles OFF -> L -> BOTH -> R -> OFF', () => {
    expect(cycleFuelSelector('OFF')).toBe('L')
    expect(cycleFuelSelector('L')).toBe('BOTH')
    expect(cycleFuelSelector('BOTH')).toBe('R')
    expect(cycleFuelSelector('R')).toBe('OFF')
  })
})

describe('stepMagneto (15c: adjacent-detent walk, no wrap)', () => {
  it('walks up off -> right -> left -> both and clamps at both', () => {
    expect(stepMagneto('off', 1)).toBe('right')
    expect(stepMagneto('right', 1)).toBe('left')
    expect(stepMagneto('left', 1)).toBe('both')
    expect(stepMagneto('both', 1)).toBe('both') // end stop — no one-click kill
  })
  it('walks back down and clamps at off', () => {
    expect(stepMagneto('both', -1)).toBe('left')
    expect(stepMagneto('left', -1)).toBe('right')
    expect(stepMagneto('right', -1)).toBe('off')
    expect(stepMagneto('off', -1)).toBe('off')
  })
})

describe('dragToAxisValue (vernier knob / trim wheel drag mapping)', () => {
  it('returns the start value with zero drag', () => {
    expect(dragToAxisValue(0.5, 0, 200, 0, 1)).toBe(0.5)
  })

  it('scales linearly with drag distance', () => {
    expect(dragToAxisValue(0, 100, 200, 0, 1)).toBeCloseTo(0.5)
    expect(dragToAxisValue(0, 200, 200, 0, 1)).toBeCloseTo(1)
  })

  it('clamps at the max', () => {
    expect(dragToAxisValue(0.9, 500, 200, 0, 1)).toBe(1)
  })

  it('clamps at the min', () => {
    expect(dragToAxisValue(0.1, -500, 200, 0, 1)).toBe(0)
  })

  it('supports a signed range (trim wheel, [-1, 1])', () => {
    expect(dragToAxisValue(0, -100, 200, -1, 1)).toBeCloseTo(-1)
    expect(dragToAxisValue(0, 100, 200, -1, 1)).toBeCloseTo(1)
  })

  it('is a no-op scaling guard when pxForFullRange is zero', () => {
    expect(dragToAxisValue(0.4, 999, 0, 0, 1)).toBe(0.4)
  })
})

describe('nearestFlapDetent (flap lever position -> detent index)', () => {
  it('snaps to detent 0 at the bottom of travel', () => {
    expect(nearestFlapDetent(0)).toBe(0)
  })

  it('snaps to detent 3 (max) at the top of travel', () => {
    expect(nearestFlapDetent(1)).toBe(3)
  })

  it('snaps to the nearest of 4 evenly spaced detents', () => {
    expect(nearestFlapDetent(0.3)).toBe(1) // nearest to 1/3
    expect(nearestFlapDetent(0.6)).toBe(2) // nearest to 2/3
  })

  it('clamps out-of-range fractions', () => {
    expect(nearestFlapDetent(-1)).toBe(0)
    expect(nearestFlapDetent(2)).toBe(3)
  })
})

describe('tuneFrequency (NAV/COM standby-frequency click knob)', () => {
  it('increments by one step', () => {
    expect(tuneFrequency(118.0, 1, 0.025, 118.0, 136.0)).toBeCloseTo(118.025, 6)
  })

  it('decrements by one step', () => {
    expect(tuneFrequency(118.025, -1, 0.025, 118.0, 136.0)).toBeCloseTo(118.0, 6)
  })

  it('clamps at the max', () => {
    expect(tuneFrequency(135.99, 1, 0.025, 118.0, 136.0)).toBe(136.0)
  })

  it('clamps at the min', () => {
    expect(tuneFrequency(108.01, -1, 0.05, 108.0, 117.95)).toBe(108.0)
  })

  it('does not accumulate float drift over repeated clicks', () => {
    let f = 118.0
    for (let i = 0; i < 40; i++) f = tuneFrequency(f, 1, 0.025, 118.0, 136.0)
    expect(f).toBeCloseTo(119.0, 9)
  })
})
