/**
 * Trim solver (§5.5): given TAS, altitude, and either flight-path angle γ
 * (solve for throttle) or throttle (solve for γ), find α, δe, and the third
 * unknown such that longitudinal accelerations vanish. Damped Newton with
 * numeric Jacobian over the same force model the sim flies with. Lateral
 * trim assumed neutral (symmetric flight).
 */
import { C172S, flapInterp } from './aircraft/c172s'
import type { AircraftParams } from './aircraft/params'
import { computeAero, makeAeroOutput, type AeroInput } from './aero'
import { propCt, propCp, engineBrakeTorque, equilibriumRpm } from './propulsion'
import { isa, G } from './atmosphere'

export interface TrimResult {
  converged: boolean
  alphaRad: number
  elevatorRad: number
  throttle: number
  gammaRad: number
  rpm: number
  thrustN: number
  shaftPowerW: number
  residual: number
}

export interface TrimSpec {
  tasMs: number
  altM: number
  massKg: number
  flapsDeg: number
  /** Provide exactly one of gammaRad (solve throttle) or throttle (solve γ). */
  gammaRad?: number
  throttle?: number
  /** Aircraft to trim (fleet, Phase 10a); defaults to the C172S. */
  params?: AircraftParams
}

interface Propelled {
  thrustN: number
  torqueNm: number
  rpm: number
  powerW: number
}

function propAt(throttle: number, vAxial: number, rho: number, P: AircraftParams): Propelled {
  const D = P.propDiameterM
  const rpm = equilibriumRpm(throttle, vAxial, rho, P)
  const n = rpm / 60
  const J = Math.max(vAxial, 0) / Math.max(n * D, 0.1)
  const thrust = propCt(J, P.propCtTable) * rho * n * n * D ** 4
  const torque = Math.max((propCp(J, P.propCpTable) / (2 * Math.PI)) * rho * n * n * D ** 5, 0)
  const omega = (rpm * Math.PI) / 30
  const qEng = Math.max(engineBrakeTorque(throttle, rpm, rho, P), 0)
  return { thrustN: thrust, torqueNm: torque, rpm, powerW: qEng * omega }
}

/**
 * Residuals of steady symmetric flight in wind axes:
 *  fx: T·cosα − D − W·sinγ   (along flight path)
 *  fz: L + T·sinα − W·cosγ   (normal to flight path)
 *  m:  pitching moment
 */
function residuals(
  s: TrimSpec, alpha: number, elevator: number, throttle: number, gamma: number,
  aeroOut = makeAeroOutput(),
): { fx: number; fz: number; m: number; prop: Propelled } {
  const P = s.params ?? C172S
  const air = isa(s.altM)
  const rho = air.densityKgM3
  const W = s.massKg * G
  const prop = propAt(throttle, s.tasMs * Math.cos(alpha), rho, P)

  const ai: AeroInput = {
    rho, vAir: s.tasMs, alpha, beta: 0, alphaDot: 0, p: 0, q: 0, r: 0,
    elevatorRad: elevator, aileronRad: 0, rudderRad: 0, flapsDeg: s.flapsDeg,
    thrustN: prop.thrustN, propTorqueNm: prop.torqueNm, heightAglM: 1000,
  }
  computeAero(ai, aeroOut, P)
  const qS = 0.5 * rho * s.tasMs * s.tasMs * P.wingAreaM2
  const Lift = qS * aeroOut.cl
  const Drag = qS * aeroOut.cd
  return {
    fx: prop.thrustN * Math.cos(alpha) - Drag - W * Math.sin(gamma),
    fz: Lift + prop.thrustN * Math.sin(alpha) - W * Math.cos(gamma),
    m: aeroOut.moment.y,
    prop,
  }
}

