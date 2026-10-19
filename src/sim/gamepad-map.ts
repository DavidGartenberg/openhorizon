/**
 * Gamepad mapping core (16a) — pure, no navigator access. The capture
 * convention: the pilot moves an axis to the function's POSITIVE
 * extreme (nose UP, RIGHT roll, RIGHT rudder, full throttle, mixture
 * RICH, brakes ON) and the observed movement direction becomes the
 * binding's +1 — inverted hardware never needs a checkbox. Unipolar
 * functions map the signed axis onto [0,1]. The driver in main.ts owns
 * polling and control application.
 */

export type BindableAxis = 'pitch' | 'roll' | 'yaw' | 'throttle' | 'throttle2' | 'mixture' | 'brakes' | 'flaps' | 'speedbrake'

/** Momentary/toggle functions bindable to gamepad buttons (16a-b: the
 *  TCA quadrant's switches and the sidestick's buttons). */
export type BindableButton =
  | 'gear' | 'flapsUp' | 'flapsDown' | 'trimUp' | 'trimDown'
  | 'apDisconnect' | 'brakes' | 'reverse' | 'reverse2' | 'ptt'
  | 'parkingBrake' | 'engineMaster1' | 'engineMaster2' | 'ignitionCrank' | 'ignitionNorm' | 'ignitionStart'
  | 'gearDown' | 'gearUp' | 'autobrakeOff' | 'autobrakeLow' | 'autobrakeMedium' | 'autobrakeMax' | 'autobrakeRto'
  | 'rudderTrimLeft' | 'rudderTrimRight' | 'rudderTrimReset' | 'speedbrakeArm'
  | 'flaps0' | 'flaps1' | 'flaps2' | 'flaps3' | 'flapsFull' | 'speedbrakeDown' | 'speedbrakeFull'

export interface ButtonBinding {
  deviceId?: string
  source?: 'preset' | 'user'
  pad: number
  btn: number
}

export interface AxisCalibration { min: number; max: number; idle?: number; cl?: number; flex?: number }
export interface AxisBinding {
  deviceId?: string
  source?: 'preset' | 'user'
  calibration?: AxisCalibration
  pad: number
  axis: number
  sign: 1 | -1
}

export type GamepadMap = Partial<Record<BindableAxis, AxisBinding>> & {
  btn?: Partial<Record<BindableButton, ButtonBinding>>
  /** Preset schema version — lets a corrected preset overwrite bindings a
   *  WRONG earlier preset saved (the v1 TCA guess inverted the quadrant). */
  v?: number
  devices?: Record<string, string>
  /** Key-alias buttons: "pad:btn" → KeyboardEvent.code. A press injects a
   *  one-frame key so the existing discrete handlers serve the stick;
   *  entries whose code is listed in HELD_ALIASES mirror held state. */
  btnKeys?: Record<string, string>
  /** Retained legacy aliases whose former device identity is unknown. Never polled. */
  unverifiedBtnKeys?: Record<string, string>
}

export const TCA_PRESET_VERSION = 7

/** Key aliases that act while HELD (everything else is edge-triggered). */
export const HELD_ALIASES: ReadonlySet<string> = new Set(['KeyT', 'KeyB', 'KeyW', 'KeyS', 'KeyA', 'KeyD', 'Comma', 'Period'])

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
    k(0, 'KeyT') // trigger = hold to talk
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
    fn.reverse2 = { pad: quadPad, btn: 1 } // symmetric held ENG2 lift
  }
  return { keys, fn }
}

export const UNIPOLAR: ReadonlySet<BindableAxis> = new Set(['throttle', 'throttle2', 'mixture', 'brakes', 'flaps', 'speedbrake'])

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
      if (!Number.isFinite(a[i]) || !Number.isFinite(b[i])) continue
      const d = a[i]! - b[i]!
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
      if (i < b.length && a[i] && !b[i]) return { pad: p, btn: i }
    }
  }
  return null
}

/** Calibration is in signed physical axis coordinates. A measured IDLE of -1
 * has no below-idle travel; reverse then comes only from held lift buttons.
 * Capture a higher IDLE to enable analog reverse within the Gamepad range. */
export function leverWithReverse(rawSigned: number, cal: AxisCalibration = { min: -1, max: 1, idle: -1 }): { power: number; reverse: boolean } {
  const idle = cal.idle ?? cal.min
  if (rawSigned < idle - 0.025 && idle > cal.min + 0.05) {
    return { power: clamp((idle - rawSigned) / (idle - cal.min)), reverse: true }
  }
  return { power: clamp((rawSigned - idle) / (cal.max - idle)), reverse: false }
}
const clamp = (v: number): number => Math.min(1, Math.max(0, v))
export interface LeverCommand { power: number; reverse: boolean }
/** One common thrust/reverser model: opposing levers command idle, never
 * convert reverse power into forward thrust. Individual readings remain visible. */
