import { describe, expect, it } from 'vitest'
import { makeElectricalState, stepElectrical, type ElectricalInputs } from '../../src/sim/systems/electrical'

const baseInputs: ElectricalInputs = {
  masterBattery: true,
  masterAlternator: true,
  avionicsSwitch: true,
  alternatorFailed: false,
  engineRunning: true,
}

describe('electrical system', () => {
  it('normal operation: alternator charges, bus sits near 28V', () => {
    const st = makeElectricalState()
    st.batteryAh -= 2 // slightly below full so charging is observable
    for (let i = 0; i < 60; i++) stepElectrical(st, 1, baseInputs)
    expect(st.busVoltage).toBeCloseTo(28.0, 1)
    expect(st.batteryAmps).toBeGreaterThan(0) // charging
    expect(st.mainBusPowered).toBe(true)
    expect(st.standbyBusPowered).toBe(true)
  })

  it('alternator failure drains the battery under load over time', () => {
    const st = makeElectricalState()
    const inp: ElectricalInputs = { ...baseInputs, alternatorFailed: true }
    const startAh = st.batteryAh
    for (let i = 0; i < 600; i++) stepElectrical(st, 1, inp) // 10 minutes
    expect(st.batteryAh).toBeLessThan(startAh)
    expect(st.batteryAmps).toBeLessThan(0) // discharging
    expect(st.busVoltage).toBeLessThan(28.0)
    expect(st.busVoltage).toBeGreaterThan(0)
  })

  it('G1000-equivalent load dies once battery is depleted while standby stays powered', () => {
    const st = makeElectricalState()
    const inp: ElectricalInputs = { ...baseInputs, alternatorFailed: true }
    let mainDiedAt = -1
    for (let i = 0; i < 20000 && st.batteryAh > 0; i++) {
      stepElectrical(st, 1, inp)
      if (mainDiedAt < 0 && !st.mainBusPowered) {
        mainDiedAt = i
        break // stop right at the load-shed point to check standby survives it
      }
    }
    expect(mainDiedAt).toBeGreaterThan(0) // main bus shed before full depletion
    expect(st.standbyBusPowered).toBe(true) // standby still alive at that point
    expect(st.batteryAh).toBeGreaterThan(0)

    // Keep draining until the battery is truly dead.
    for (let i = 0; i < 20000 && st.batteryAh > 0; i++) stepElectrical(st, 1, inp)
    expect(st.batteryAh).toBe(0)
    expect(st.mainBusPowered).toBe(false)
    expect(st.standbyBusPowered).toBe(false)
    expect(st.busVoltage).toBe(0)
  })

  it('master battery off: nothing powered regardless of alternator', () => {
    const st = makeElectricalState()
    stepElectrical(st, 1, { ...baseInputs, masterBattery: false })
    expect(st.busVoltage).toBe(0)
    expect(st.mainBusPowered).toBe(false)
    expect(st.standbyBusPowered).toBe(false)
  })
})
