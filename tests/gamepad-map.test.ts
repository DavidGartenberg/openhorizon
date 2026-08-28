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
  detectPressedButton, leverWithReverse, tcaPresetFor, tcaButtonPreset, HELD_ALIASES,
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

describe('TCA Captain Pack support (16a-b)', () => {
  it('leverWithReverse: forward range, idle guard, reverse gate depth', () => {
    expect(leverWithReverse(1)).toEqual({ power: 1, reverse: false })
    expect(leverWithReverse(0)).toEqual({ power: 0.5, reverse: false })
    expect(leverWithReverse(-1)).toEqual({ power: 0, reverse: false }) // exactly idle
    expect(leverWithReverse(-1.05).power).toBe(0) // wobble below idle stays forward-idle
    const rev = leverWithReverse(-1.4) // deep in the lifted reverse zone
    expect(rev.reverse).toBe(true)
    expect(rev.power).toBeGreaterThan(0.4)
  })

  it('detectPressedButton finds a new press on any pad', () => {
    const before = [[false, false], [false, false, false]]
    const after = [[false, false], [false, false, true]]
    expect(detectPressedButton(before, after)).toEqual({ pad: 1, btn: 2 })
    expect(detectPressedButton(after, after)).toBeNull()
  })

  it('button bindings survive the serialize/parse round-trip; old maps still parse', () => {
    const m = {
      pitch: { pad: 0, axis: 1, sign: 1 as const },
      btn: { gear: { pad: 1, btn: 4 }, reverse: { pad: 1, btn: 0 } },
    }
    const back = parseGamepadMap(serializeGamepadMap({ ...m, v: 2 }))
    expect(back?.v).toBe(2)
    expect(back?.btn?.gear).toEqual({ pad: 1, btn: 4 })
    expect(back?.pitch?.axis).toBe(1)
    const legacy = parseGamepadMap('{"roll":{"pad":0,"axis":0,"sign":1}}')
    expect(legacy?.roll?.sign).toBe(1)
  })

  it('tcaPresetFor maps stick axes and BOTH quadrant levers to the right pads', () => {
    // Real device ids/axis counts read from the user's Captain Pack.
    const m = tcaPresetFor([
      { id: 'TCA Sidestick X Copilot (Vendor: 044f Product: 040f)', axes: 10, index: 0 },
      { id: 'TCA Q-Eng 1&2 (Vendor: 044f Product: 0407)', axes: 7, index: 1 },
    ])!
    expect(m.roll).toEqual({ pad: 0, axis: 0, sign: 1 })
    expect(m.pitch).toEqual({ pad: 0, axis: 1, sign: 1 })
    expect(m.yaw).toEqual({ pad: 0, axis: 5, sign: 1 }) // twist is axis 5 on the real unit
    expect(m.throttle).toEqual({ pad: 1, axis: 0, sign: 1 }) // idle=-1, TOGA=+1 (live-verified)
    expect(m.throttle2).toEqual({ pad: 1, axis: 1, sign: 1 })
    expect(m.v).toBe(6)
    // Full face bound: trigger = PTT, red = AP disconnect, base buttons = gear/flaps/spoilers…
    expect(m.btnKeys?.['0:0']).toBe('KeyT')
    expect(m.btn?.apDisconnect).toEqual({ pad: 0, btn: 1 })
    expect(m.btnKeys?.['0:4']).toBe('KeyU')
    expect(m.btn?.reverse).toEqual({ pad: 1, btn: 0 })
  })

  it('button preset: every stick face button gets a job; held aliases are the held keys', () => {
    const p = tcaButtonPreset(0, 1)
    expect(Object.keys(p.keys).length).toBeGreaterThanOrEqual(16)
    expect(p.keys['0:16']).toBeUndefined() // no guessed hat/latching-switch aliases
    expect(new Set(Object.values(p.keys)).has('KeyB')).toBe(true)
    expect(HELD_ALIASES.has('KeyB')).toBe(true)
    expect(HELD_ALIASES.has('KeyU')).toBe(false)
    const back = parseGamepadMap(serializeGamepadMap({ btnKeys: p.keys, v: 5 }))
    expect(back?.btnKeys?.['0:0']).toBe('KeyT')
  })

  it('stick alone falls back to its base slider for throttle; non-TCA gets nothing', () => {
    const solo = tcaPresetFor([{ id: 'TCA STICK X AIRBUS', axes: 4, index: 0 }])!
    expect(solo.throttle).toEqual({ pad: 0, axis: 3, sign: -1 }) // 4-axis variant keeps the classic layout
    const solo10 = tcaPresetFor([{ id: 'TCA Sidestick X Copilot', axes: 10, index: 0 }])!
    expect(solo10.throttle).toEqual({ pad: 0, axis: 6, sign: -1 })
    expect(solo.throttle2).toBeUndefined()
    expect(tcaPresetFor([{ id: 'Xbox Wireless Controller', axes: 4, index: 0 }])).toBeNull()
  })
})

describe('9A: capture-time device guards', () => {
  it('a pad that connects MID-capture cannot insta-bind its resting axes', () => {
    // Baseline had one pad; a quadrant connects during capture with its
    // slider parked at -1 — a full-swing "delta" against an empty
    // baseline. Must be ignored.
    const before = [[0, 0]]
    const after = [[0, 0.05], [-1, -1]]
    expect(detectMovedAxis(before, after, 0.35)).toBeNull()
  })
})
