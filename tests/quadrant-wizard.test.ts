import { describe, expect, it } from 'vitest'
import { AXIS_SETTLE_ANYWHERE_MS, AXIS_SETTLE_MS, CONFIRM_MS, QUADRANT_STEPS, QuadrantWizard, STICK_STEPS, THROTTLE_STEPS } from '../src/input/quadrant-wizard'
import { calibratedUnipolar, readAxis, readButton, type GamepadMap, type PadReading } from '../src/sim/gamepad-map'

const QUAD_ID = 'TCA Q-Eng 1&2 (Vendor: 044f Product: 0407)'
const STICK_ID = 'TCA Sidestick X Copilot (Vendor: 044f Product: 040f)'

/** A scripted device: axes at rest (the measured quadrant: -1,-1,-1,0,0,-1,0) and 31 buttons up. */
function pad(index: number, id: string, axes: number[], down: number[] = [], buttons = 31): PadReading {
  return { id, index, connected: true, axes, buttons: Array.from({ length: buttons }, (_, i) => ({ pressed: down.includes(i) })) }
}
const stick = (down: number[] = [], axes: number[] = new Array(10).fill(0)): PadReading => pad(0, STICK_ID, axes, down, 22)
const quad = (axes: number[], down: number[] = []): PadReading => pad(1, QUAD_ID, axes, down)
const REST = [-1, -1, -1, 0, 0, -1, 0]
const withAxis = (a: number, v: number): number[] => REST.map((r, i) => (i === a ? v : r))

function rig(initial: GamepadMap = {}): { map: GamepadMap; w: QuadrantWizard; t: { now: number } } {
  const holder = { map: initial }
  const w = new QuadrantWizard(() => holder.map, (m) => { holder.map = m })
  return { get map() { return holder.map }, w, t: { now: 0 } } as { map: GamepadMap; w: QuadrantWizard; t: { now: number } }
}

/** Feed the same pads for `ms` of wizard time in 50 ms polls. */
function hold(r: ReturnType<typeof rig>, pads: PadReading[], ms: number): void {
  for (let e = 0; e < ms; e += 50) { r.t.now += 50; r.w.poll(pads, r.t.now) }
}
const settle = (r: ReturnType<typeof rig>, pads: PadReading[]): void => hold(r, pads, CONFIRM_MS + 100)

