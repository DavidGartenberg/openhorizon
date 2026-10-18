import { describe, expect, it } from 'vitest'
import { makeFuelState, stepFuel, TANK_CAPACITY_KG, type FuelInputs, negativeGToleranceS } from '../../src/sim/systems/fuel'

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

describe('negative-g fuel/oil feed starvation (gravity-fed airplanes cannot fly inverted)', () => {
  const run = (st: ReturnType<typeof makeFuelState>, seconds: number, nz: number, tol: number, dt = 0.05): void => {
    for (let t = 0; t < seconds; t += dt) stepFuel(st, dt, { selector: 'BOTH', boostPumpOn: false, demandKgS: 0.01, loadFactorG: nz, negGToleranceS: tol })
  }
  it('normal positive-g flight never starves', () => {
    const st = makeFuelState()
    run(st, 120, 1, 8)
    expect(st.fuelFlowing).toBe(true); expect(st.negGCut).toBe(false)
  })
  it('a brief pushover (<~tolerance) is tolerated; the same exposure sustained cuts the engine', () => {
    const st = makeFuelState()
    run(st, 3, -1, 8)
    expect(st.fuelFlowing).toBe(true) // 3 s inverted: fuel still in the lines
    run(st, 10, -1, 8)
    expect(st.fuelFlowing).toBe(false); expect(st.negGCut).toBe(true)
  })
  it('deeper negative g starves faster than zero g', () => {
    const inv = makeFuelState(), zero = makeFuelState()
    let tInv = -1, tZero = -1
    for (let t = 0; t < 120; t += 0.05) {
      stepFuel(inv, 0.05, { selector: 'BOTH', boostPumpOn: false, demandKgS: 0.01, loadFactorG: -1, negGToleranceS: 8 })
      stepFuel(zero, 0.05, { selector: 'BOTH', boostPumpOn: false, demandKgS: 0.01, loadFactorG: 0, negGToleranceS: 8 })
      if (tInv < 0 && inv.negGCut) tInv = t
      if (tZero < 0 && zero.negGCut) tZero = t
    }
    expect(tInv).toBeGreaterThan(4); expect(tInv).toBeLessThan(9)
    expect(tZero).toBeGreaterThan(tInv * 2)
  })
  it('fuel is not consumed while the feed is cut, and flow returns after positive g restores the feed', () => {
    const st = makeFuelState()
    run(st, 12, -1, 8)
    const left = st.leftKg + st.rightKg
    run(st, 3, -1, 8)
    expect(st.leftKg + st.rightKg).toBe(left)
    run(st, 10, 1, 8)
    expect(st.negGCut).toBe(false); expect(st.fuelFlowing).toBe(true)
  })
  it('inverted-capable types and a missing tolerance are never starved', () => {
    const a = makeFuelState(), b = makeFuelState()
    run(a, 300, -1, Infinity)
    for (let t = 0; t < 300; t += 0.05) stepFuel(b, 0.05, { selector: 'BOTH', boostPumpOn: false, demandKgS: 0.01 })
    expect(a.fuelFlowing).toBe(true); expect(b.fuelFlowing).toBe(true)
  })
  it('tolerance scales with the type: jets outlast gravity-fed pistons', () => {
    expect(negativeGToleranceS({ jet: true })).toBeGreaterThan(negativeGToleranceS({}))
    expect(negativeGToleranceS({ invertedCapable: true })).toBe(Infinity)
    expect(negativeGToleranceS({ jet: true, invertedCapable: true })).toBe(Infinity)
  })
})
