/**
 * Aerodynamic force/moment buildup (§5.1): coefficient model with smooth
 * post-stall blending, full static + dynamic derivatives, adverse yaw,
 * propwash over the tail, P-factor/slipstream/torque, and ground effect.
 * Pure function of the flight condition — returns body-frame forces (N) and
 * moments (N·m).
 */
import { C172S, flapInterp } from './aircraft/c172s'
import { propEffectsYawNm } from './prop-effects'
import type { AircraftParams } from './aircraft/params'
import type { V3 } from '../math/vec'
import { v3set, clamp } from '../math/vec'

export interface AeroInput {
  rho: number
  /** True airspeed (m/s), body-frame components of air-relative velocity. */
  vAir: number
  alpha: number // rad
  beta: number // rad
  alphaDot: number // rad/s (filtered)
  p: number // body rates rad/s
  q: number
  r: number
  elevatorRad: number // + = trailing edge down (nose-down)
  aileronRad: number // + = right roll command
  rudderRad: number // Roskam convention: + = trailing edge left (nose-left via Cndr<0); pilot +input maps to -δr
  flapsDeg: number
  thrustN: number
  propTorqueNm: number
  heightAglM: number
  /** Flight Mach number (Phase 11e). 0 (default) = incompressible — the
   *  piston fleet passes 0 and sees bit-identical behavior. */
  mach?: number
  /** Extra parasite-drag increment (extended gear, Phase 11e). Default 0. */
  extraCd?: number
  /** Lift decrement (spoiler lift dump), applied after the stall blend.
   *  Default 0. */
  extraClDump?: number
}

export interface AeroOutput {
  force: V3 // body N
  moment: V3 // body N·m
  cl: number
  cd: number
  stallFraction: number // 0 = attached, 1 = fully stalled
}

function sigmoid(x: number): number {
  return 1 / (1 + Math.exp(-x))
}