describe('guided quadrant binding: axes', () => {
  const base = { throttle: { pad: 1, axis: 0, sign: 1 as const, deviceId: QUAD_ID }, throttle2: { pad: 1, axis: 1, sign: 1 as const, deviceId: QUAD_ID } }

  it('binds the speed brake to the axis that moves, with the travel it was moved through, and goes on to the flaps', () => {
    const r = rig({ ...base })
    const pads = [stick(), quad(REST)]
    r.w.start(pads, true)
    expect(r.w.step?.fn).toBe('speedbrake')
    hold(r, pads, 200)
    for (const v of [-0.6, -0.1, 0.4, 0.9, 1]) hold(r, [stick(), quad(withAxis(2, v))], 100)        // pulled to full
    expect(r.map.speedbrake).toBeUndefined()                                                          // still moving
    hold(r, [stick(), quad(withAxis(2, 1))], AXIS_SETTLE_MS + 100)                                    // and let go
    expect(r.map.speedbrake).toMatchObject({ pad: 1, axis: 2, sign: 1, deviceId: QUAD_ID, source: 'user', calibration: { min: -1, max: 1 } })
    expect(readAxis(r.map, 'speedbrake', [stick(), quad(withAxis(2, 1))])).toBeCloseTo(1, 6)
    expect(calibratedUnipolar(readAxis(r.map, 'speedbrake', [stick(), quad(withAxis(2, 0))])!, r.map.speedbrake)).toBeCloseTo(0.5, 6)
    settle(r, [stick(), quad(withAxis(2, 1))])
    expect(r.w.step?.fn).toBe('flaps')
  })

  it('takes the direction the lever was first moved as the positive one: a lever that rests at +1 gets sign −1', () => {
    const r = rig({ ...base })
    const pads = [stick(), quad(withAxis(2, 1))]
    r.w.start(pads, true); hold(r, pads, 100)
    for (const v of [0.4, -0.2, -0.8, -1]) hold(r, [stick(), quad(withAxis(2, v))], 100)
    hold(r, [stick(), quad(withAxis(2, -1))], AXIS_SETTLE_MS + 100)
    expect(r.map.speedbrake).toMatchObject({ axis: 2, sign: -1, calibration: { min: -1, max: 1 } })
  })

  it('records the whole travel when the lever is taken out and brought back, so a lever started mid-way still gets its low end', () => {
    const r = rig({ ...base })
    const pads = [stick(), quad(withAxis(5, -0.3))]
    r.w.start(pads, true)
    r.w.skip(pads)                                                    // → flaps
    expect(r.w.step?.fn).toBe('flaps')
    for (const v of [0.2, 0.7, 1, 0.2, -0.8, -1]) hold(r, [stick(), quad(withAxis(5, v))], 120)
    hold(r, [stick(), quad(withAxis(5, -1))], AXIS_SETTLE_MS + 100)
    expect(r.map.flaps).toMatchObject({ axis: 5, sign: 1, calibration: { min: -1, max: 1 } })
  })

  it('a lever that rests a second or two at each detent on the way is not finished until it reaches an end (or stays put for good)', () => {
    const r = rig({ ...base })
    const pads = [stick(), quad(REST)]
    r.w.start(pads, true); r.w.skip(pads)                              // → flaps
    for (const v of [-0.5, -0.1, 0.4, 0.9]) hold(r, [stick(), quad(withAxis(5, v))], 2000)   // dwells at the detents
    expect(r.map.flaps).toBeUndefined()
    hold(r, [stick(), quad(withAxis(5, 1))], AXIS_SETTLE_MS + 100)    // the end
    expect(r.map.flaps).toMatchObject({ axis: 5, calibration: { min: -1, max: 1 } })

    const q = rig({ ...base })                                          // a lever whose travel stops short of the axis end
    q.w.start(pads, true)
    for (const v of [-0.6, 0, 0.6]) hold(q, [stick(), quad(withAxis(2, v))], 150)
    hold(q, [stick(), quad(withAxis(2, 0.6))], AXIS_SETTLE_ANYWHERE_MS + 100)
    expect(q.map.speedbrake).toMatchObject({ axis: 2, calibration: { min: -1, max: 0.6 } })
  })

  it('ignores the sidestick and any axis already bound to something else (the throttle levers), and a small wobble', () => {
    const r = rig({ ...base })
    const pads = [stick(), quad(REST)]
    r.w.start(pads, true); hold(r, pads, 100)
    hold(r, [stick([], [1, 1, 1, 1, 1, 1, 1, 1, 1, 1]), quad(REST)], 400)                         // the stick swings fully: nothing
    hold(r, [stick(), quad(withAxis(0, 1))], AXIS_SETTLE_MS + 400)                                // ENG 1 lever: already bound
    hold(r, [stick(), quad(withAxis(2, -0.9))], AXIS_SETTLE_MS + 400)                             // 0.1: below the threshold
    expect(r.map.speedbrake).toBeUndefined()
    for (const v of [0, 1]) hold(r, [stick(), quad(withAxis(2, v))], 100)
    hold(r, [stick(), quad(withAxis(2, 1))], AXIS_SETTLE_MS + 100)
    expect(r.map.speedbrake?.axis).toBe(2)
  })

  it('does not bind an axis twice: the flaps lever cannot take the speed brake axis', () => {
    const r = rig({ ...base })
    const pads = [stick(), quad(REST)]
    r.w.start(pads, true)
    for (const v of [0, 1]) hold(r, [stick(), quad(withAxis(2, v))], 100)
    hold(r, [stick(), quad(withAxis(2, 1))], AXIS_SETTLE_MS + 100); settle(r, [stick(), quad(withAxis(2, 1))])
    expect(r.w.step?.fn).toBe('flaps')
    hold(r, [stick(), quad(withAxis(2, -1))], 1500)                                               // the speed brake lever comes back: not the flaps
    expect(r.map.flaps).toBeUndefined()
    for (const v of [-0.3, 0.5, 1]) hold(r, [stick(), quad(withAxis(5, v))], 100)
    hold(r, [stick(), quad(withAxis(5, 1))], AXIS_SETTLE_MS + 100)
    expect(r.map.flaps?.axis).toBe(5)
  })
})

