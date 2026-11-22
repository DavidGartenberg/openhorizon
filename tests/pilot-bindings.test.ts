import { describe, expect, it } from 'vitest'
import { pilotBindings } from '../src/sim/pilot-bindings'
import { mergePreset, readButton, tcaPresetFor, throttleCalibration } from '../src/sim/gamepad-map'

const Q12 = 'TCA Q-Eng 1&2 (Vendor: 044f Product: 0407)', STICK = 'TCA Sidestick X Copilot (Vendor: 044f Product: 040f)'

describe("the pilot's saved bindings", () => {
  it('validate, and hold the gear lever, autobrake selector, red button and the thrust levers with their detents', () => {
    const m = pilotBindings()
    expect(m.btn?.gearLever).toMatchObject({ btn: 20, deviceId: Q12 })
    expect([m.btn?.autobrakeLow?.btn, m.btn?.autobrakeMedium?.btn, m.btn?.autobrake3?.btn, m.btn?.autobrakeMax?.btn]).toEqual([22, 23, 24, 25])
    expect(m.btn?.apDisconnect).toMatchObject({ btn: 3, deviceId: STICK })
    expect(m.throttle).toMatchObject({ axis: 0, sign: -1 }); expect(m.throttle2).toMatchObject({ axis: 1, sign: -1 })
    expect(throttleCalibration(m.throttle)?.measuredIdle).toBe(true)
  })

  it('survive the TCA preset being re-applied on connect, whatever order the devices come in', () => {
    for (const pads of [[{ id: STICK, index: 0, axes: 10 }, { id: Q12, index: 1, axes: 7 }], [{ id: Q12, index: 0, axes: 7 }, { id: STICK, index: 1, axes: 10 }]]) {
      const merged = mergePreset(pilotBindings(), tcaPresetFor(pads)!)
      expect(merged.btn?.gearLever?.btn).toBe(20)
      expect(merged.throttle?.calibration).toEqual(pilotBindings().throttle?.calibration)
      expect(merged.btn?.apDisconnect?.btn).toBe(3)
      const pressedRed = [{ id: STICK, index: 5, connected: true, axes: [], buttons: [0, 1, 2, 3].map((i) => ({ pressed: i === 3 })) }]
      expect(readButton(merged, 'apDisconnect', pressedRed)).toBe(true)
    }
  })

  it('a fresh copy every time (changing one does not change the next)', () => {
    const a = pilotBindings(); delete a.btn!.gearLever
    expect(pilotBindings().btn?.gearLever).toBeDefined()
  })
})
