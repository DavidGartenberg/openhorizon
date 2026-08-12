/**
 * Prop-effect physics (§5.1 rework — user goal: "proper thrust and
 * P-factor"): P-factor and slipstream-swirl yaw derived from the actual
 * thrust, engine torque, and momentum-theory inflow instead of the
 * earlier coefficient heuristic (pFactorCn·T/qS with a q-floor, an
 * alpha-mix floor, and per-type inflow ramps — each a hand-tuned patch
 * over the missing physics; all deleted with this module).
 *
 * Pure functions; consumed by aero.ts as body-frame yaw moments (N·m)
 * and by the rigging derivations (derive.ts and the per-type audits),
 * which cancel exactly these moments at each type's cruise.
 */

export interface PropEffectParams {
  /** P-factor gain (dimensionless, blade-element scale factor). */
  pFactorK: number
  /** Swirl-on-fin gain: yaw N·m per N·m of engine torque. Folds the fin
   *  area/arm/lift-slope over the slipstream tube's torque-conserved
   *  swirl — a geometry constant of order 0.5–0.8 for a conventional
   *  single with the fin fully in the slipstream. */
  swirlK: number
}

/**
 * Momentum-theory axial velocity AT the disk: the freestream plus half
 * the induced increment, v = ½(V + √(V² + 2T/ρA)). Static (V=0) this is
 * the classic √(T/2ρA); at high speed and low loading it tends to V.
 */
export function diskAxialVMs(thrustN: number, vMs: number, rho: number, propDiaM: number): number {
  const A = (Math.PI * propDiaM * propDiaM) / 4
  const T = Math.max(thrustN, 0)
  return 0.5 * (vMs + Math.sqrt(vMs * vMs + (2 * T) / (rho * A)))
}

/**
 * P-factor (asymmetric blade loading) yawing moment, N·m. Negative =
 * nose-left (clockwise prop seen from the cockpit — the US convention
 * every type in this sim uses).
 *
 * The advancing/retreating blade AoA asymmetry is set by the CROSSFLOW
 * through the disk, V·sinα, relative to the disk's own axial inflow
 * vDisk; the effective thrust line shifts sideways by
 * kP·R·(V·sinα/vDisk), giving N = −kP·T·R·(V·sinα)/vDisk.
 *
 * Limits that fall out for free (the old model hand-tuned both):
 *  - V = 0 → N = 0: a stationary runup has purely axial inflow; no
 *    asymmetry, no P-factor, no phantom pirouette.
 *  - α = 0 → N = 0: tail-up wheel run, no disk incidence.
 */
export function pFactorYawNm(
  pFactorK: number, thrustN: number, vMs: number, alphaRad: number, rho: number, propDiaM: number,
): number {
  const T = Math.max(thrustN, 0)
  if (T <= 0 || vMs <= 0) return 0
  const vDisk = diskAxialVMs(T, vMs, rho, propDiaM)
  const R = propDiaM / 2
  return -pFactorK * T * R * (vMs * Math.sin(Math.max(alphaRad, 0))) / Math.max(vDisk, 0.1)
}

/**
 * Slipstream-swirl yawing moment on the fin, N·m (negative = nose-left).
 * Torque conservation: the slipstream carries the engine torque as
 * angular momentum (ṁ·r̄·vswirl = Q); the fin, sitting in that swirl,
 * sees a sideways component whose force scales with the same ṁ·vswirl —
 * so the fin moment folds to a geometry constant times the torque
 * itself, N = −kS·Q. Present at static (a real runup pushes the tail),
 * proportional to power setting, bounded by construction.
 */
export function swirlYawNm(swirlK: number, engineTorqueNm: number): number {
  return -swirlK * Math.max(engineTorqueNm, 0)
}

/** Total prop-effects yaw moment (N·m, negative = left). */
export function propEffectsYawNm(
  k: PropEffectParams,
  thrustN: number, engineTorqueNm: number,
  vMs: number, alphaRad: number, rho: number, propDiaM: number,
): number {
  return (
    pFactorYawNm(k.pFactorK, thrustN, vMs, alphaRad, rho, propDiaM) +
    swirlYawNm(k.swirlK, engineTorqueNm)
  )
}
