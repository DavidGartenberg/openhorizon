/**
 * Ground reactions (§5.1): three spring-damper struts against the flat z=0
 * plane (real terrain queries arrive in Phase 2), tire rolling/braking/
 * cornering forces, nosewheel steering, differential braking.
 */
import { C172S } from './aircraft/c172s'
import type { AircraftParams, GearLeg } from './aircraft/params'
import type { V3, Q4 } from '../math/vec'
import { v3, v3set, v3add, v3cross, qrotate, qrotateInv, clamp } from '../math/vec'

export interface GearInput {
  posNed: V3 // CG position (z down, ground at z = 0... altitude = -z)
  velNed: V3
  quat: Q4 // body→NED
  rates: V3 // body p,q,r
  rudder: number // [-1, 1] → nosewheel steering
  brakeLeft: number // [0, 1]
  brakeRight: number
  groundZ: number // fallback NED z of terrain (flat world)
  /** Per-wheel terrain query: NED z of the ground at (north, east). */
  groundZAt?: (nNed: number, eNed: number) => number
  /** Runway contamination (environment/runway-surface.ts). Each defaults
   *  to 1, the dry-runway behaviour, bit-exact. */
  brakeMuScale?: number
  latMuScale?: number
  rollingScale?: number
  /** Static-friction anchors, 3 per leg (north, east, active). Absent = the
   *  original purely kinetic model (bit-exact for direct callers). */
  stick?: Float64Array
  /** Brake fade multipliers from hot linings (systems/brakes.ts); 1 = cold. */
  brakeFadeLeft?: number
  brakeFadeRight?: number
}

/** Stick-slip ("dragging anchor") tyre friction at standstill: each contact
 *  point is held by a spring-damper whose stiffness scales with the leg's load
 *  (natural frequency √(K·g) ≈ 22 rad/s, critically damped), split along /
 *  across the wheel. Along the wheel the cap is what stops it turning —
 *  rolling resistance plus the brake's STATIC friction (an unbraked wheel
 *  still rolls); the whole force is then held inside the tyre's grip circle.
 *  A capped force drags its anchor: exactly kinetic friction. Above STICK_EXIT
 *  the kinetic model below takes over. */
const STICK_K = 50 // spring per newton of load, 1/m
const STICK_C = 4.5 // damping per newton of load, s/m
/** Static over kinetic friction of a brake (lining on disc ≈ 1.3–1.5). brakeMu
 *  is the landing-roll (kinetic, POH-calibrated) value; a held brake grips
 *  harder — which is why a C172's brakes hold the full-power run-up of the
 *  POH short-field takeoff. */
const BRAKE_STATIC_RATIO = 1.4
const STICK_ENTER_MS = 0.1
const STICK_EXIT_MS = 0.4

export interface GearOutput {
  force: V3 // body frame N
  moment: V3 // body N·m
  onGround: boolean
  maxCompressionM: number
  /** Friction work the brakes are absorbing (W), for their heating. */
  brakePowerLeftW?: number
  brakePowerRightW?: number
}

type LegSpec = { def: GearLeg; brake: 'none' | 'left' | 'right' }

/** Per-aircraft leg list, built once per params object (no per-frame alloc).
 *  Tricycle uses `gear.nose`; a taildragger's third wheel is `gear.tail` —
 *  same strut/tire math, the handling difference (ground-loop divergence)
 *  emerges from the mains sitting AHEAD of the CG. */
const legsCache = new WeakMap<AircraftParams, LegSpec[]>()
function legsFor(P: AircraftParams): LegSpec[] {
  let legs = legsCache.get(P)
  if (!legs) {
    legs = []
    const third = P.gear.nose ?? P.gear.tail
    if (third) legs.push({ def: third, brake: 'none' })
    legs.push({ def: P.gear.mainL, brake: 'left' })
    legs.push({ def: P.gear.mainR, brake: 'right' })
    legsCache.set(P, legs)
  }
  return legs
}

// scratch
const rBody = v3()
const rNed = v3()
const contactVelNed = v3()
const omegaCrossR = v3()
const fNedTotal = v3()
const fNed = v3()
const fBody = v3()
const mBody = v3()
const scratch = v3()

