/**
 * Ground reactions (§5.1): three spring-damper struts against the flat z=0
 * plane (real terrain queries arrive in Phase 2), tire rolling/braking/
 * cornering forces, nosewheel steering, differential braking.
 */
import { C172S } from './aircraft/c172s'
import type { V3, Q4 } from '../math/vec'
import { v3, v3set, v3add, v3cross, qrotate, qrotateInv, clamp } from '../math/vec'

const P = C172S

export interface GearInput {
  posNed: V3 // CG position (z down, ground at z = 0... altitude = -z)
  velNed: V3
  quat: Q4 // body→NED
  rates: V3 // body p,q,r
  rudder: number // [-1, 1] → nosewheel steering
  brakeLeft: number // [0, 1]
  brakeRight: number
  groundZ: number // NED z of terrain under aircraft (0 for Phase 1)
}

export interface GearOutput {
  force: V3 // body frame N
  moment: V3 // body N·m
  onGround: boolean
  maxCompressionM: number
}

const LEGS = [
  { def: P.gear.nose, brake: 'none' as const },
  { def: P.gear.mainL, brake: 'left' as const },
  { def: P.gear.mainR, brake: 'right' as const },
]

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

export function computeGear(inp: GearInput, out: GearOutput): GearOutput {
  v3set(out.force, 0, 0, 0)
  v3set(out.moment, 0, 0, 0)
  out.onGround = false
  out.maxCompressionM = 0

  for (const leg of LEGS) {
    const g = leg.def
    v3set(rBody, g.x, g.y, g.z)
    qrotate(rNed, inp.quat, rBody)

    // Penetration below ground plane (z down: wheel z > groundZ means below).
    const wheelZ = inp.posNed.z + rNed.z
    const pen = wheelZ - inp.groundZ
    if (pen <= 0) continue
    out.onGround = true
    out.maxCompressionM = Math.max(out.maxCompressionM, pen)

    // Contact-point velocity (NED).
    v3cross(omegaCrossR, inp.rates, rBody)
    qrotate(scratch, inp.quat, omegaCrossR)
    v3add(contactVelNed, inp.velNed, scratch)

    // Strut normal force (spring-damper along NED z, pushes up = -z).
    const compressionRate = contactVelNed.z
    let normal = g.k * pen + g.c * compressionRate
    normal = clamp(normal, 0, 40_000)
    if (normal <= 0) continue

    // Wheel heading in the ground plane: body-x projected, plus steering.
    const steer = g.steerMaxRad > 0 ? inp.rudder * g.steerMaxRad : 0
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
    const muLong = P.rollingResistance + P.brakeMu * brake
    let fAlong: number
    if (Math.abs(vAlong) > 0.25) fAlong = -Math.sign(vAlong) * muLong * normal
    else fAlong = (-vAlong / 0.25) * muLong * normal

    // Lateral: linear cornering up to the friction cap.
    let fSide = 0
    if (speed > 0.25) {
      const slip = Math.atan2(vSide, Math.abs(vAlong) + 0.3)
      fSide = clamp(-P.tireCorneringPerRad * slip, -P.tireLatMuCap, P.tireLatMuCap) * normal
    } else {
      fSide = clamp((-vSide / 0.25) * 0.6, -P.tireLatMuCap, P.tireLatMuCap) * normal
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
