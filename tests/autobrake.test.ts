import { describe, expect, it } from 'vitest'
import {
  AUTOBRAKE_SETTINGS, AUTOBRAKE_TARGET_MS2, makeAutobrake, normalizeAutobrakeSetting, selectAutobrake, stepAutobrake,
  type AutobrakeInput, type AutobrakeState,
} from '../src/sim/autobrake'

const KT = 0.514444
const base: AutobrakeInput = { dt: 0.1, onGround: true, groundSpeedMs: 70, throttle: 0, reverse: false, pilotBrake: 0, spoilerPos: 0, maxBrakeDecelMs2: 4 }
const step = (s: AutobrakeState, o: Partial<AutobrakeInput> = {}, n = 1): AutobrakeState => {
  let x = s
  for (let i = 0; i < n; i++) x = stepAutobrake(x, { ...base, ...o })
  return x
}
/** Selected in flight, then touched down at 70 m/s with idle thrust. */
const landed = (setting: Parameters<typeof selectAutobrake>[1], touchdownSpeed = 70): AutobrakeState => {
  let s = selectAutobrake(makeAutobrake(), setting)
  s = step(s, { onGround: false, groundSpeedMs: touchdownSpeed }, 3)
  return step(s, { groundSpeedMs: touchdownSpeed }, 3)
}

describe('selector', () => {
  it('has the 737 positions in knob order and decel targets that rise with the setting', () => {
    expect(AUTOBRAKE_SETTINGS).toEqual(['rto', 'off', '1', '2', '3', 'max'])
    const t = AUTOBRAKE_TARGET_MS2
    expect(t['1']).toBeLessThan(t['2']); expect(t['2']).toBeLessThan(t['3']); expect(t['3']).toBeLessThan(t.max)
    expect(t['1']).toBeCloseTo(4 * 0.3048, 3) // ≈ 4 ft/s²
  })
  it('accepts the legacy controller names', () => {
    expect(normalizeAutobrakeSetting('low')).toBe('1'); expect(normalizeAutobrakeSetting('medium')).toBe('2')
    expect(normalizeAutobrakeSetting('max')).toBe('max'); expect(normalizeAutobrakeSetting('RTO')).toBe('rto')
    expect(normalizeAutobrakeSetting('nonsense')).toBeNull()
  })
  it('OFF is inert; any other setting is armed; reselecting clears a disarm light', () => {
    expect(makeAutobrake().phase).toBe('off')
    const armed = selectAutobrake(makeAutobrake(), '2'); expect(armed.phase).toBe('armed')
    let s = landed('2'); expect(s.phase).toBe('active')
    s = step(s, { pilotBrake: 0.6 }); expect(s.phase).toBe('disarmed'); expect(s.disarmLight).toBe(true)
    s = selectAutobrake(s, '2'); expect(s.phase).toBe('armed'); expect(s.disarmLight).toBe(false)
    expect(selectAutobrake(s, 'off').phase).toBe('off')
  })
})

