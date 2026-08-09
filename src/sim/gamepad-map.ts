/**
 * Gamepad mapping core (16a) — pure, no navigator access. The capture
 * convention: the pilot moves an axis to the function's POSITIVE
 * extreme (nose UP, RIGHT roll, RIGHT rudder, full throttle, mixture
 * RICH, brakes ON) and the observed movement direction becomes the
 * binding's +1 — inverted hardware never needs a checkbox. Unipolar
 * functions map the signed axis onto [0,1]. The driver in main.ts owns
 * polling and control application.
 */

export type BindableAxis = 'pitch' | 'roll' | 'yaw' | 'throttle' | 'mixture' | 'brakes'

export interface AxisBinding {
  pad: number
  axis: number
  sign: 1 | -1
}

export type GamepadMap = Partial<Record<BindableAxis, AxisBinding>>

export const UNIPOLAR: ReadonlySet<BindableAxis> = new Set(['throttle', 'mixture', 'brakes'])

const DEADZONE = 0.06

/** Zero inside the zone; rescale outside so full deflection stays ±1. */
export function applyDeadzone(v: number, dz = DEADZONE): number {
  const a = Math.abs(v)
  if (a < dz) return 0
  return Math.sign(v) * ((a - dz) / (1 - dz))
}

/** Signed [-1,1] → [0,1] for lever-type functions. */
export function axisToUnipolar(v: number): number {
  return Math.min(Math.max((v + 1) / 2, 0), 1)
}

/** Largest axis swing between two snapshots (per pad, per axis); the
 *  movement's direction becomes the binding sign. */
export function detectMovedAxis(
  before: ReadonlyArray<ReadonlyArray<number>>,
  after: ReadonlyArray<ReadonlyArray<number>>,
  threshold = 0.35,
): AxisBinding | null {
  let best: AxisBinding | null = null
  let bestDelta = threshold
  for (let p = 0; p < after.length; p++) {
    const b = before[p] ?? []
    const a = after[p] ?? []
    for (let i = 0; i < a.length; i++) {
      const d = (a[i] ?? 0) - (b[i] ?? 0)
      if (Math.abs(d) > bestDelta) {
        bestDelta = Math.abs(d)
        best = { pad: p, axis: i, sign: d > 0 ? 1 : -1 }
      }
    }
  }
  return best
}

export function serializeGamepadMap(m: GamepadMap): string {
  return JSON.stringify(m)
}

export function parseGamepadMap(s: string): GamepadMap | null {
  try {
    const raw = JSON.parse(s) as Record<string, unknown>
    if (typeof raw !== 'object' || raw === null) return null
    const out: GamepadMap = {}
    for (const [k, v] of Object.entries(raw)) {
      const b = v as { pad?: unknown; axis?: unknown; sign?: unknown }
      if (
        typeof b?.pad !== 'number' || typeof b?.axis !== 'number' ||
        (b?.sign !== 1 && b?.sign !== -1)
      ) return null
      out[k as BindableAxis] = { pad: b.pad, axis: b.axis, sign: b.sign }
    }
    return out
  } catch {
    return null
  }
}

/** The near-universal single-stick layout: roll/pitch on 0/1, twist
 *  rudder on 2, throttle slider on 3 (full forward reports −1). */
export const DEFAULT_SINGLE_STICK: GamepadMap = {
  roll: { pad: 0, axis: 0, sign: 1 },
  pitch: { pad: 0, axis: 1, sign: 1 },
  yaw: { pad: 0, axis: 2, sign: 1 },
  throttle: { pad: 0, axis: 3, sign: -1 },
}
