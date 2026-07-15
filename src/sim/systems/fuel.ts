/**
 * Fuel system (Phase 3 §8): two 26.5 US gal tanks (L/R, per task spec),
 * a 4-position selector (L/R/BOTH/OFF), and a boost pump. Pure state +
 * step function, no three.js/DOM (§4.1).
 *
 * Gravity-feed imbalance: selecting a single tank draws only from that
 * tank; if the selected tank runs dry, fuel flow to the engine stops
 * (starvation) even if the other tank is full — mirrors the real POH
 * "fuel starvation" emergency procedure, whose fix is switching the
 * selector to a tank that still has fuel. BOTH draws evenly from each
 * tank while both have fuel, then continues from whichever tank remains.
 *
 * Units: internal quantities in kg (matches `Aircraft.fuelKg` / the
 * existing `C172S.fuelCapacityKg` convention in c172s.ts, which is
 * "53 US gal usable @ 6 lb/gal"); L/R capacity is exposed in both kg and
 * gal for cockpit gauges.
 */

const LB_PER_GAL = 6 // avgas, matches the constant used in c172s.ts
const KG_PER_LB = 0.45359237
export const TANK_CAPACITY_GAL = 26.5 // per task spec (53 gal total / 2 tanks)
export const TANK_CAPACITY_KG = TANK_CAPACITY_GAL * LB_PER_GAL * KG_PER_LB // ≈72.1 kg/tank

// Low-fuel annunciation threshold. Not a POH-published number in this repo;
// picked as a conservative "just over 1/4 tank combined" warning point.
const LOW_FUEL_TOTAL_KG = 0.25 * TANK_CAPACITY_KG * 2

export type FuelSelector = 'L' | 'R' | 'BOTH' | 'OFF'

export interface FuelInputs {
  selector: FuelSelector
  boostPumpOn: boolean
  /** Engine fuel-flow demand, kg/s (from PropulsionState.fuelFlowKgS). */
  demandKgS: number
}

export interface FuelState {
  leftKg: number
  rightKg: number
  boostPumpOn: boolean
  lowFuelFlag: boolean
  /** False = starvation: selector points at an empty tank (or OFF). */
  fuelFlowing: boolean
}

export function makeFuelState(leftKg = TANK_CAPACITY_KG, rightKg = TANK_CAPACITY_KG): FuelState {
  return { leftKg, rightKg, boostPumpOn: false, lowFuelFlag: false, fuelFlowing: false }
}

const EMPTY_EPS = 1e-9

export function stepFuel(st: FuelState, dt: number, inp: FuelInputs): void {
  st.boostPumpOn = inp.boostPumpOn
  const demand = Math.max(inp.demandKgS, 0)

  switch (inp.selector) {
    case 'OFF': {
      st.fuelFlowing = false
      break
    }
    case 'L': {
      if (st.leftKg > EMPTY_EPS) {
        st.leftKg = Math.max(st.leftKg - demand * dt, 0)
        st.fuelFlowing = true
      } else {
        st.fuelFlowing = false
      }
      break
    }
    case 'R': {
      if (st.rightKg > EMPTY_EPS) {
        st.rightKg = Math.max(st.rightKg - demand * dt, 0)
        st.fuelFlowing = true
      } else {
        st.fuelFlowing = false
      }
      break
    }
    case 'BOTH': {
      const haveL = st.leftKg > EMPTY_EPS
      const haveR = st.rightKg > EMPTY_EPS
      if (haveL && haveR) {
        st.leftKg = Math.max(st.leftKg - demand * 0.5 * dt, 0)
        st.rightKg = Math.max(st.rightKg - demand * 0.5 * dt, 0)
        st.fuelFlowing = true
      } else if (haveL) {
        st.leftKg = Math.max(st.leftKg - demand * dt, 0)
        st.fuelFlowing = true
      } else if (haveR) {
        st.rightKg = Math.max(st.rightKg - demand * dt, 0)
        st.fuelFlowing = true
      } else {
        st.fuelFlowing = false
      }
      break
    }
  }

  st.lowFuelFlag = st.leftKg + st.rightKg < LOW_FUEL_TOTAL_KG
}