describe('landing autobrake', () => {
  it('does nothing while parked or taxiing (it has not been flying)', () => {
    let s = selectAutobrake(makeAutobrake(), 'max')
    s = step(s, { groundSpeedMs: 0 }, 5); expect(s.demand).toBe(0)
    s = step(s, { groundSpeedMs: 10 * KT }, 20); expect(s.demand).toBe(0); expect(s.phase).toBe('armed')
  })
  it('stays off in the air, applies after touchdown once the thrust levers are at idle', () => {
    let s = selectAutobrake(makeAutobrake(), '3')
    s = step(s, { onGround: false }, 10); expect(s.demand).toBe(0); expect(s.phase).toBe('armed')
    s = step(s, { throttle: 0.5 }, 5); expect(s.phase).toBe('armed'); expect(s.demand).toBe(0) // thrust still up
    s = step(s, { throttle: 0.02 }, 3); expect(s.phase).toBe('active'); expect(s.demand).toBeGreaterThan(0)
  })
  it('ramps the brakes on rather than slamming them', () => {
    let s = step(selectAutobrake(makeAutobrake(), 'max'), { onGround: false }, 2)
    s = step(s, {}, 1) // the first tick on the ground, 0.1 s
    expect(s.phase).toBe('active'); expect(s.demand).toBeGreaterThan(0); expect(s.demand).toBeLessThan(0.4)
  })
  it('a bounce releases the brakes and the next touchdown re-applies them', () => {
    let s = landed('2')
    expect(s.demand).toBeGreaterThan(0)
    s = step(s, { onGround: false }, 3); expect(s.demand).toBe(0); expect(s.phase).toBe('armed')
    s = step(s, {}, 4); expect(s.phase).toBe('active'); expect(s.demand).toBeGreaterThan(0)
  })
  it('releases and disarms quietly (no light) below 5 kt', () => {
    let s = landed('2')
    s = step(s, { groundSpeedMs: 3 * KT }); expect(s.demand).toBe(0); expect(s.phase).toBe('disarmed'); expect(s.disarmLight).toBe(false)
  })
  it('disarms with the light when the pilot brakes, advances the thrust levers, or stows the speedbrake', () => {
    const pilot = step(landed('3'), { pilotBrake: 0.6 })
    expect(pilot.phase).toBe('disarmed'); expect(pilot.disarmLight).toBe(true); expect(pilot.reason).toMatch(/BRAKE/i); expect(pilot.demand).toBe(0)
    const thrust = step(landed('3'), { throttle: 0.6 })
    expect(thrust.phase).toBe('disarmed'); expect(thrust.reason).toMatch(/THRUST/i)
    let sb = step(landed('3'), { spoilerPos: 1 }, 3); expect(sb.phase).toBe('active')
    sb = step(sb, { spoilerPos: 0 }); expect(sb.phase).toBe('disarmed'); expect(sb.reason).toMatch(/SPEEDBRAKE/i)
  })
  it('a light brush on the pedals does not disarm; reverse thrust does not disarm', () => {
    let s = step(landed('3'), { pilotBrake: 0.1 }); expect(s.phase).toBe('active')
    s = step(s, { throttle: 0.6, reverse: true }); expect(s.phase).toBe('active')
  })
  it('stays disarmed until the selector is cycled', () => {
    let s = step(landed('2'), { pilotBrake: 0.8 })
    s = step(s, { pilotBrake: 0 }, 20); expect(s.phase).toBe('disarmed'); expect(s.demand).toBe(0)
  })
  it('never activates a landing setting that was only selected on the ground, even at speed', () => {
    let s = selectAutobrake(makeAutobrake(), '2')
    s = step(s, { groundSpeedMs: 60 }, 10); expect(s.demand).toBe(0)
  })
})

describe('RTO', () => {
  it('arms with takeoff power, stays off below 85 kt, and brakes hard on a rejected takeoff above it', () => {
    let s = selectAutobrake(makeAutobrake(), 'rto')
    s = step(s, { groundSpeedMs: 40, throttle: 0 }, 5); expect(s.demand).toBe(0) // no takeoff power seen yet
    s = step(s, { groundSpeedMs: 30, throttle: 0.9 }, 5)
    s = step(s, { groundSpeedMs: 30, throttle: 0 }, 5); expect(s.phase).toBe('armed'); expect(s.demand).toBe(0) // 58 kt < 85 kt
    s = step(s, { groundSpeedMs: 70, throttle: 0.9 }, 5)
    s = step(s, { groundSpeedMs: 70, throttle: 0 }, 10)
    expect(s.phase).toBe('active'); expect(s.demand).toBe(1)
  })
  it('does not apply in flight, and an advanced thrust lever cancels it', () => {
    let s = selectAutobrake(makeAutobrake(), 'rto')
    s = step(s, { groundSpeedMs: 70, throttle: 0.9 }, 5)
    s = step(s, { onGround: false, throttle: 0 }, 10); expect(s.demand).toBe(0)
    s = selectAutobrake(makeAutobrake(), 'rto')
    s = step(s, { groundSpeedMs: 70, throttle: 0.9 }, 5); s = step(s, { groundSpeedMs: 70, throttle: 0 }, 10)
    expect(s.phase).toBe('active')
    s = step(s, { throttle: 0.9 }); expect(s.phase).toBe('disarmed'); expect(s.demand).toBe(0)
  })
})