export function computeAero(inp: AeroInput, out: AeroOutput, P: AircraftParams = C172S): AeroOutput {
  const kInduced = 1 / (Math.PI * P.oswald * P.aspectRatio)
  const diskArea = (Math.PI * P.propDiameterM * P.propDiameterM) / 4
  const V = Math.max(inp.vAir, 1)
  const qbar = 0.5 * inp.rho * V * V
  const qS = qbar * P.wingAreaM2
  const { alpha, beta } = inp

  // Non-dimensional rates.
  const bh = P.spanM / (2 * V)
  const ch = P.chordM / (2 * V)
  const phat = inp.p * bh
  const qhat = inp.q * ch
  const rhat = inp.r * bh
  const adot = inp.alphaDot * ch

  // Propwash raises dynamic pressure at the tail (elevator/rudder authority
  // and pitch damping grow with power at low speed).
  const dqProp = Math.max(inp.thrustN, 0) / (2 * diskArea)
  const tailQFactor = clamp((qbar + P.propwashTailFactor * dqProp) / qbar, 1, 2.5)

  // Flap increments.
  const dCl0 = flapInterp(P.flapDCl0, inp.flapsDeg, P.flapDetentsDeg)
  const dClMax = flapInterp(P.flapDClMax, inp.flapsDeg, P.flapDetentsDeg)
  const dCd = flapInterp(P.flapDCd, inp.flapsDeg, P.flapDetentsDeg) + (inp.extraCd ?? 0)
  const dCm = flapInterp(P.flapDCm, inp.flapsDeg, P.flapDetentsDeg)

  // Compressibility (Phase 11e): Prandtl–Glauert lift-slope growth and the
  // drag-divergence rise, only for aircraft that declare a machModel.
  const mach = inp.mach ?? 0
  const pg = P.machModel && mach > 0.3 ? 1 / Math.sqrt(Math.max(1 - mach * mach, 0.36)) : 1
  const machDragRise =
    P.machModel && mach > P.machModel.mdd
      ? P.machModel.dragRiseK * (mach - P.machModel.mdd) * (mach - P.machModel.mdd)
      : 0

  // ---- lift: linear → parabolic cap peaking at CLmax → post-stall drop ----
  // The parabola is tangent to the lift line at αs−δ and peaks CLmax at αs+δ,
  // so the 1-g stall happens exactly at the POH CLmax (§5.6 stall speeds).
  const clAlphaEff = P.clAlpha * pg
  const cl0f = P.cl0 + dCl0
  const clMax = P.clMaxClean + dClMax
  const delta = 0.03 // rad, rounding half-width
  const alphaS = (clMax - cl0f) / clAlphaEff
  const alphaPeak = alphaS + delta
  const aCoef = clAlphaEff / (4 * delta)
  let clAttached: number
  if (alpha < alphaS - delta) clAttached = cl0f + clAlphaEff * alpha
  else clAttached = clMax - aCoef * (alpha - alphaPeak) * (alpha - alphaPeak)
  // Post-stall: blend to flat plate just past the peak (the break).
  const sPos = sigmoid((alpha - (alphaPeak + 0.02)) / 0.025)
  // Negative-α stall (simple sigmoid; inverted flight is not study-level).
  const alphaStallNeg = (P.clMin - cl0f) / P.clAlpha
  const sNeg = sigmoid((alphaStallNeg - alpha) / P.stallBlendWidthRad)
  const stall = Math.max(sPos, sNeg)
  // X-Plane airfoil-table audit (2026-08-13): the real post-stall curves
  // (NACA 2412/23012, Boeing supercritical, ±180° tables) show a second
  // lift peak ≈1.14-1.17 at α=45° — 1.1 splits the GA/jet families.
  const clFlatPlate = 1.1 * Math.sin(2 * alpha)
  let cl = (1 - stall) * clAttached + stall * clFlatPlate
  cl += P.clDe * inp.elevatorRad + (P.clQ * qhat + P.clAlphaDot * adot) * (1 - stall)
  cl -= inp.extraClDump ?? 0
  // Buffet/annunciation + test detection: 0.5 exactly at the CLmax break.
  const stallFraction = sigmoid((alpha - alphaPeak) / 0.02)

  // ---- drag ----
  // Ground effect: induced drag falls near the surface (McCormick).
  const h16b = (16 * Math.max(inp.heightAglM, 0.1)) / P.spanM
  const geFactor = (h16b * h16b) / (1 + h16b * h16b)
  const cdAttached = P.cd0 + dCd + machDragRise + kInduced * cl * cl * geFactor
  const cdStalled = P.cd0 + dCd + machDragRise + P.postStallCd * Math.sin(alpha) * Math.sin(alpha)
  const cd = (1 - stall) * cdAttached + stall * cdStalled + P.cdBeta * beta * beta

  // ---- side force ----
  const cy =
    P.cyBeta * beta + P.cyP * phat + P.cyR * rhat + P.cyDr * inp.rudderRad

  // ---- pitch ----
  let cm =
    P.cm0 +
    dCm +
    P.cmAlpha * alpha +
    (P.cmQ * qhat + P.cmAlphaDot * adot) * tailQFactor +
    P.cmDe * inp.elevatorRad * tailQFactor
  // Post-stall nose-down break.
  if (alpha > 0) cm += sPos * P.postStallCmDrop * (alpha - alphaPeak + 0.05)

  // ---- roll ----
  let croll =
    P.clBeta * beta +
    P.clP * phat +
    P.clR * rhat +
    P.clDa * inp.aileronRad +
    P.clDr * inp.rudderRad

  // ---- yaw ----
  let cn =
    P.cnBeta * beta +
    P.cnP * phat +
    P.cnR * rhat +
    P.cnDa * inp.aileronRad +
    P.cnDr * inp.rudderRad * tailQFactor

  // ---- prop effects (§5.1, prop-effects.ts): P-factor + slipstream
  // swirl → left yaw, computed as MOMENTS from actual thrust/torque and
  // momentum-theory inflow — the static and zero-alpha limits fall out of
  // the physics instead of the old hand-tuned q-floor/alpha-mix/inflow
  // ramps. Applied in the moment assembly below alongside the
  // torque-reaction roll. Gains are calibrated so the C172's audited
  // cruise moment is unchanged — the AP lateral law's stability margins
  // were re-tuned against exactly that value.
  // Rigging compensation (offset fin / aileron rigging — see params.ts):
  // constant coefficients nulling the prop moments at the type's cruise.
  cn += P.rigCn ?? 0
  croll += P.rigCl ?? 0

  // ---- wind → body axes ----
  const ca = Math.cos(alpha)
  const sa = Math.sin(alpha)
  const cb = Math.cos(beta)
  const sb = Math.sin(beta)
  const D = qS * cd
  const Y = qS * cy
  const L = qS * cl
  v3set(
    out.force,
    -D * ca * cb + Y * -ca * sb + L * sa,
    -D * sb + Y * cb,
    -D * sa * cb + Y * -sa * sb - L * ca,
  )

  const propYawNm = P.pFactorK > 0 || P.swirlK > 0
    ? propEffectsYawNm(
        { pFactorK: P.pFactorK, swirlK: P.swirlK },
        inp.thrustN, inp.propTorqueNm, inp.vAir, alpha, inp.rho, P.propDiameterM,
      )
    : 0
  v3set(
    out.moment,
    qS * P.spanM * croll - inp.propTorqueNm, // torque reaction: left roll
    qS * P.chordM * cm,
    qS * P.spanM * cn + propYawNm,
  )

  out.cl = cl
  out.cd = cd
  out.stallFraction = Math.max(stallFraction, sNeg)
  return out
}

export function makeAeroOutput(): AeroOutput {
  return {
    force: { x: 0, y: 0, z: 0 },
    moment: { x: 0, y: 0, z: 0 },
    cl: 0,
    cd: 0,
    stallFraction: 0,
  }
}
