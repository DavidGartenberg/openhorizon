import { describe, expect, it } from 'vitest'
import { fowlerPose } from '../src/render/fowler'

describe('fowlerPose — extend out, THEN down', () => {
  it('is closed at 0 and fully extended + rotated at 1', () => {
    expect(fowlerPose(0)).toEqual({ ext: 0, rot: 0, drop: 0 })
    const full = fowlerPose(1)
    expect(full.ext).toBeCloseTo(1, 6)
    expect(full.rot).toBeCloseTo(1, 6)
  })
  it('first phase is translation: at 30% travel the panel is mostly out but barely rotated', () => {
    const p = fowlerPose(0.3)
    expect(p.ext).toBeGreaterThan(0.7)
    expect(p.rot).toBe(0) // rotation has not begun at all
  })
  it('by half travel extension is ~done while rotation has only just begun', () => {
    const p = fowlerPose(0.5)
    expect(p.ext).toBe(1) // extension fully complete before rotation starts
    expect(p.rot).toBe(0)
  })
  it('second phase is rotation: from 50% to 100% rotation grows far more than extension', () => {
    const a = fowlerPose(0.5)
    const b = fowlerPose(1)
    expect(b.rot - a.rot).toBeGreaterThan(0.8)
    expect(b.ext - a.ext).toBeLessThan(0.1)
  })
  it('is monotonic and clamped', () => {
    let last = fowlerPose(-1)
    expect(last).toEqual(fowlerPose(0))
    for (let f = 0.05; f <= 1.0001; f += 0.05) {
      const p = fowlerPose(f)
      expect(p.ext).toBeGreaterThanOrEqual(last.ext)
      expect(p.rot).toBeGreaterThanOrEqual(last.rot)
      last = p
    }
    expect(fowlerPose(2)).toEqual(fowlerPose(1))
  })
})