describe('deceleration control (first-order plant)', () => {
  /** Speed integrates the plant decel = bMax·demand + extra; the controller sees only ground speed. */
  function roll(setting: Parameters<typeof selectAutobrake>[1], extra: number, seconds: number, bMax = 4) {
    let s = selectAutobrake(makeAutobrake(), setting)
    s = step(s, { onGround: false, groundSpeedMs: 70 }, 3)
    let v = 70
    const dt = 0.05
    const log: Array<{ t: number; v: number; demand: number; a: number }> = []
    for (let t = 0; t < seconds; t += dt) {
      s = stepAutobrake(s, { ...base, dt, groundSpeedMs: v, maxBrakeDecelMs2: bMax })
      const a = bMax * s.demand + (s.phase === 'active' ? extra : 0)
      v = Math.max(0, v - a * dt)
      log.push({ t, v, demand: s.demand, a })
    }
    return { s, log }
  }
  it.each(['1', '2', '3'] as const)('holds the %s target deceleration within 8%% once settled', (setting) => {
    const { log } = roll(setting, 0, 12)
    const late = log.filter((p) => p.t > 6 && p.t < 11)
    const mean = late.reduce((a, p) => a + p.a, 0) / late.length
    expect(mean).toBeGreaterThan(AUTOBRAKE_TARGET_MS2[setting] * 0.92)
    expect(mean).toBeLessThan(AUTOBRAKE_TARGET_MS2[setting] * 1.08)
  })
  it('does not oscillate: demand is steady once settled', () => {
    const { log } = roll('2', 0, 14)
    const late = log.filter((p) => p.t > 8 && p.t < 13).map((p) => p.demand)
    expect(Math.max(...late) - Math.min(...late)).toBeLessThan(0.06)
  })
  it('other retarding forces (spoilers, reversers) take over: the brakes back off', () => {
    const light = roll('1', 0, 12).log.filter((p) => p.t > 8).at(-1)!.demand
    const helped = roll('1', 0.8, 12).log.filter((p) => p.t > 8).at(-1)!.demand
    expect(helped).toBeLessThan(light - 0.1)
    const plenty = roll('1', 3, 12).log.filter((p) => p.t > 8).at(-1)!.demand
    expect(plenty).toBe(0)
  })
  it('MAX saturates at full brakes when the airplane cannot reach the target', () => {
    const { log } = roll('max', 0, 10, 3) // 3 m/s² of brake vs a 4.3 m/s² target
    expect(log.filter((p) => p.t > 5).every((p) => p.demand > 0.97)).toBe(true)
  })
})

describe('robustness', () => {
  it('ignores a non-positive or non-finite dt and non-finite speed', () => {
    const s = landed('2')
    expect(stepAutobrake(s, { ...base, dt: 0 })).toEqual(s)
    expect(stepAutobrake(s, { ...base, dt: NaN })).toEqual(s)
    const bad = stepAutobrake(s, { ...base, groundSpeedMs: NaN })
    expect(Number.isFinite(bad.demand)).toBe(true); expect(bad.demand).toBeGreaterThanOrEqual(0); expect(bad.demand).toBeLessThanOrEqual(1)
  })
  it('does not mutate the previous state', () => {
    const s = landed('2'); const copy = JSON.stringify(s)
    stepAutobrake(s, { ...base, pilotBrake: 1 }); expect(JSON.stringify(s)).toBe(copy)
  })
})
