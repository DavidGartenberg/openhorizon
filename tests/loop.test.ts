import { describe, expect, it } from 'vitest'
import { FixedTimestepLoop } from '../src/sim/loop'

describe('FixedTimestepLoop', () => {
  it('runs 120 ticks per simulated second at 1x', () => {
    const loop = new FixedTimestepLoop(120)
    // One second delivered as 60 fps frames.
    for (let i = 0; i < 60; i++) loop.advance(1 / 60, () => {})
    expect(loop.ticks).toBeGreaterThanOrEqual(119)
    expect(loop.ticks).toBeLessThanOrEqual(121)
    expect(loop.simTime).toBeCloseTo(loop.ticks * loop.dt, 9)
  })

  it('always steps with exactly dt', () => {
    const loop = new FixedTimestepLoop(120)
    const dts: number[] = []
    for (let i = 0; i < 30; i++) loop.advance(0.017, (dt) => dts.push(dt))
    expect(dts.length).toBeGreaterThan(0)
    for (const dt of dts) expect(dt).toBe(loop.dt)
  })

  it('does not tick while paused and resumes cleanly', () => {
    const loop = new FixedTimestepLoop(120)
    loop.setRate(0)
    for (let i = 0; i < 60; i++) loop.advance(1 / 60, () => {})
    expect(loop.ticks).toBe(0)
    expect(loop.simTime).toBe(0)

    loop.setRate(1)
    for (let i = 0; i < 60; i++) loop.advance(1 / 60, () => {})
    expect(loop.ticks).toBeGreaterThanOrEqual(119)
  })

  it('scales tick count with sim rate', () => {
    const oneX = new FixedTimestepLoop(120)
    const fourX = new FixedTimestepLoop(120)
    fourX.setRate(4)
    for (let i = 0; i < 60; i++) {
      oneX.advance(1 / 60, () => {})
      fourX.advance(1 / 60, () => {})
    }
    expect(fourX.ticks).toBeGreaterThanOrEqual(4 * oneX.ticks - 4)
    expect(fourX.ticks).toBeLessThanOrEqual(4 * oneX.ticks + 4)
  })

  it('clamps giant frames and never death-spirals', () => {
    const loop = new FixedTimestepLoop(120, 30)
    let steps = 0
    loop.advance(10, () => steps++) // e.g. tab was backgrounded 10 s
    expect(steps).toBeLessThanOrEqual(30)
    // Backlog was dropped: the next normal frame ticks a normal amount.
    steps = 0
    loop.advance(1 / 60, () => steps++)
    expect(steps).toBeLessThanOrEqual(3)
  })

  it('returns interpolation alpha in [0, 1)', () => {
    const loop = new FixedTimestepLoop(120)
    for (let i = 0; i < 100; i++) {
      const alpha = loop.advance(Math.random() * 0.03, () => {})
      expect(alpha).toBeGreaterThanOrEqual(0)
      expect(alpha).toBeLessThan(1)
    }
  })

  it('ignores negative/NaN elapsed values', () => {
    const loop = new FixedTimestepLoop(120)
    loop.advance(-5, () => {})
    loop.advance(Number.NaN, () => {})
    expect(loop.ticks).toBe(0)
  })
})

describe('rate-scaled step budget (Slice 7)', () => {
  it('a 0.25 s frame at 4x yields a full second of sim time (was silently 1x)', () => {
    const loop = new FixedTimestepLoop(120)
    loop.setRate(4)
    let ticks = 0
    loop.advance(0.25, () => ticks++)
    // 0.25 real x 4 = 1.0 s of sim = 120 ticks at 120 Hz.
    expect(ticks).toBe(120)
    expect(loop.simTime).toBeCloseTo(1.0, 6)
  })

  it('rate 1 keeps the original spiral-of-death guard (0.25 s cap per advance)', () => {
    const loop = new FixedTimestepLoop(120)
    let ticks = 0
    loop.advance(3.0, () => ticks++) // huge frame clamps to 0.25
    expect(ticks).toBe(30)
  })
})
