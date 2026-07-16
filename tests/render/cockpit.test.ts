import { describe, expect, it } from 'vitest'
import { cycleFuelSelector, cycleMagneto, dragToAxisValue, nearestFlapDetent } from '../../src/render/cockpit'

describe('cycleFuelSelector (floor fuel selector click-cycle)', () => {
  it('cycles OFF -> L -> BOTH -> R -> OFF', () => {
    expect(cycleFuelSelector('OFF')).toBe('L')
    expect(cycleFuelSelector('L')).toBe('BOTH')
    expect(cycleFuelSelector('BOTH')).toBe('R')
    expect(cycleFuelSelector('R')).toBe('OFF')
  })
})

describe('cycleMagneto (ignition key click-cycle)', () => {
  it('cycles off -> right -> left -> both -> off', () => {
    expect(cycleMagneto('off')).toBe('right')
    expect(cycleMagneto('right')).toBe('left')
    expect(cycleMagneto('left')).toBe('both')
    expect(cycleMagneto('both')).toBe('off')
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