export function computeGear(inp: GearInput, out: GearOutput, P: AircraftParams = C172S): GearOutput {
  v3set(out.force, 0, 0, 0)
  v3set(out.moment, 0, 0, 0)
  out.onGround = false
  out.maxCompressionM = 0
  out.brakePowerLeftW = 0
  out.brakePowerRightW = 0

  let legIndex = -1
  for (const leg of legsFor(P)) {
    legIndex++
    const si = legIndex * 3
    const g = leg.def
    v3set(rBody, g.x, g.y, g.z)
    qrotate(rNed, inp.quat, rBody)

    // Penetration below ground (z down: wheel z > groundZ means below).
    const wheelZ = inp.posNed.z + rNed.z
    const groundZ = inp.groundZAt
      ? inp.groundZAt(inp.posNed.x + rNed.x, inp.posNed.y + rNed.y)
      : inp.groundZ
    // A terrain/elevation query can occasionally come back non-finite
    // (e.g. a tile decode gap); treat that as no contact this wheel rather
    // than letting NaN flow into force/moment and the 6-DOF integrator.
    if (!Number.isFinite(groundZ)) { if (inp.stick) inp.stick[si + 2] = 0; continue }
    const pen = wheelZ - groundZ
    if (pen <= 0) { if (inp.stick) inp.stick[si + 2] = 0; continue }
    out.onGround = true
    out.maxCompressionM = Math.max(out.maxCompressionM, pen)

    // Contact-point velocity (NED).
    v3cross(omegaCrossR, inp.rates, rBody)
    qrotate(scratch, inp.quat, omegaCrossR)
    v3add(contactVelNed, inp.velNed, scratch)

    // Strut normal force (spring-damper along NED z, pushes up = -z).
    const compressionRate = contactVelNed.z
    let normal = g.k * pen + g.c * compressionRate
    // Per-leg cap (11g): default 40 kN is the C172 value, bit-exact for the
    // existing fleet; transport legs override (a 737 needs ~590 kN static).
    normal = clamp(normal, 0, g.maxNormalN ?? 40_000)
    if (normal <= 0) { if (inp.stick) inp.stick[si + 2] = 0; continue }

    // Wheel heading in the ground plane: body-x projected, plus steering.
    // Steering sign flips for legs BEHIND the CG: steering a TAILWHEEL
    // right swings the tail right — yawing the NOSE left. Right pedal must
    // yaw the nose right on both layouts, so a tail leg steers opposite
    // the pedal. (Found via the Cub: its tailwheel fought the rudder at
    // full power and no pedal could stop the takeoff-roll pirouette; every
    // prior ground test rolled at idle where feedback control masked it.)
    const steerSign = g.x < 0 ? -1 : 1
    const steer = g.steerMaxRad > 0 ? steerSign * inp.rudder * g.steerMaxRad : 0
    qrotate(scratch, inp.quat, v3set(fNed, Math.cos(steer), Math.sin(steer), 0))
    const wheelHdgX = scratch.x
    const wheelHdgY = scratch.y
    const hdgNorm = Math.hypot(wheelHdgX, wheelHdgY) || 1
    const wx = wheelHdgX / hdgNorm
    const wy = wheelHdgY / hdgNorm

    const vx = contactVelNed.x
    const vy = contactVelNed.y
    const vAlong = vx * wx + vy * wy
    const vSide = -vx * wy + vy * wx
    const speed = Math.hypot(vx, vy)

    // Longitudinal: rolling resistance + brakes (viscous near standstill to
    // avoid friction jitter at 120 Hz).
    const brake =
      leg.brake === 'left' ? inp.brakeLeft : leg.brake === 'right' ? inp.brakeRight : 0
    const fade = leg.brake === 'left' ? (inp.brakeFadeLeft ?? 1) : leg.brake === 'right' ? (inp.brakeFadeRight ?? 1) : 1
    const muRoll = P.rollingResistance * (inp.rollingScale ?? 1)
    const muBrake = P.brakeMu * brake * (inp.brakeMuScale ?? 1) * fade
    const muLong = muRoll + muBrake
    const latCap = P.tireLatMuCap * (inp.latMuScale ?? 1)
    let fAlong: number
    let fSide = 0
    const st = inp.stick
    const sticking = !!st && (speed < STICK_ENTER_MS || (st[si + 2] === 1 && speed < STICK_EXIT_MS))
    if (st && sticking) {
      const cpN = inp.posNed.x + rNed.x, cpE = inp.posNed.y + rNed.y
      if (st[si + 2] !== 1) { st[si] = cpN; st[si + 1] = cpE; st[si + 2] = 1 }
      const dN = cpN - st[si]!, dE = cpE - st[si + 1]!
      const dA = dN * wx + dE * wy, dS = -dN * wy + dE * wx
      const k = normal * STICK_K, c = normal * STICK_C
      let fA = -k * dA - c * vAlong
      let fS = -k * dS - c * vSide
      // The wheel turns once the force exceeds rolling + static brake friction...
      const capA = (muRoll + muBrake * BRAKE_STATIC_RATIO) * normal
      fA = clamp(fA, -capA, capA)
      // ...and the tyre skids once the total exceeds its grip.
      const grip = latCap * normal
      const fMag = Math.hypot(fA, fS)
      if (fMag > grip) { fA *= grip / fMag; fS *= grip / fMag }
      // Re-seat the anchor where the spring-damper gives the capped force
      // (unchanged when nothing slipped).
      const nA = -(fA + c * vAlong) / k, nS = -(fS + c * vSide) / k
      st[si] = cpN - (nA * wx - nS * wy)
      st[si + 1] = cpE - (nA * wy + nS * wx)
      fAlong = fA
      fSide = fS
    } else {
      if (st) st[si + 2] = 0
      if (Math.abs(vAlong) > 0.25) fAlong = -Math.sign(vAlong) * muLong * normal
      else fAlong = (-vAlong / 0.25) * muLong * normal

      // Lateral: linear cornering up to the friction cap.
      if (speed > 0.25) {
        const slip = Math.atan2(vSide, Math.abs(vAlong) + 0.3)
        fSide = clamp(-P.tireCorneringPerRad * slip, -latCap, latCap) * normal
      } else {
        fSide = clamp((-vSide / 0.25) * 0.6, -latCap, latCap) * normal
      }
    }

    // The brakes' share of the along-wheel friction work heats them.
    if (muBrake > 0) {
      const pw = Math.abs(fAlong * vAlong) * (muBrake / muLong)
      if (leg.brake === 'left') out.brakePowerLeftW! += pw
      else if (leg.brake === 'right') out.brakePowerRightW! += pw
    }

    // Assemble NED force: normal up (-z) + plane forces along/across wheel.
    v3set(
      fNed,
      fAlong * wx - fSide * wy,
      fAlong * wy + fSide * wx,
      -normal,
    )

    qrotateInv(fBody, inp.quat, fNed)
    v3add(out.force, out.force, fBody)
    v3cross(mBody, rBody, fBody)
    v3add(out.moment, out.moment, mBody)
  }

  v3set(fNedTotal, 0, 0, 0) // (scratch reset; keeps object shapes stable)
  return out
}

export function makeGearOutput(): GearOutput {
  return { force: v3(), moment: v3(), onGround: false, maxCompressionM: 0 }
}
