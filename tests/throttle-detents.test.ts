import { describe, expect, it } from 'vitest'
import { DETENT_CONFIRM_MS, DETENT_STILL_MS, ThrottleDetentCalibration } from '../src/input/throttle-detents'
import { leverReversesByTravel, leverWithReverse, mergePreset, parseGamepadMap, serializeGamepadMap, tcaPresetFor, throttleCalibration, type GamepadMap, type PadReading } from '../src/sim/gamepad-map'

const Q12 = 'TCA Q-Eng 1&2 (Vendor: 044f Product: 0407)'
const STICK = 'TCA Sidestick X Copilot (Vendor: 044f Product: 040f)'
const quad = (a0: number, a1: number): PadReading => ({ id: Q12, index: 0, connected: true, axes: [a0, a1, -1, 1, 1, -1, 0], buttons: Array.from({ length: 31 }, () => ({ pressed: false })) })
const stick: PadReading = { id: STICK, index: 1, connected: true, axes: new Array(10).fill(0), buttons: Array.from({ length: 22 }, () => ({ pressed: false })) }

function rig(): { map: () => GamepadMap; cal: ThrottleDetentCalibration; t: { now: number } } {
  const holder = { map: { ...tcaPresetFor([{ id: Q12, index: 0, axes: 7 }, { id: STICK, index: 1, axes: 10 }])! } }
  const cal = new ThrottleDetentCalibration(() => holder.map, (m) => { holder.map = m })
  return { map: () => holder.map, cal, t: { now: 0 } }
}
function hold(r: ReturnType<typeof rig>, a0: number, a1: number, ms: number): void {
  for (let e = 0; e < ms; e += 50) { r.t.now += 50; r.cal.poll([quad(a0, a1), stick], r.t.now) }
}
/** Move both levers to a position, wobbling on the way like a hand does, then rest there long enough to be taken. */
function restAt(r: ReturnType<typeof rig>, a0: number, a1: number): void {
  hold(r, a0 + 0.05, a1 - 0.04, 200); hold(r, a0, a1, DETENT_STILL_MS + DETENT_CONFIRM_MS + 200)
}

// Detents of a real-looking pair of levers (signed axis, TOGA up); each lever slightly different.
const L1 = { idle: -0.62, min: -1, cl: 0.12, flex: 0.38, max: 0.56 }
const L2 = { idle: -0.6, min: -0.99, cl: 0.1, flex: 0.36, max: 0.5 }

