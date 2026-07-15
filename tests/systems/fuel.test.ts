import { describe, expect, it } from 'vitest'
import { makeFuelState, stepFuel, TANK_CAPACITY_KG, type FuelInputs } from '../../src/sim/systems/fuel'

const demand = 0.005 // kg/s, representative cruise fuel flow

describe('fuel system', () => {
  it('selecting L only depletes the left tank, right stays full', () => {
    const st = makeFuelState()
    const inp: FuelInputs = { selector: 'L', boostPumpOn: false, demandKgS: demand }
    for (let i = 0; i < 100; i++) stepFuel(st, 1, inp)
    expect(st.leftKg).toBeLessThan(TANK_CAPACITY_KG)
    expect(st.rightKg).toBe(TANK_CAPACITY_KG)
    expect(st.fuelFlowing).toBe(true)
  })

  it('selecting R only depletes the right tank, left stays full', () => {
    const st = makeFuelState()
    const inp: FuelInputs = { selector: 'R', boostPumpOn: false, demandKgS: demand }
    for (let i = 0; i < 100; i++) stepFuel(st, 1, inp)
    expect(st.rightKg).toBeLessThan(TANK_CAPACITY_KG)
    expect(st.leftKg).toBe(TANK_CAPACITY_KG)
  })

  it('BOTH draws from both tanks and total burn matches demand', () => {
    const st = makeFuelState()
    const inp: FuelInputs = { selector: 'BOTH', boostPumpOn: false, demandKgS: demand }
    const startTotal = st.leftKg + st.rightKg
    for (let i = 0; i < 1000; i++) stepFuel(st, 1, inp)
    expect(st.leftKg).toBeLessThan(TANK_CAPACITY_KG)
    expect(st.rightKg).toBeLessThan(TANK_CAPACITY_KG)
    expect(st.leftKg).toBeCloseTo(st.rightKg, 6)
    const burned = startTotal - (st.leftKg + st.rightKg)
    expect(burned).toBeCloseTo(demand * 1000, 6)
  })

  it('starvation: selected tank running dry stops fuel flow', () => {
    const st = makeFuelState(0.02, TANK_CAPACITY_KG) // left nearly empty
    const inp: FuelInputs = { selector: 'L', boostPumpOn: false, demandKgS: demand }
    for (let i = 0; i < 10; i++) stepFuel(st, 1, inp)
    expect(st.leftKg).toBe(0)
    expect(st.fuelFlowing).toBe(false)
  })

  it('switching to a tank with fuel restores flow after starvation', () => {
    const st = makeFuelState(0, TANK_CAPACITY_KG) // left already empty
    stepFuel(st, 1, { selector: 'L', boostPumpOn: false, demandKgS: demand })
    expect(st.fuelFlowing).toBe(false)

    // The selector switch itself causes a one-step flow interruption without
    // the boost pump (see 'boost pump' describe block below); flow resumes
    // on the following step.
    stepFuel(st, 1, { selector: 'R', boostPumpOn: false, demandKgS: demand })
    stepFuel(st, 1, { selector: 'R', boostPumpOn: false, demandKgS: demand })
    expect(st.fuelFlowing).toBe(true)
    expect(st.rightKg).toBeLessThan(TANK_CAPACITY_KG)
  })

  it('OFF selector: no flow regardless of tank quantities', () => {
    const st = makeFuelState()
    stepFuel(st, 1, { selector: 'OFF', boostPumpOn: false, demandKgS: demand })
    expect(st.fuelFlowing).toBe(false)
    expect(st.leftKg).toBe(TANK_CAPACITY_KG)
    expect(st.rightKg).toBe(TANK_CAPACITY_KG)
  })

  it('low fuel flag trips when combined quantity is low', () => {
    const st = makeFuelState(2, 2)
    stepFuel(st, 1, { selector: 'BOTH', boostPumpOn: false, demandKgS: 0 })
    expect(st.lowFuelFlag).toBe(true)
    const full = makeFuelState()
    stepFuel(full, 1, { selector: 'BOTH', boostPumpOn: false, demandKgS: 0 })
    expect(full.lowFuelFlag).toBe(false)
  })

  describe('boost pump', () => {
    it('without the pump, switching tanks causes a one-step flow interruption', () => {
      const st = makeFuelState()
      stepFuel(st, 1, { selector: 'L', boostPumpOn: false, demandKgS: demand })
      expect(st.fuelFlowing).toBe(true)

      // Switch to a different fuel-supplying tank with the pump off.
      stepFuel(st, 1, { selector: 'R', boostPumpOn: false, demandKgS: demand })
      expect(st.fuelFlowing).toBe(false)

      // Flow resumes on the next step at the new selector.
      stepFuel(st, 1, { selector: 'R', boostPumpOn: false, demandKgS: demand })
      expect(st.fuelFlowing).toBe(true)
    })

    it('with the pump on, switching tanks does not interrupt flow', () => {
      const st = makeFuelState()
      stepFuel(st, 1, { selector: 'L', boostPumpOn: false, demandKgS: demand })
      expect(st.fuelFlowing).toBe(true)

      stepFuel(st, 1, { selector: 'R', boostPumpOn: true, demandKgS: demand })
      expect(st.fuelFlowing).toBe(true)
      expect(st.rightKg).toBeLessThan(TANK_CAPACITY_KG)
    })

    it('does not interrupt flow when the selector is unchanged', () => {
      const st = makeFuelState()
      stepFuel(st, 1, { selector: 'BOTH', boostPumpOn: false, demandKgS: demand })
      expect(st.fuelFlowing).toBe(true)
      stepFuel(st, 1, { selector: 'BOTH', boostPumpOn: false, demandKgS: demand })
      expect(st.fuelFlowing).toBe(true)
    })

    it('boostPumpOn is reflected on state', () => {
      const st = makeFuelState()
      stepFuel(st, 1, { selector: 'BOTH', boostPumpOn: true, demandKgS: demand })
      expect(st.boostPumpOn).toBe(true)
    })
  })
})