export function combineLevers(levers: LeverCommand[]): LeverCommand & { mixed: boolean } {
  const powered = levers.filter(l => l.power > .02)
  const mixed = levers.some(l => l.reverse) && powered.some(l => !l.reverse)
  return { power: mixed || !levers.length ? 0 : levers.reduce((s,l)=>s+l.power,0)/levers.length,
    reverse: !mixed && levers.some(l=>l.reverse), mixed }
}
export const AXIS_FUNCTIONS: BindableAxis[] = ['pitch','roll','yaw','throttle','throttle2','mixture','brakes','flaps','speedbrake']
export const BUTTON_FUNCTIONS: BindableButton[] = ['gear','flapsUp','flapsDown','trimUp','trimDown','apDisconnect','brakes','reverse','reverse2','ptt','parkingBrake','engineMaster1','engineMaster2','ignitionCrank','ignitionNorm','ignitionStart','gearDown','gearUp','autobrakeOff','autobrakeLow','autobrakeMedium','autobrakeMax','autobrakeRto','rudderTrimLeft','rudderTrimRight','rudderTrimReset','speedbrakeArm','flaps0','flaps1','flaps2','flaps3','flapsFull','speedbrakeDown','speedbrakeFull']
const validIndex = (n: unknown): n is number => typeof n === 'number' && Number.isInteger(n) && n >= 0 && n < 256
const record = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v)
export function validCalibration(c: unknown): c is AxisCalibration {
  if (!record(c)) return false
  const finite = (n: unknown): n is number => typeof n === 'number' && Number.isFinite(n) && n >= -1 && n <= 1
  if (!finite(c.min) || !finite(c.max) || c.max - c.min < .1) return false
  if (c.idle !== undefined && (!finite(c.idle) || c.idle < c.min || c.idle > c.max - .1)) return false
  for (const k of ['cl','flex']) if(c[k] !== undefined && (!finite(c[k]) || (c[k] as number) < (c.idle as number ?? c.min) || (c[k] as number) > c.max)) return false
  return c.cl === undefined || c.flex === undefined || (c.cl as number) < (c.flex as number)
}
export function parseGamepadMap(s: string): GamepadMap | null {
  try {
    const raw: unknown = JSON.parse(s)
    if (!record(raw)) return null
    for (const [key,value] of Object.entries(raw)) {
      if (key === 'v') { if(!validIndex(value)) return null; continue }
      if (key === 'devices') {
        if(!record(value) || Object.entries(value).some(([k,v])=>!validIndex(Number(k)) || typeof v!=='string' || !v)) return null
        continue
      }
      if (key === 'btnKeys' || key === 'unverifiedBtnKeys') {
        if(!record(value) || Object.entries(value).some(([k,v])=>!/^\d+:\d+$/.test(k) || k.split(':').some(n=>!validIndex(Number(n))) || typeof v!=='string' || !/^(Key[A-Z]|Digit[0-9]|Arrow(Up|Down|Left|Right)|Space|Comma|Period|Backquote)$/.test(v))) return null
        continue
      }
      const validBinding = (v: unknown, axis: boolean): boolean => record(v) && (v.source===undefined || v.source==='preset' || v.source==='user') && validIndex(v.pad) && validIndex(v[axis?'axis':'btn']) && (v.deviceId === undefined || typeof v.deviceId==='string' && !!v.deviceId) && (!axis || (v.sign===1 || v.sign===-1) && (v.calibration===undefined || validCalibration(v.calibration)))
      if (key === 'btn') {
        if(!record(value) || Object.entries(value).some(([k,v])=>!BUTTON_FUNCTIONS.includes(k as BindableButton) || !validBinding(v,false))) return null
      } else if(!AXIS_FUNCTIONS.includes(key as BindableAxis) || !validBinding(value,true)) return null
    }
    return raw as GamepadMap
  } catch { return null }
}
export interface PadReading { id: string; index: number; connected?: boolean; axes: readonly number[]; buttons: readonly { pressed: boolean }[] }
export function resolvePad(map: GamepadMap, b: {pad:number;deviceId?:string}, pads: readonly (PadReading|null)[]): PadReading | null {
  const id = b.deviceId ?? map.devices?.[String(b.pad)]
  if(!id) return null // legacy custom maps must be explicitly identified/captured
  const found = pads.filter((p):p is PadReading=>!!p && p.connected!==false && p.id===id)
  return found.length===1 ? found[0]! : null // identical duplicate IDs are ambiguous
}
export function readAxis(map: GamepadMap, fn: BindableAxis, pads: readonly (PadReading|null)[]): number|null {
  const b=map[fn]; if(!b?.deviceId) return null
  const raw=resolvePad(map,b,pads)?.axes[b.axis]
  return typeof raw==='number' && Number.isFinite(raw) && Math.abs(raw)<=1.001 ? Math.min(1,Math.max(-1,raw))*b.sign : null
}
export function readButton(map: GamepadMap, fn: BindableButton, pads: readonly (PadReading|null)[]): boolean|null {
  const b=map.btn?.[fn]; if(!b?.deviceId) return null
  return resolvePad(map,b,pads)?.buttons[b.btn]?.pressed ?? null
}
export function readAlias(map: GamepadMap,key:string,pads:readonly(PadReading|null)[]):boolean|null {
  if(!map.btnKeys?.[key])return null
  const [pad,btn]=key.split(':').map(Number)
  return resolvePad(map,{pad:pad!},pads)?.buttons[btn!]?.pressed ?? null
}
export function calibratedUnipolar(raw:number,b?:AxisBinding):number {
  const c=b?.calibration
  return c ? clamp((raw-c.min)/(c.max-c.min)) : axisToUnipolar(raw)
}
export function mergePreset(saved: GamepadMap, incoming: GamepadMap): GamepadMap {
  const devices={...saved.devices}
  const slots=new Map<number,number>()
  for(const [slot,id] of Object.entries(incoming.devices??{})){
    const known=Object.entries(devices).find(([,v])=>v===id)?.[0]
    let target=known===undefined?Number(slot):Number(known)
    if(known===undefined && devices[String(target)]){target=0;while(devices[String(target)])target++}
    devices[String(target)]=id;slots.set(Number(slot),target)
  }
  const remap=<T extends {pad:number}>(b:T):T=>({...b,pad:slots.get(b.pad)??b.pad})
  const preset:GamepadMap={...incoming,btn:{},btnKeys:{},devices}
  for(const fn of AXIS_FUNCTIONS)if(incoming[fn])preset[fn]=remap(incoming[fn]!)
  for(const [fn,b] of Object.entries(incoming.btn??{}))preset.btn![fn as BindableButton]=remap(b)
  for(const [key,code] of Object.entries(incoming.btnKeys??{})){const [pad,btn]=key.split(':');preset.btnKeys![`${slots.get(Number(pad))??pad}:${btn}`]=code}
  const out:GamepadMap={...saved,btn:{...saved.btn},btnKeys:{},unverifiedBtnKeys:{...saved.unverifiedBtnKeys},devices,v:TCA_PRESET_VERSION}
  // Incoming device discovery cannot authorize aliases left by an unknown
  // former controller. Only prior identity or an exact known preset action
  // establishes ownership; quarantine all other legacy values for recapture.
  for(const [key,code] of Object.entries(saved.btnKeys??{})){
    const slot=key.split(':')[0]!
    if(saved.devices?.[slot] || preset.btnKeys?.[key]===code)out.btnKeys![key]=code
    else out.unverifiedBtnKeys![key]=code
  }
  for(const fn of AXIS_FUNCTIONS){
    const p=preset[fn],s=saved[fn]; if(!p)continue
    if(!s || fn==='throttle' && s.source==='preset' && !s.calibration && /q-eng|quadrant/i.test(p.deviceId??'')) out[fn]=p
    else if(!s.deviceId && s.pad===p.pad && s.axis===p.axis){
      out[fn]={...s,deviceId:p.deviceId,sign:s.calibration?s.sign:(saved.v??0)<2?p.sign:s.sign}
    }
  }
  for(const fn of BUTTON_FUNCTIONS){const p=preset.btn?.[fn],s=saved.btn?.[fn];if(!p)continue;const occupied=Object.entries(saved.btn??{}).some(([other,b])=>other!==fn && b.deviceId===p.deviceId && b.btn===p.btn);if(!occupied && (!s || !s.deviceId && s.pad===p.pad && s.btn===p.btn))out.btn![fn]={...p,...s,deviceId:p.deviceId}}
  // Never give a captured physical button a second preset action on reconnect.
  for(const [k,v] of Object.entries(preset.btnKeys??{})){
    const [slot,btn]=k.split(':');const id=devices[slot!]
    const captured=Object.values(saved.btn??{}).some(b=>b.deviceId===id && b.btn===Number(btn))
    if(!out.btnKeys![k] && !captured)out.btnKeys![k]=v
  }
  const r2=preset.btn?.reverse2
  if(r2 && (saved.v??0)<7 && out.btnKeys![`${r2.pad}:${r2.btn}`]==='KeyZ')delete out.btnKeys![`${r2.pad}:${r2.btn}`]
  return out
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
export const TCA_DEVICE = /(?:tca.*(?:sidestick|stick.*airbus|q-eng)|t\.a320)/i
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
  map.devices = Object.fromEntries(tca.map(p=>[String(p.index),p.id]))
  for(const fn of AXIS_FUNCTIONS)if(map[fn]){map[fn]!.deviceId=map.devices[String(map[fn]!.pad)];map[fn]!.source='preset'}
  for(const b of Object.values(map.btn??{})){b.deviceId=map.devices[String(b.pad)];b.source='preset'}
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