describe('thrust levers calibrated at their detents', () => {
  it('asks for IDLE, FULL REVERSE, CL, FLX and TOGA in turn, takes each where both levers rest, and saves it', () => {
    const r = rig()
    r.cal.start(r.t.now)
    expect(r.cal.step?.label).toBe('IDLE')
    restAt(r, L1.idle, L2.idle); expect(r.cal.step?.label).toBe('FULL REVERSE')
    restAt(r, L1.min, L2.min); expect(r.cal.step?.label).toBe('CL')
    restAt(r, L1.cl, L2.cl); expect(r.cal.step?.label).toBe('FLX/MCT')
    restAt(r, L1.flex, L2.flex); expect(r.cal.step?.label).toBe('TOGA')
    restAt(r, L1.max, L2.max)
    expect(r.cal.active).toBe(false)
    expect(r.map().throttle?.calibration).toEqual({ ...L1, measuredIdle: true })
    expect(r.map().throttle2?.calibration).toEqual({ ...L2, measuredIdle: true })
    expect(r.cal.message).toMatch(/ENG 1 IDLE at 24% of its travel, ENG 2 IDLE at 26% of its travel/)
  })

  it('the measured IDLE is what the levers are read with: below it is reverse, at it idle, at TOGA full', () => {
    const r = rig()
    r.cal.start(0)
    for (const p of ['idle', 'min', 'cl', 'flex', 'max'] as const) restAt(r, L1[p], L2[p])
    const b = r.map().throttle!
    expect(throttleCalibration(b)).toEqual({ ...L1, measuredIdle: true })
    expect(leverReversesByTravel(b)).toBe(true)
    const c = throttleCalibration(b)!
    expect(leverWithReverse(L1.idle, c)).toEqual({ power: 0, reverse: false })
    expect(leverWithReverse(L1.min, c)).toEqual({ power: 1, reverse: true })
    expect(leverWithReverse(L1.max, c).power).toBeCloseTo(1, 6)
    expect(leverWithReverse(-0.8, c).reverse).toBe(true)
  })

  it('is kept: it survives saving and loading, and a reconnect re-applying the preset', () => {
    const r = rig()
    r.cal.start(0)
    for (const p of ['idle', 'min', 'cl', 'flex', 'max'] as const) restAt(r, L1[p], L2[p])
    const loaded = parseGamepadMap(serializeGamepadMap(r.map()))!
    expect(loaded.throttle?.calibration).toEqual({ ...L1, measuredIdle: true })
    const reconnected = mergePreset(loaded, tcaPresetFor([{ id: STICK, index: 0, axes: 10 }, { id: Q12, index: 1, axes: 7 }])!)
    expect(reconnected.throttle?.calibration).toEqual({ ...L1, measuredIdle: true })
    expect(reconnected.throttle2?.calibration).toEqual({ ...L2, measuredIdle: true })
  })

  it('does not take a position before the levers get there: REVERSE must be below IDLE, CL above it, and each detent above the last', () => {
    const r = rig()
    r.cal.start(0)
    restAt(r, L1.idle, L2.idle)
    hold(r, L1.idle, L2.idle, 3000)                       // still at idle when asked for reverse
    expect(r.cal.step?.label).toBe('FULL REVERSE')
    restAt(r, L1.min, L2.min)
    hold(r, L1.idle - 0.3, L2.idle - 0.3, 3000)           // CL asked, levers still in the reverse range
    expect(r.cal.step?.label).toBe('CL')
    hold(r, L1.cl, -0.7, 3000)                            // only ENG 1 has moved: both must be there
    expect(r.cal.step?.label).toBe('CL')
  })

  it('does not take IDLE from levers that were never moved after it was asked for (they may be resting anywhere)', () => {
    const r = rig()
    hold(r, 0.12, 0.1, 500)
    r.cal.start(r.t.now)
    hold(r, 0.12, 0.1, 5000)                                 // left at CL: not taken as IDLE
    expect(r.cal.step?.label).toBe('IDLE')
    restAt(r, L1.idle, L2.idle)
    expect(r.cal.step?.label).toBe('FULL REVERSE')
  })

  it('waits for the levers to rest: a lever still moving is not taken', () => {
    const r = rig()
    r.cal.start(0)
    for (let i = 0; i < 80; i++) hold(r, -0.9 + i * 0.02, -0.9 + i * 0.02, 50)   // swept slowly through the whole travel
    expect(r.cal.step?.label).toBe('IDLE')
  })

  it('Back takes the previous position again; Stop changes nothing', () => {
    const r = rig()
    const before = JSON.stringify(r.map())
    r.cal.start(0)
    restAt(r, L1.idle, L2.idle); restAt(r, L1.min, L2.min)
    expect(r.cal.step?.label).toBe('CL')
    r.cal.back(r.t.now); expect(r.cal.step?.label).toBe('FULL REVERSE')
    r.cal.stop(); expect(r.cal.active).toBe(false)
    expect(JSON.stringify(r.map())).toBe(before)
  })

  it('needs bound levers, and refuses positions that are not a lever (TOGA not above FLX)', () => {
    const empty = new ThrottleDetentCalibration(() => ({}), () => {})
    empty.start(0); expect(empty.active).toBe(false); expect(empty.message).toMatch(/No thrust lever is bound/)
    const r = rig()
    r.cal.start(0)
    for (const p of ['idle', 'min', 'cl', 'flex'] as const) restAt(r, L1[p], L2[p])
    restAt(r, L1.flex, L2.flex)                           // TOGA asked, levers left at FLX: never taken
    expect(r.cal.step?.label).toBe('TOGA')
  })
})

describe('without a detent calibration the lower 25% is still reverse', () => {
  it('a quadrant lever with no measured IDLE idles at a quarter of its travel', () => {
    const b = { pad: 0, axis: 0, sign: 1 as const, deviceId: Q12, calibration: { min: -1, max: 0.6, idle: -0.9, cl: 0.1 } }
    const c = throttleCalibration(b)!
    expect((c.idle! - c.min) / (c.max - c.min)).toBeCloseTo(0.25, 6)
  })
})
