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
 *
 * Boost pump: real POH guidance (light singles with electric boost pumps,
 * e.g. Cessna/Lycoming-family aircraft) is to switch the boost pump ON
 * during tank-selector changes, because the engine-driven pump can
 * momentarily lose prime/pressure while the selector valve is mid-transition
 * between tanks, causing a brief flow hiccup. That's the one concrete,
 * testable effect modeled here: switching the selector to a *different*
 * fuel-supplying position (L/R/BOTH → a different one of those) causes a
 * one-step flow interruption on the step of the switch, unless the boost
 * pump is on, in which case the pump backs up the engine-driven pump and
 * flow continues uninterrupted through the switch. This does not model
 * turbulence/unporting (no such model exists yet in this file) — see
 * `stepFuel` for the exact mechanism.
 */

const LB_PER_GAL = 6 // avgas, matches the constant used in c172s.ts
const KG_PER_LB = 0.45359237
export const TANK_CAPACITY_GAL = 26.5 // per task spec (53 gal total / 2 tanks)
export const TANK_CAPACITY_KG = TANK_CAPACITY_GAL * LB_PER_GAL * KG_PER_LB // ≈72.1 kg/tank

// Low-fuel annunciation threshold. Not a POH-published number in this repo;
// picked as a conservative "just over 1/4 tank combined" warning point.
const LOW_FUEL_TOTAL_KG = 0.25 * TANK_CAPACITY_KG * 2

/** Fuel mass (kg) -> volume (US gal), avgas @ 6 lb/gal — the same conversion
 *  this file uses internally for `TANK_CAPACITY_KG`, exposed for cockpit
 *  gauges (MFD fuel-qty display) so they don't reinvent the constants. */
export function kgToGal(kg: number): number {
  return kg / KG_PER_LB / LB_PER_GAL
}

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
  /** Internal: previous step's selector, used to detect tank-to-tank switches. */
  _lastSelector: FuelSelector | null
}

export function makeFuelState(leftKg = TANK_CAPACITY_KG, rightKg = TANK_CAPACITY_KG): FuelState {
  return { leftKg, rightKg, boostPumpOn: false, lowFuelFlag: false, fuelFlowing: false, _lastSelector: null }
}

const EMPTY_EPS = 1e-9

export function stepFuel(st: FuelState, dt: number, inp: FuelInputs): void {
  st.boostPumpOn = inp.boostPumpOn
  const demand = Math.max(inp.demandKgS, 0)

  // Tank-selector transition: switching between two fuel-supplying
  // positions (L/R/BOTH) causes a one-step flow interruption unless the
  // boost pump is on to back up the engine-driven pump through the switch.
  // See file-header comment for the POH rationale. A transition into/out of
  // OFF isn't a "switch" in this sense (no flow to interrupt on the OFF side).
  const switchedTank =
    st._lastSelector !== null &&
    st._lastSelector !== 'OFF' &&
    inp.selector !== 'OFF' &&
    st._lastSelector !== inp.selector
  st._lastSelector = inp.selector
  // With the boost pump on, switchedTank is still true but interrupted is
  // false — the pump is what "bridges" the switch, so normal flow logic
  // below runs uninterrupted.
  const interrupted = switchedTank && !inp.boostPumpOn

  switch (inp.selector) {
    case 'OFF': {
      st.fuelFlowing = false
      break
    }
    case 'L': {
      if (interrupted) {
        st.fuelFlowing = false
      } else if (st.leftKg > EMPTY_EPS) {
        st.leftKg = Math.max(st.leftKg - demand * dt, 0)
        st.fuelFlowing = true
      } else {
        st.fuelFlowing = false
      }
      break
    }
    case 'R': {
      if (interrupted) {
        st.fuelFlowing = false
      } else if (st.rightKg > EMPTY_EPS) {
        st.rightKg = Math.max(st.rightKg - demand * dt, 0)
        st.fuelFlowing = true
      } else {
        st.fuelFlowing = false
      }
      break
    }
    case 'BOTH': {
      if (interrupted) {
        st.fuelFlowing = false
        break
      }
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
