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
  /** Preset schema version — lets a corrected preset overwrite bindings a
   *  WRONG earlier preset saved (the v1 TCA guess inverted the quadrant). */
  v?: number
  /** Key-alias buttons: "pad:btn" → KeyboardEvent.code. A press injects a
   *  one-frame key so the existing discrete handlers serve the stick;
   *  entries whose code is listed in HELD_ALIASES mirror held state. */
  btnKeys?: Record<string, string>
}

export const TCA_PRESET_VERSION = 6

/** Key aliases that act while HELD (everything else is edge-triggered). */
export const HELD_ALIASES: ReadonlySet<string> = new Set(['KeyB', 'KeyW', 'KeyS', 'KeyA', 'KeyD', 'Comma', 'Period'])

/** Thrustmaster TCA Sidestick X Airbus button layout (Chrome indices =
 *  printed button number − 1): 0 trigger, 1 red AP-disconnect (top),
 *  2 black thumb button, 3 hat push; base 4-15 = L1-L3 / R1-R3 + the
 *  lower six; 16-21 hat directions where the OS exposes them as buttons.
 *  Quadrant (TCA Q-Eng 1&2): 0/1 = reverse-lift levers ENG1/ENG2.
 *  Assignments mirror Thrustmaster's published Airbus profile where the
 *  sim has the function, mapped onto our keys. */
export function tcaButtonPreset(stickPad: number | null, quadPad: number | null): { keys: Record<string, string>; fn: Partial<Record<BindableButton, ButtonBinding>> } {
  const keys: Record<string, string> = {}
  const fn: Partial<Record<BindableButton, ButtonBinding>> = {}
  if (stickPad !== null) {
    const k = (b: number, code: string): void => { keys[`${stickPad}:${b}`] = code }
    k(0, 'KeyT') // trigger = PTT → ATC panel / transmit box
    fn.apDisconnect = { pad: stickPad, btn: 1 } // red button
    k(2, 'KeyX') // black thumb = flight assist toggle
    k(3, 'KeyC') // hat push = camera cycle
    k(4, 'KeyU') // L1 gear
    k(5, 'KeyF') // L2 flaps down a step
    k(6, 'KeyG') // L3 flaps up a step
    k(7, 'KeyV') // R1 spoiler lever cycle
    k(8, 'KeyZ') // R2 reverse toggle
    k(9, 'KeyB') // R3 brakes (held)
    k(10, 'KeyM') // plane menu
    k(11, 'Space') // pause
    k(12, 'KeyO') // save
    k(13, 'KeyP') // load
    k(14, 'KeyR') // reset/respawn
    k(15, 'KeyQ') // mute
    // Indices 16+ are NOT preset: on the live unit button 16 read pressed
    // at rest (a latching base switch or hat-as-button), and a held trim
    // alias there would run the trim away — the J wizard binds hats from
    // real motion instead.
  }
  if (quadPad !== null) {
    fn.reverse = { pad: quadPad, btn: 0 } // ENG1 reverse lift (held)
    keys[`${quadPad}:1`] = 'KeyZ' // ENG2 lift = reverse toggle as well
  }
  return { keys, fn }
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
    // A pad ABSENT from the baseline just connected mid-capture — its
    // resting axes (sliders park at −1) read as a full-swing "movement"
    // and insta-bound the wrong axis. Only pads present at capture
    // start participate.
    const b = before[p]
    if (!b) continue
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
      if (k === 'v') { if (typeof v === 'number') out.v = v; continue }
      if (k === 'btnKeys') {
        const bk: Record<string, string> = {}
        for (const [kk, vv] of Object.entries(v as Record<string, unknown>)) if (typeof vv === 'string') bk[kk] = vv
        out.btnKeys = bk
        continue
      }
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

/** Thrustmaster TCA (Airbus edition) device matchers + preset, set
 *  from the user's ACTUAL hardware readings (2026-08-13):
 *    pad "TCA Sidestick X Copilot (044f:040f)": 10 axes — roll 0, pitch
 *      1, twist rudder 5, base slider 6 (axes 2-4 unused, read 0).
 *    pad "TCA Q-Eng 1&2 (044f:0407)": 7 axes — lever 1 = axis 0, lever 2
 *      = axis 1, IDLE reads −1 (so sign +1 maps idle→0, TOGA→1). The v1
 *      guess used sign −1 and turned idle levers into FULL thrust — the
 *      source of every "runaway throttle" incident in the log.
 *  Assumes the levers are parked at idle when the preset applies; the
 *  J wizard rebinds from real movement if they weren't. */
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
    map.yaw = { pad: stick.index, axis: stick.axes >= 7 ? 5 : 2, sign: 1 }
    if (!quadrant) map.throttle = { pad: stick.index, axis: stick.axes >= 7 ? 6 : 3, sign: -1 }
  }
  if (quadrant) {
    // CONFIRMED live (2026-08-13): idle reads axis −1, TOGA reads axis
    // +1 (the resting/TOGA-detent reads matched sign +1 giving correct
    // 0%/100%). A LATER uncommitted edit flipped this to −1 on an
    // unverified guess and shipped a real regression — reported by the
    // user as "push forward, throttle % goes DOWN". Do not flip this
    // again without a live axis reading at both idle and TOGA.
    map.throttle = { pad: quadrant.index, axis: 0, sign: 1 }
    map.throttle2 = { pad: quadrant.index, axis: 1, sign: 1 }
  }
  if (!Object.keys(map).length) return null
  const btns = tcaButtonPreset(stick ? stick.index : null, quadrant ? quadrant.index : null)
  map.btnKeys = btns.keys
  map.btn = btns.fn
  map.v = TCA_PRESET_VERSION
  return map
}

/** The near-universal single-stick layout: roll/pitch on 0/1, twist
 *  rudder on 2, throttle slider on 3 (full forward reports −1). */
export const DEFAULT_SINGLE_STICK: GamepadMap = {
  roll: { pad: 0, axis: 0, sign: 1 },
  pitch: { pad: 0, axis: 1, sign: 1 },
  yaw: { pad: 0, axis: 2, sign: 1 },
  throttle: { pad: 0, axis: 3, sign: -1 },
}