describe('guided quadrant binding: buttons and switches', () => {
  const stepsTo = (r: ReturnType<typeof rig>, fn: string, pads: PadReading[]): void => { while (r.w.step && r.w.step.fn !== fn) r.w.skip(pads) }

  it('binds the button pressed, not one on the sidestick, and moves on after the confirmation', () => {
    const r = rig()
    const pads = [stick(), quad(REST)]
    r.w.start(pads, true); stepsTo(r, 'gearLever', pads)
    hold(r, [stick([3]), quad(REST)], 300)                                                         // a stick button: nothing
    expect(r.map.btn?.gearLever).toBeUndefined()
    hold(r, [stick(), quad(REST, [12])], 100)
    expect(r.map.btn?.gearLever).toMatchObject({ pad: 1, btn: 12, deviceId: QUAD_ID, source: 'user' })
    expect(r.w.step?.fn).toBe('gearLever')
    hold(r, [stick(), quad(REST, [12])], CONFIRM_MS + 100)
    expect(r.w.step?.fn).toBe('autobrakeLow')
    expect(readButton(r.map, 'gearLever', [stick(), quad(REST, [12])])).toBe(true)
  })

  it('a button that was down when its step began has to be released and pressed again (a latched switch)', () => {
    const r = rig()
    const rest = [stick(), quad(REST, [8, 12, 26])]                                                // the measured resting state
    r.w.start(rest, true); stepsTo(r, 'parkingBrake', rest)
    hold(r, rest, 400)
    expect(r.map.btn?.parkingBrake).toBeUndefined()
    hold(r, [stick(), quad(REST, [12, 26])], 100)                                                  // switched off: 8 up
    expect(r.map.btn?.parkingBrake).toBeUndefined()
    hold(r, [stick(), quad(REST, [8, 12, 26])], 100)                                               // and on again
    expect(r.map.btn?.parkingBrake).toMatchObject({ btn: 8 })
  })

  it('a control already given to one function is not offered to the next, and the previous step\'s held button does not carry over', () => {
    const r = rig()
    const pads = [stick(), quad(REST)]
    r.w.start(pads, true); stepsTo(r, 'ignitionCrank', pads)
    hold(r, [stick(), quad(REST, [20])], 100)                                                      // CRANK → 20
    expect(r.map.btn?.ignitionCrank?.btn).toBe(20)
    hold(r, [stick(), quad(REST, [20])], CONFIRM_MS + 100)                                         // still held when NORM begins
    expect(r.w.step?.fn).toBe('ignitionNorm')
    hold(r, [stick(), quad(REST, [20])], 500)
    expect(r.map.btn?.ignitionNorm).toBeUndefined()
    hold(r, [stick(), quad(REST, [21])], 100)                                                      // selector turned: 20 released, 21 down
    expect(r.map.btn?.ignitionNorm?.btn).toBe(21)
    expect(r.map.btn?.ignitionCrank?.btn).toBe(20)
  })

  it('a button used by another function (a reverse lift) cannot be taken', () => {
    const r = rig({ btn: { reverse: { pad: 1, btn: 0, deviceId: QUAD_ID, source: 'preset' } } })
    const pads = [stick(), quad(REST)]
    r.w.start(pads, true); stepsTo(r, 'autobrakeLow', pads)
    hold(r, [stick(), quad(REST, [0])], 400)
    expect(r.map.btn?.autobrakeLow).toBeUndefined()
    expect(r.map.btn?.reverse?.btn).toBe(0)
  })

  it('takes over a button that only carried a key alias and drops that alias, so the press is not also a keystroke', () => {
    const r = rig({ devices: { 1: QUAD_ID }, btnKeys: { '1:9': 'KeyB', '1:14': 'KeyR' } })
    const pads = [stick(), quad(REST)]
    r.w.start(pads, true); stepsTo(r, 'autobrakeMax', pads)
    hold(r, [stick(), quad(REST, [9])], 100)
    expect(r.map.btn?.autobrakeMax?.btn).toBe(9)
    expect(r.map.btnKeys?.['1:9']).toBeUndefined()
    expect(r.map.btnKeys?.['1:14']).toBe('KeyR')
  })
})

