/**
 * IO-360 + fixed-pitch prop (§5.1). Engine brake torque (throttle/RPM/density
 * via Gagg-Ferrar) balances against propeller torque Cp(J); RPM emerges
 * dynamically. Thrust from Ct(J): strongly negative past J₀ — a windmilling
 * prop is a big drag disc, which is what makes the POH glide ratio honest.
 * Mixture is a simple power factor until Phase 3's EGT/lean-assist model.
 *
 * Ct/Cp are piecewise-linear in advance ratio J, point-tuned so the §5.6
 * table passes: static thrust/RPM, Vy climb, 75% cruise, max level speed and
 * windmilling glide drag are all set by these two tables.
 */
import { C172S } from './aircraft/c172s'
import type { AircraftParams } from './aircraft/params'
import { RHO0 } from './atmosphere'

type PropTable = ReadonlyArray<readonly [number, number]>

function interp(table: PropTable, x: number): number {
  const first = table[0]!
  const last = table[table.length - 1]!
  if (x <= first[0]) return first[1]
  if (x >= last[0]) {
    // extrapolate last segment
    const prev = table[table.length - 2]!
    return last[1] + ((x - last[0]) / (last[0] - prev[0])) * (last[1] - prev[1])
  }
  for (let i = 1; i < table.length; i++) {
    const [x1, y1] = table[i]!
    const [x0, y0] = table[i - 1]!
    if (x <= x1) return y0 + ((x - x0) / (x1 - x0)) * (y1 - y0)
  }
  return last[1]
}

export const propCt = (J: number, table: PropTable = C172S.propCtTable): number => interp(table, J)
export const propCp = (J: number, table: PropTable = C172S.propCpTable): number => interp(table, J)

/** Governed-prop thrust from shaft power: η ramps with true advance ratio
 *  J = V/(nD) — props are inefficient at low J (η ≈ 0.65 in a Vy climb,
 *  0.85 by cruise) — capped by momentum-theory static thrust
 *  ~0.9·(2ρA·P²)^⅓. Shared by dynamics and the trim solver so both fly
 *  the same model. */
export function governedThrustN(shaftPowerW: number, vAxialMs: number, rho: number, dM: number, redlineRpm: number, etaScale = 1): number {
  if (shaftPowerW <= 0) return 0
  const v = Math.max(vAxialMs, 0.1)
  const j = v / ((redlineRpm / 60) * dM)
  // Per-type η scale: a worse prop scales its whole curve down (cap
  // 0.85·scale); a better one lifts the low-J ramp but NO propeller
  // converts more than ~88% of shaft power to thrust power, ever.
  const etaMax = Math.min(0.85 * etaScale, 0.88)
  const eta = Math.min(Math.max((0.4 + 0.5 * j) * etaScale, 0.25), etaMax)
  const diskA = (Math.PI * dM * dM) / 4
  const tStatic = 0.9 * Math.cbrt(2 * rho * diskA * shaftPowerW * shaftPowerW)
  return Math.min((eta * shaftPowerW) / v, tStatic)
}

export interface PropulsionState {
  omegaRadS: number
  fuelFlowKgS: number
  thrustN: number
  torqueNm: number // prop torque magnitude (reaction roll)
  shaftPowerW: number // brake power delivered
  rpm: number
}

export function makePropulsionState(rpm = 700): PropulsionState {
  return {
    omegaRadS: (rpm * Math.PI) / 30,
    fuelFlowKgS: 0,
    thrustN: 0,
    torqueNm: 0,
    shaftPowerW: 0,
    rpm,
  }
}

/** Gagg-Ferrar normally-aspirated power lapse with density ratio. */
export function densityPowerFactor(rho: number): number {
  const s = rho / RHO0
  return Math.max(s - (1 - s) / 7.55, 0)
}

function mixturePowerFactor(mixture: number): number {
  if (mixture > 0.5) return 1
  if (mixture < 0.12) return 0
  return (mixture - 0.12) / 0.38
}

/**
 * Brake torque at the crankshaft. The 180 hp rating is brake power, so no
 * separate friction is subtracted when producing power. Closed throttle: the
 * idle circuit holds ~700 RPM on the ground (governor fades above 950 RPM),
 * and above that a closed-throttle engine brakes (pumping losses) — that
 * resistance is what the windmilling-drag branch of Cp works against.
 */
export function engineBrakeTorque(throttle: number, rpm: number, rho: number, P: AircraftParams = C172S): number {
  // Flat-rated turboprops (12c): the core has thermoMargin× the flat
  // rating, so full power holds until Gagg–Ferrar eats the margin.
  const lapse = P.thermoMargin
    ? Math.min(1, P.thermoMargin * densityPowerFactor(rho))
    : densityPowerFactor(rho)
  const qFull = (P.ratedPowerW / P.ratedRadS) * lapse
  const thr = Math.min(Math.max(throttle, 0), 1)
  const idleGov = Math.min(Math.max((950 - rpm) / 200, 0), 1)
  // Idle circuit tops up low throttle; full throttle delivers full torque.
  const positive = qFull * (P.idleTorqueFraction * idleGov * (1 - thr) + thr)
  const pumping = (1 - thr) * (2 + 0.06 * rpm * (Math.PI / 30)) // closed-throttle braking
  return positive - pumping * Math.min(Math.max((rpm - 950) / 300, 0), 1)
}

