/**
 * Gamepad mapping core (16a) — pure. The binding convention that makes
 * inverted hardware Just Work: during capture the pilot moves the axis
 * to the function's POSITIVE extreme (nose UP, RIGHT roll, full
 * throttle) and the observed movement direction becomes +1. Unipolar
 * functions (throttle/mixture/brakes) map the signed axis onto [0,1].
 */
import { describe, expect, it } from 'vitest'
import {
  applyDeadzone, axisToUnipolar, detectMovedAxis,
  parseGamepadMap, serializeGamepadMap, DEFAULT_SINGLE_STICK,
} from '../src/sim/gamepad-map'

describe('applyDeadzone', () => {
  it('zeroes inside the zone and rescales outside so full deflection stays ±1', () => {
    expect(applyDeadzone(0.03)).toBe(0)
    expect(applyDeadzone(-0.05)).toBe(0)
    expect(applyDeadzone(1)).toBeCloseTo(1, 6)
    expect(applyDeadzone(-1)).toBeCloseTo(-1, 6)
    // Just past the zone: small but nonzero, continuous from 0.
    const justPast = applyDeadzone(0.08)
    expect(justPast).toBeGreaterThan(0)
    expect(justPast).toBeLessThan(0.05)
  })
})

describe('axisToUnipolar', () => {
  it('maps signed [-1,1] onto [0,1]', () => {
    expect(axisToUnipolar(-1)).toBe(0)
    expect(axisToUnipolar(1)).toBe(1)
    expect(axisToUnipolar(0)).toBeCloseTo(0.5, 6)
  })
  it('a slider reporting −1 at full forward binds with sign −1 and reads 1', () => {
    const sign = -1
    expect(axisToUnipolar(-1 * sign)).toBe(1)
  })
})

describe('detectMovedAxis', () => {
  it('picks the axis with the largest swing across devices, sign = direction moved', () => {
    const before = [[0, 0.1, 0], [0.5, 0]]
    const after = [[0, 0.12, 0], [-0.4, 0]] // pad1 axis0 moved −0.9
    const hit = detectMovedAxis(before, after, 0.35)
    expect(hit).toEqual({ pad: 1, axis: 0, sign: -1 })
  })
  it('returns null when nothing exceeds the threshold', () => {
    expect(detectMovedAxis([[0, 0]], [[0.2, -0.1]], 0.35)).toBeNull()
  })
})

describe('map serialization', () => {
  it('round-trips and rejects garbage', () => {
    const m = { pitch: { pad: 0, axis: 1, sign: 1 as const }, throttle: { pad: 1, axis: 2, sign: -1 as const } }
    expect(parseGamepadMap(serializeGamepadMap(m))).toEqual(m)
    expect(parseGamepadMap('not json')).toBeNull()
    expect(parseGamepadMap('{"pitch":{"pad":"x"}}')).toBeNull()
  })
})

describe('DEFAULT_SINGLE_STICK', () => {
  it('covers the four core axes on pad 0 (roll/pitch/twist/slider)', () => {
    expect(DEFAULT_SINGLE_STICK.roll).toEqual({ pad: 0, axis: 0, sign: 1 })
    expect(DEFAULT_SINGLE_STICK.pitch).toEqual({ pad: 0, axis: 1, sign: 1 })
    expect(DEFAULT_SINGLE_STICK.yaw).toEqual({ pad: 0, axis: 2, sign: 1 })
    // Slider convention: full forward reports −1 on most sticks.
    expect(DEFAULT_SINGLE_STICK.throttle).toEqual({ pad: 0, axis: 3, sign: -1 })
  })
})