describe('guided quadrant binding: the pass as a whole', () => {
  it('leaves out the detent buttons of a lever whose axis was bound, and asks only about what is unbound unless told otherwise', () => {
    const r = rig({ throttle: { pad: 1, axis: 0, sign: 1, deviceId: QUAD_ID }, btn: { gearLever: { pad: 1, btn: 3, deviceId: QUAD_ID, source: 'user' } } })
    const pads = [stick(), quad(REST)]
    r.w.start(pads, true)
    const asked: string[] = []
    const seen = new Set<string>()
    // bind both axes, then record every step that follows
    for (const v of [0, 1]) hold(r, [stick(), quad(withAxis(2, v))], 100)
    hold(r, [stick(), quad(withAxis(2, 1))], AXIS_SETTLE_MS + CONFIRM_MS + 200)
    for (const v of [0, 1]) hold(r, [stick(), quad(withAxis(5, v))], 100)
    hold(r, [stick(), quad(withAxis(5, 1))], AXIS_SETTLE_MS + CONFIRM_MS + 200)
    while (r.w.step) { const f = r.w.step.fn; if (seen.has(f)) break; seen.add(f); asked.push(f); r.w.skip(pads) }
    expect(asked).toContain('speedbrakeArm')
    expect(asked).not.toContain('flaps0'); expect(asked).not.toContain('flapsFull'); expect(asked).not.toContain('speedbrakeDown')
    expect(asked).not.toContain('gearLever')                                                          // already bound
    expect(asked).toContain('autobrakeLow')
    const all = rig({ btn: { gearLever: { pad: 1, btn: 3, deviceId: QUAD_ID, source: 'user' } } })
    all.w.start(pads, false)
    let n = 0; while (all.w.step && n++ < 99) { if (all.w.step.fn === 'gearLever') break; all.w.skip(pads) }
    expect(all.w.step?.fn).toBe('gearLever')
  })

  it('waits for the quadrant to appear (the browser lists a device only after it is touched) and skip / back / stop work', () => {
    const r = rig()
    r.w.start([stick()], true)
    hold(r, [stick([1])], 300)
    expect(r.w.message).toMatch(/No TCA quadrant/)
    expect(r.map.btn).toBeUndefined()
    const pads = [stick(), quad(REST)]
    r.w.skip(pads); expect(r.w.step?.fn).toBe('flaps')
    r.w.back(pads); expect(r.w.step?.fn).toBe('speedbrake')
    r.w.back(pads); expect(r.w.step?.fn).toBe('speedbrake')
    r.w.stop(); expect(r.w.active).toBe(false); expect(r.w.step).toBeNull()
  })

  it('every step is a function the simulator can act on, and each is asked for once', () => {
    const keys = QUADRANT_STEPS.map((s) => `${s.kind}:${s.fn}`)
    expect(new Set(keys).size).toBe(keys.length)
    for (const need of ['axis:speedbrake', 'axis:flaps', 'button:speedbrakeArm', 'button:gearLever', 'button:parkingBrake', 'button:engineMaster1', 'button:engineMaster2', 'button:ignitionCrank', 'button:ignitionNorm', 'button:ignitionStart', 'button:rudderTrimLeft', 'button:rudderTrimRight', 'button:rudderTrimReset', 'button:autobrakeLow', 'button:autobrakeMedium', 'button:autobrakeMax']) expect(keys).toContain(need)
  })

  it('finishes and says how many it bound', () => {
    const r = rig()
    const pads = [stick(), quad(REST)]
    r.w.start(pads, true)
    for (let i = 0; i < 40 && r.w.active; i++) r.w.skip(pads)
    expect(r.w.active).toBe(false); expect(r.w.message).toMatch(/finished: 0 controls bound/)
  })
})

