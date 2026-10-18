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
  /** FUEL LOW threshold for the ACTIVE type, kg total (9B): the C172
   *  constant warned an A380 at 36 kg and a glider permanently. Absent =
   *  the C172 default. */
  lowFuelKg?: number
  /** Load factor along the airplane's vertical axis (+ = pressed into the
   *  seat, − = thrown toward the ceiling). Feed starvation tracks this.
   *  Absent = 1 (no effect). */
  loadFactorG?: number
  /** Seconds of sustained negative g the type's fuel + oil system rides
   *  through before the engine quits (negativeGToleranceS). Absent or
   *  Infinity = never starves. */
  negGToleranceS?: number
}

/** Seconds of full negative-g exposure a type tolerates before fuel/oil
 *  feed fails. Modeled estimates — there is no published figure for most
 *  of the fleet — set from how the systems are built:
 *   - gravity-fed piston/turboprop wing tanks and wet-sump oil: ≈ 8 s,
 *     the "inverted for a few seconds and the engine quits" experience;
 *   - jets: boost pumps and scavenged oil buy ≈ 25 s;
 *   - aerobatic types with flop-tube fuel and inverted oil: unlimited. */
export function negativeGToleranceS(P: { jet?: unknown; invertedCapable?: boolean }): number {
  if (P.invertedCapable) return Infinity
  return P.jet ? 25 : 8
}

/** Exposure weight per second at a given load factor: nothing above 0.3 g
 *  (fuel still settles on the pickups), 0.3 at zero g (a pushover — slow
 *  to unport), ≈1.3 at −1 g (inverted: the tank bottoms are on top). */
export function negGExposureRate(nz: number): number {
  return Math.min(1.5, Math.max(0, 0.3 - nz))
}

export interface FuelState {
  leftKg: number
  rightKg: number
  boostPumpOn: boolean
  lowFuelFlag: boolean
  /** False = starvation: selector points at an empty tank (or OFF). */
  fuelFlowing: boolean
  /** Negative-g exposure accumulated, seconds (see negGExposureRate). */
  negGS: number
  /** True once exposure passed the type's tolerance: the feed is cut until
   *  positive g has fully restored it (exposure back to zero). */
  negGCut: boolean
  /** Internal: previous step's selector, used to detect tank-to-tank switches. */
  _lastSelector: FuelSelector | null
}

export function makeFuelState(leftKg = TANK_CAPACITY_KG, rightKg = TANK_CAPACITY_KG): FuelState {
  return { leftKg, rightKg, boostPumpOn: false, lowFuelFlag: false, fuelFlowing: false, negGS: 0, negGCut: false, _lastSelector: null }
}

const EMPTY_EPS = 1e-9

export function stepFuel(st: FuelState, dt: number, inp: FuelInputs): void {
  st.boostPumpOn = inp.boostPumpOn
  let demand = Math.max(inp.demandKgS, 0)

  // Negative-g feed starvation: gravity-fed pickups unport and the oil
  // pump loses suction when the airplane is inverted or pushed over. The
  // exposure builds with negative g, drains at twice that speed once the
  // seat is loaded again, and the cut releases only when it has fully
  // drained — an engine that quit stays out until the pilot restarts it.
  const tol = inp.negGToleranceS ?? Infinity
  const nz = inp.loadFactorG ?? 1
  if (Number.isFinite(tol)) {
    const rate = negGExposureRate(nz)
    if (rate > 0) st.negGS += rate * dt
    else if (nz >= 0.5) st.negGS = Math.max(0, st.negGS - 2 * dt)
    if (st.negGS >= tol) st.negGCut = true
    else if (st.negGS <= 0) st.negGCut = false
  } else { st.negGS = 0; st.negGCut = false }
  if (st.negGCut) demand = 0

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

  if (st.negGCut) st.fuelFlowing = false
  st.lowFuelFlag = st.leftKg + st.rightKg < (inp.lowFuelKg ?? LOW_FUEL_TOTAL_KG)
}