export function trim(spec: TrimSpec): TrimResult {
  const P = spec.params ?? C172S
  const solveThrottle = spec.gammaRad !== undefined
  let alpha = 0.03
  let elevator = 0
  let third = solveThrottle ? 0.5 : -0.05 // throttle or gamma initial guess
  const W = spec.massKg * G
  const scale = { fx: W, fz: W, m: W * P.chordM }
  const out = makeAeroOutput()

  let residual = Infinity
  for (let iter = 0; iter < 60; iter++) {
    const gamma = solveThrottle ? spec.gammaRad! : third
    const throttle = solveThrottle ? third : spec.throttle!
    const r0 = residuals(spec, alpha, elevator, throttle, gamma, out)
    residual = Math.abs(r0.fx / scale.fx) + Math.abs(r0.fz / scale.fz) + Math.abs(r0.m / scale.m)
    if (residual < 1e-6) break

    // Numeric Jacobian — probe AWAY from clamped boundaries, otherwise the
    // column reads zero at throttle=1 (or control stops) and Newton stalls.
    const hBase = [1e-4, 1e-4, solveThrottle ? 1e-3 : 1e-4] as const
    const h: number[] = [
      alpha > 0.28 ? -hBase[0] : hBase[0],
      elevator > P.elevatorMaxRad - 0.01 ? -hBase[1] : hBase[1],
      solveThrottle
        ? third > 0.995 ? -hBase[2]! : hBase[2]!
        : third > 0.34 ? -hBase[2]! : hBase[2]!,
    ]
    const cols: Array<{ fx: number; fz: number; m: number }> = []
    for (let j = 0; j < 3; j++) {
      const da = j === 0 ? h[0]! : 0
      const de = j === 1 ? h[1]! : 0
      const dt3 = j === 2 ? h[2]! : 0
      const g2 = solveThrottle ? spec.gammaRad! : third + dt3
      const t2 = solveThrottle ? third + dt3 : spec.throttle!
      const r1 = residuals(spec, alpha + da, elevator + de, t2, g2, out)
      cols.push({
        fx: (r1.fx - r0.fx) / (h[j]! || 1),
        fz: (r1.fz - r0.fz) / (h[j]! || 1),
        m: (r1.m - r0.m) / (h[j]! || 1),
      })
    }

    // Solve 3x3 J·dx = -r (Cramer).
    const a = cols[0]!, b = cols[1]!, c = cols[2]!
    const det =
      a.fx * (b.fz * c.m - c.fz * b.m) -
      b.fx * (a.fz * c.m - c.fz * a.m) +
      c.fx * (a.fz * b.m - b.fz * a.m)
    if (Math.abs(det) < 1e-12) break
    const rx = -r0.fx, rz = -r0.fz, rm = -r0.m
    const dx1 =
      (rx * (b.fz * c.m - c.fz * b.m) - b.fx * (rz * c.m - c.fz * rm) + c.fx * (rz * b.m - b.fz * rm)) / det
    const dx2 =
      (a.fx * (rz * c.m - c.fz * rm) - rx * (a.fz * c.m - c.fz * a.m) + c.fx * (a.fz * rm - rz * a.m)) / det
    const dx3 =
      (a.fx * (b.fz * rm - rz * b.m) - b.fx * (a.fz * rm - rz * a.m) + rx * (a.fz * b.m - b.fz * a.m)) / det

    // Damped update with sane bounds.
    const damp = 0.8
    alpha = Math.min(Math.max(alpha + damp * dx1, -0.2), 0.3)
    elevator = Math.min(Math.max(elevator + damp * dx2, -P.elevatorMaxRad), P.elevatorMaxRad)
    third += damp * dx3
    if (solveThrottle) third = Math.min(Math.max(third, 0), 1)
    else third = Math.min(Math.max(third, -0.35), 0.35)
  }

  const gamma = solveThrottle ? spec.gammaRad! : third
  const throttle = solveThrottle ? third : spec.throttle!
  const fin = residuals(spec, alpha, elevator, throttle, gamma, out)
  return {
    converged: residual < 1e-4,
    alphaRad: alpha,
    elevatorRad: elevator,
    throttle,
    gammaRad: gamma,
    rpm: fin.prop.rpm,
    thrustN: fin.prop.thrustN,
    shaftPowerW: fin.prop.powerW,
    residual,
  }
}

/** Stall CAS (m/s) implied by CLmax at a load — analytic helper for tests. */
export function stallTasMs(massKg: number, altM: number, flapsDeg: number, P: AircraftParams = C172S): number {
  const clMax = P.clMaxClean + flapInterp(P.flapDClMax, flapsDeg, P.flapDetentsDeg)
  const cl0f = P.cl0 + flapInterp(P.flapDCl0, flapsDeg, P.flapDetentsDeg)
  void cl0f
  const rho = isa(altM).densityKgM3
  return Math.sqrt((2 * massKg * G) / (rho * P.wingAreaM2 * clMax))
}