export function stepPropulsion(
  st: PropulsionState,
  dt: number,
  throttle: number,
  mixture: number,
  rho: number,
  vAxialMs: number,
  fuelAvailable: boolean,
  P: AircraftParams = C172S,
  /** Intake power multiplier (carb ice / carb heat, Phase 11b). 1 = clear. */
  intakeFactor = 1,
): void {
  const D = P.propDiameterM

  // ---- Governed (constant-speed) prop (12c): the governor varies blade
  // pitch to hold redline RPM and absorb whatever the engine delivers —
  // Ct/Cp tables (fixed pitch by definition) cannot represent that.
  // Thrust = η(J)·P/V with a low-advance-ratio efficiency ramp and a
  // momentum-theory static cap. Documented simplifications: no prop
  // lever (always redline when running), feathered drag when dead. ----
  if (P.propGoverned) {
    const power = fuelAvailable ? mixturePowerFactor(mixture) * intakeFactor : 0
    const omegaRef = (P.redlineRpm * Math.PI) / 30
    if (power > 0) {
      st.omegaRadS = omegaRef
      const qE = Math.max(engineBrakeTorque(throttle, P.redlineRpm, rho, P) * power, 0)
      st.shaftPowerW = qE * omegaRef
      st.thrustN = governedThrustN(st.shaftPowerW, vAxialMs, rho, D, P.redlineRpm, P.propEtaScale ?? 1)
      st.torqueNm = qE
      st.fuelFlowKgS = Math.max(st.shaftPowerW, 0.05 * P.ratedPowerW) * P.bsfcKgPerWs
    } else {
      // Dead engine: prop feathers — a small drag disc, spool winds down.
      st.omegaRadS = Math.max(st.omegaRadS - 0.5 * omegaRef * dt, 0)
      st.thrustN = -0.02 * 0.5 * rho * vAxialMs * vAxialMs * ((Math.PI * D * D) / 4)
      st.torqueNm = 0
      st.shaftPowerW = 0
      st.fuelFlowKgS = 0
    }
    st.rpm = (st.omegaRadS * 30) / Math.PI
    return
  }

  const omega = Math.max(st.omegaRadS, 5)
  const n = omega / (2 * Math.PI)
  const J = Math.max(vAxialMs, 0) / Math.max(n * D, 0.1)

  const power = fuelAvailable ? mixturePowerFactor(mixture) * intakeFactor : 0
  const qEngine = engineBrakeTorque(throttle, st.rpm, rho, P) * (power > 0 ? power : 0)
    - (fuelAvailable ? 0 : 6 + 0.04 * omega) // dead-engine friction

  const cq = propCp(J, P.propCpTable) / (2 * Math.PI)
  const qProp = cq * rho * n * n * D ** 5

  st.omegaRadS = Math.max(omega + ((qEngine - qProp) / P.rotInertiaKgM2) * dt, 0)
  st.rpm = (st.omegaRadS * 30) / Math.PI

  st.thrustN = propCt(J, P.propCtTable) * rho * n * n * D ** 4
  st.torqueNm = Math.max(qProp, 0)
  st.shaftPowerW = Math.max(qEngine, 0) * st.omegaRadS
  st.fuelFlowKgS =
    fuelAvailable && power > 0
      ? Math.max(st.shaftPowerW, 0.05 * P.ratedPowerW) * P.bsfcKgPerWs
      : 0
}

/** Steady-state RPM for throttle/speed/density (bisection on torque balance). */
export function equilibriumRpm(throttle: number, vAxialMs: number, rho: number, P: AircraftParams = C172S): number {
  const D = P.propDiameterM
  let lo = 300
  // Governed props can never balance above redline (the governor coarsens
  // pitch); fixed-pitch keeps the legacy bracket bit-exactly.
  let hi = P.propGoverned ? P.redlineRpm * 1.001 : 3200
  for (let i = 0; i < 60; i++) {
    const rpm = (lo + hi) / 2
    const n = rpm / 60
    const J = Math.max(vAxialMs, 0) / Math.max(n * D, 0.1)
    const qEngine = engineBrakeTorque(throttle, rpm, rho, P)
    const qProp = (propCp(J, P.propCpTable) / (2 * Math.PI)) * rho * n * n * D ** 5
    if (qEngine - qProp > 0) lo = rpm
    else hi = rpm
  }
  return (lo + hi) / 2
}
