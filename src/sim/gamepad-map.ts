/**
 * Gamepad mapping core (16a) — pure, no navigator access. The capture
 * convention: the pilot moves an axis to the function's POSITIVE
 * extreme (nose UP, RIGHT roll, RIGHT rudder, full throttle, mixture
 * RICH, brakes ON) and the observed movement direction becomes the
 * binding's +1 — inverted hardware never needs a checkbox. Unipolar
 * functions map the signed axis onto [0,1]. The driver in main.ts owns
 * polling and control application.
 */

export type BindableAxis = 'pitch' | 'roll' | 'yaw' | 'throttle' | 'throttle2' | 'mixture' | 'brakes'

/** Momentary/toggle functions bindable to gamepad buttons (16a-b: the
 *  TCA quadrant's switches and the sidestick's buttons). */
export type BindableButton =
  | 'gear' | 'flapsUp' | 'flapsDown' | 'trimUp' | 'trimDown'
  | 'apDisconnect' | 'brakes' | 'reverse'

export interface ButtonBinding {
  pad: number
  btn: number
}

export interface AxisBinding {
  pad: number
  axis: number
  sign: 1 | -1
}

export type GamepadMap = Partial<Record<BindableAxis, AxisBinding>> & {
  btn?: Partial<Record<BindableButton, ButtonBinding>>
}

export const UNIPOLAR: ReadonlySet<BindableAxis> = new Set(['throttle', 'throttle2', 'mixture', 'brakes'])

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

/** Newly-pressed button between two snapshots (any pad). */
export function detectPressedButton(
  before: ReadonlyArray<ReadonlyArray<boolean>>,
  after: ReadonlyArray<ReadonlyArray<boolean>>,
): ButtonBinding | null {
  for (let p = 0; p < after.length; p++) {
    const b = before[p] ?? []
    const a = after[p] ?? []
    for (let i = 0; i < a.length; i++) {
      if (a[i] && !b[i]) return { pad: p, btn: i }
    }
  }
  return null
}

/** Throttle lever with a reverse gate (TCA quadrant): the capture puts
 *  idle at unipolar 0 and TOGA at 1; lever travel BELOW idle (the
 *  lifted reverse zone) reads negative — that engages reverse and its
 *  depth becomes reverse power. A whisker below idle stays forward-idle
 *  so a lever resting on the detent can't flicker the buckets. */
export function leverWithReverse(rawSigned: number): { power: number; reverse: boolean } {
  const u = (rawSigned + 1) / 2 // UNclamped unipolar
  if (u >= 0) return { power: Math.min(u, 1), reverse: false }
  if (u > -0.04) return { power: 0, reverse: false }
  return { power: Math.min(-u * 3, 1), reverse: true }
}

export function parseGamepadMap(s: string): GamepadMap | null {
  try {
    const raw = JSON.parse(s) as Record<string, unknown>
    if (typeof raw !== 'object' || raw === null) return null
    const out: GamepadMap = {}
    for (const [k, v] of Object.entries(raw)) {
      if (k === 'btn') {
        const btns: NonNullable<GamepadMap['btn']> = {}
        for (const [bk, bv] of Object.entries(v as Record<string, unknown>)) {
          const bb = bv as { pad?: unknown; btn?: unknown }
          if (typeof bb?.pad !== 'number' || typeof bb?.btn !== 'number') return null
          btns[bk as BindableButton] = { pad: bb.pad, btn: bb.btn }
        }
        out.btn = btns
        continue
      }
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

/** Thrustmaster TCA (Airbus edition) device matchers + preset. The
 *  Captain Pack enumerates as TWO devices: the sidestick (4 axes:
 *  roll, pitch, twist rudder, base slider) and the quadrant (the two
 *  thrust levers). The preset covers the axes; signs follow the same
 *  full-forward-reports-−1 convention as every Thrustmaster slider —
 *  the JOY capture wizard refines anything the guess gets wrong. */
export const TCA_DEVICE = /tca|t\.a320|thrustmaster|airbus/i
export const TCA_QUADRANT = /quadrant|q-eng|throttle/i

export function tcaPresetFor(pads: ReadonlyArray<{ id: string; axes: number; index: number }>): GamepadMap | null {
  const tca = pads.filter((p) => TCA_DEVICE.test(p.id))
  if (!tca.length) return null
  const quadrant = tca.find((p) => TCA_QUADRANT.test(p.id)) ?? tca.find((p) => p.axes <= 3 && p.axes >= 2)
  const stick = tca.find((p) => p !== quadrant && p.axes >= 4) ?? tca.find((p) => p !== quadrant)
  const map: GamepadMap = {}
  if (stick) {
    map.roll = { pad: stick.index, axis: 0, sign: 1 }
    map.pitch = { pad: stick.index, axis: 1, sign: 1 }
    map.yaw = { pad: stick.index, axis: 2, sign: 1 }
    if (!quadrant) map.throttle = { pad: stick.index, axis: 3, sign: -1 }
  }
  if (quadrant) {
    map.throttle = { pad: quadrant.index, axis: 0, sign: -1 }
    map.throttle2 = { pad: quadrant.index, axis: 1, sign: -1 }
  }
  return Object.keys(map).length ? map : null
}

/** The near-universal single-stick layout: roll/pitch on 0/1, twist
 *  rudder on 2, throttle slider on 3 (full forward reports −1). */
export const DEFAULT_SINGLE_STICK: GamepadMap = {
  roll: { pad: 0, axis: 0, sign: 1 },
  pitch: { pad: 0, axis: 1, sign: 1 },
  yaw: { pad: 0, axis: 2, sign: 1 },
  throttle: { pad: 0, axis: 3, sign: -1 },
}
