/**
 * Minimal mutable Vec3/Quat math for the pure simulation core (/sim may not
 * import three.js). All ops write into `out` and return it — hot physics paths
 * preallocate scratch objects, so no per-frame heap allocation (§19).
 */

export interface V3 {
  x: number
  y: number
  z: number
}

export interface Q4 {
  w: number
  x: number
  y: number
  z: number
}

export const v3 = (x = 0, y = 0, z = 0): V3 => ({ x, y, z })
export const q4 = (w = 1, x = 0, y = 0, z = 0): Q4 => ({ w, x, y, z })

export function v3set(out: V3, x: number, y: number, z: number): V3 {
  out.x = x
  out.y = y
  out.z = z
  return out
}

export function v3copy(out: V3, a: V3): V3 {
  return v3set(out, a.x, a.y, a.z)
}

export function v3add(out: V3, a: V3, b: V3): V3 {
  return v3set(out, a.x + b.x, a.y + b.y, a.z + b.z)
}

export function v3addScaled(out: V3, a: V3, b: V3, s: number): V3 {
  return v3set(out, a.x + b.x * s, a.y + b.y * s, a.z + b.z * s)
}

export function v3sub(out: V3, a: V3, b: V3): V3 {
  return v3set(out, a.x - b.x, a.y - b.y, a.z - b.z)
}

export function v3scale(out: V3, a: V3, s: number): V3 {
  return v3set(out, a.x * s, a.y * s, a.z * s)
}

export function v3cross(out: V3, a: V3, b: V3): V3 {
  const x = a.y * b.z - a.z * b.y
  const y = a.z * b.x - a.x * b.z
  const z = a.x * b.y - a.y * b.x
  return v3set(out, x, y, z)
}

export function v3dot(a: V3, b: V3): number {
  return a.x * b.x + a.y * b.y + a.z * b.z
}

export function v3len(a: V3): number {
  return Math.hypot(a.x, a.y, a.z)
}

export function v3zero(out: V3): V3 {
  return v3set(out, 0, 0, 0)
}

export function qset(out: Q4, w: number, x: number, y: number, z: number): Q4 {
  out.w = w
  out.x = x
  out.y = y
  out.z = z
  return out
}

export function qcopy(out: Q4, a: Q4): Q4 {
  return qset(out, a.w, a.x, a.y, a.z)
}

export function qnormalize(out: Q4): Q4 {
  const n = Math.hypot(out.w, out.x, out.y, out.z) || 1
  out.w /= n
  out.x /= n
  out.y /= n
  out.z /= n
  return out
}

/** Rotate body-frame vector `a` into the parent frame by quaternion `q`. */
export function qrotate(out: V3, q: Q4, a: V3): V3 {
  // t = 2 q_vec × a ; out = a + w t + q_vec × t
  const tx = 2 * (q.y * a.z - q.z * a.y)
  const ty = 2 * (q.z * a.x - q.x * a.z)
  const tz = 2 * (q.x * a.y - q.y * a.x)
  return v3set(
    out,
    a.x + q.w * tx + (q.y * tz - q.z * ty),
    a.y + q.w * ty + (q.z * tx - q.x * tz),
    a.z + q.w * tz + (q.x * ty - q.y * tx),
  )
}

/** Rotate parent-frame vector `a` into the body frame (inverse rotation). */
export function qrotateInv(out: V3, q: Q4, a: V3): V3 {
  const tx = 2 * (-q.y * a.z + q.z * a.y)
  const ty = 2 * (-q.z * a.x + q.x * a.z)
  const tz = 2 * (-q.x * a.y + q.y * a.x)
  return v3set(
    out,
    a.x + q.w * tx + (-q.y * tz + q.z * ty),
    a.y + q.w * ty + (-q.z * tx + q.x * tz),
    a.z + q.w * tz + (-q.x * ty + q.y * tx),
  )
}

/** Integrate attitude: q ← normalize(q + ½ q ⊗ (0, ω) dt), ω in body frame. */
export function qintegrate(q: Q4, omega: V3, dt: number): Q4 {
  const hw = -0.5 * (q.x * omega.x + q.y * omega.y + q.z * omega.z)
  const hx = 0.5 * (q.w * omega.x + q.y * omega.z - q.z * omega.y)
  const hy = 0.5 * (q.w * omega.y + q.z * omega.x - q.x * omega.z)
  const hz = 0.5 * (q.w * omega.z + q.x * omega.y - q.y * omega.x)
  q.w += hw * dt
  q.x += hx * dt
  q.y += hy * dt
  q.z += hz * dt
  return qnormalize(q)
}

/** Aerospace ZYX Euler (yaw ψ, pitch θ, roll φ) → quaternion, NED frame. */
export function qfromEuler(out: Q4, yaw: number, pitch: number, roll: number): Q4 {
  const cy = Math.cos(yaw / 2)
  const sy = Math.sin(yaw / 2)
  const cp = Math.cos(pitch / 2)
  const sp = Math.sin(pitch / 2)
  const cr = Math.cos(roll / 2)
  const sr = Math.sin(roll / 2)
  return qset(
    out,
    cy * cp * cr + sy * sp * sr,
    cy * cp * sr - sy * sp * cr,
    cy * sp * cr + sy * cp * sr,
    sy * cp * cr - cy * sp * sr,
  )
}

export interface Euler {
  yaw: number
  pitch: number
  roll: number
}

/** Quaternion → aerospace ZYX Euler (NED). */
export function qtoEuler(out: Euler, q: Q4): Euler {
  const sinp = 2 * (q.w * q.y - q.z * q.x)
  out.pitch = Math.abs(sinp) >= 1 ? Math.sign(sinp) * Math.PI / 2 : Math.asin(sinp)
  out.roll = Math.atan2(2 * (q.w * q.x + q.y * q.z), 1 - 2 * (q.x * q.x + q.y * q.y))
  out.yaw = Math.atan2(2 * (q.w * q.z + q.x * q.y), 1 - 2 * (q.y * q.y + q.z * q.z))
  return out
}

export function clamp(v: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, v))
}