describe('guided binding of the throttles, the reverse lifts and the red button', () => {
  const Q34 = 'TCA Q-Eng 3&4 (Vendor: 044f Product: 0408)'
  const q34 = (axes: number[], down: number[] = []): PadReading => pad(0, Q34, axes, down)
  const q12 = (axes: number[], down: number[] = []): PadReading => pad(2, QUAD_ID, axes, down)

  it('re-binds both thrust levers to the unit whose lever moves, with the lower quarter as reverse, replacing a binding on the 3&4 unit', () => {
    const stale: GamepadMap = { throttle: { pad: 0, axis: 0, sign: 1, deviceId: Q34, source: 'user', calibration: { min: -0.5, max: 0.625, idle: -0.21875 } }, throttle2: { pad: 0, axis: 1, sign: 1, deviceId: Q34, source: 'user' } }
    const r = rig(stale)
    const pads = [q34(REST), stick(), q12(REST)]
    r.w.start(pads, false, THROTTLE_STEPS)
    expect(r.w.step?.fn).toBe('throttle')
    for (const v of [-0.7, 0, 0.7, 1]) hold(r, [q34(REST), stick(), q12(withAxis(0, v))], 100)
    hold(r, [q34(REST), stick(), q12(withAxis(0, 1))], AXIS_SETTLE_MS + 100)
    expect(r.map.throttle).toMatchObject({ axis: 0, deviceId: QUAD_ID, sign: 1, calibration: { min: -1, max: 1, idle: -0.5 } })
    settle(r, [q34(REST), stick(), q12(withAxis(0, 1))])
    expect(r.w.step?.fn).toBe('throttle2')
    hold(r, [q34(REST), stick(), q12(withAxis(0, 1))], 300)                                  // lever 1 is still forward: taken, not offered again
    for (const v of [-0.6, 0.2, 1]) hold(r, [q34(REST), stick(), q12(REST.map((x, i) => (i === 1 ? v : i === 0 ? 1 : x)))], 100)
    hold(r, [q34(REST), stick(), q12(REST.map((x, i) => (i === 1 ? 1 : i === 0 ? 1 : x)))], AXIS_SETTLE_MS + 100)
    expect(r.map.throttle2).toMatchObject({ axis: 1, deviceId: QUAD_ID })
    expect(readAxis(r.map, 'throttle', [q34(REST), stick(), q12(withAxis(0, 1))])).toBe(1)
  })

  it('asks for the two thrust levers only (their reverse is their travel), and binds the red button on the sidestick only', () => {
    expect(THROTTLE_STEPS.map((x) => x.fn)).toEqual(['throttle', 'throttle2'])
    const pads = [stick(), q12(REST)]
    const red = rig({ btn: { apDisconnect: { pad: 0, btn: 1, deviceId: STICK_ID, source: 'preset' } } })
    red.w.start(pads, false, STICK_STEPS)
    expect(red.w.step?.fn).toBe('apDisconnect')
    hold(red, [stick(), q12(REST, [0, 5])], 300)                                             // quadrant buttons: ignored
    expect(red.map.btn?.apDisconnect?.btn).toBe(1)
    hold(red, [stick([4]), q12(REST)], 100)                                                  // the red button turns out to be 4 on this unit
    expect(red.map.btn?.apDisconnect).toMatchObject({ btn: 4, deviceId: STICK_ID, source: 'user' })
    expect(readButton(red.map, 'apDisconnect', [stick([4]), q12(REST)])).toBe(true)
  })
})
