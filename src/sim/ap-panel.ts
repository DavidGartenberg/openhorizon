/**
 * Flight-guidance panel logic (pure): what pressing AP, HDG, NAV, APR, ALT,
 * VS and FLC does, and how the selector knobs behave — the pilot-facing
 * half of the autopilot, in front of the control laws in `autopilot.ts`.
 *
 * Real-panel behaviours modeled:
 *  - Engagement flies wings level and holds the pitch attitude (ROL / PIT);
 *    nothing else is armed until the pilot asks.
 *  - Selected values (heading bug, altitude, VS, speed) belong to the
 *    pilot: pressing a mode never moves a value the pilot has set, but a
 *    value never touched is synchronized to the airplane when needed
 *    (heading bug to the current heading, speed to the current speed,
 *    altitude to the next 100 ft in the direction of travel).
 *  - ALT holds the altitude at the moment of the press; the selected
 *    altitude is a separate target, ARMED while VS or FLC climb or descend
 *    toward it and captured automatically (ALTS → ALT).
 *  - VS and FLC engage at the current vertical speed / speed.
 *  - NAV needs a flight plan or a tuned VOR/localizer; APR needs a tuned
 *    localizer; otherwise the press is refused with an honest message.
 *  - A mode button pressed again drops back to the basic mode.
 *  - Envelope protection: the autopilot disconnects in unusual attitudes,
 *    near the stall, or past the speed limit.
 *
 * Nothing here knows about three.js, the DOM or the aircraft model.
 */
import type { LateralMode, UnderlyingVerticalMode, VerticalMode } from './autopilot'

export type UserVertical = 'PIT' | 'ALT' | 'VS' | 'FLC' | 'GS'

export interface ApSelections {
  headingDeg: number
  altitudeFt: number
  vsFpm: number
  iasKt: number
}

export interface ApPanel {
  master: boolean
  lateral: LateralMode
  /** The pilot's vertical mode; ALTS arming is derived each frame. */
  vertical: UserVertical
  sel: ApSelections
  /** Altitude captured by the ALT button (feet). */
  altHoldFt: number
  /** Selections the pilot has set by hand (never auto-synchronized). */
  touched: { heading: boolean; altitude: boolean; ias: boolean }
  /** True after the debug hook wrote the targets directly; cleared by any
   *  panel press (see `main.ts`). */
  direct: boolean
}

export interface ApSnapshot {
  headingDeg: number
  altitudeFt: number
  verticalSpeedFpm: number
  iasKt: number
  rollDeg: number
}

export interface ApAvailability {
  /** A flight plan with an active leg. */
  gps: boolean
  /** A VOR or localizer is tuned and received. */
  nav: boolean
  /** A localizer is tuned and received (APR). */
  loc: boolean
  /** The tuned localizer has a glideslope. */
  gs: boolean
}

export interface ApResult {
  panel: ApPanel
  /** What to tell the pilot (omitted = nothing to say). */
  message?: string
}

export const ALT_MIN_FT = 0
export const ALT_MAX_FT = 50_000
export const VS_MAX_FPM = 6000

export function makeApPanel(): ApPanel {
  return {
    master: false, lateral: 'ROL', vertical: 'PIT',
    sel: { headingDeg: 0, altitudeFt: 0, vsFpm: 0, iasKt: 90 },
    altHoldFt: 0,
    touched: { heading: false, altitude: false, ias: false },
    direct: false,
  }
}

const wrap360 = (d: number): number => ((Math.round(d) % 360) + 360) % 360
const round100 = (v: number): number => Math.round(v / 100) * 100
const clone = (p: ApPanel): ApPanel => ({ ...p, sel: { ...p.sel }, touched: { ...p.touched }, direct: false })

/** Next 100 ft above the current altitude — the default selected altitude
 *  when the pilot has not chosen one. */
export function defaultSelectedAltitude(altitudeFt: number): number {
  return Math.max(ALT_MIN_FT, Math.floor(altitudeFt / 100) * 100 + 100)
}

/** Bring untouched selections in line with the airplane. */
function sync(p: ApPanel, s: ApSnapshot): void {
  if (!p.touched.heading) p.sel.headingDeg = wrap360(s.headingDeg) || 360
  if (!p.touched.ias) p.sel.iasKt = Math.max(40, Math.round(s.iasKt))
  if (!p.touched.altitude) p.sel.altitudeFt = defaultSelectedAltitude(s.altitudeFt)
}

/** AP master: engages in ROL / PIT; disengaging drops every mode. */
export function pressAp(p0: ApPanel, s: ApSnapshot): ApResult {
  const p = clone(p0)
  if (p.master) {
    p.master = false; p.lateral = 'ROL'; p.vertical = 'PIT'
    return { panel: p, message: 'AUTOPILOT OFF' }
  }
  sync(p, s)
  p.master = true; p.lateral = 'ROL'; p.vertical = 'PIT'
  return { panel: p, message: 'AUTOPILOT ENGAGED' }
}

/** Disconnect without the toggle (switch on the yoke, envelope fault). */
export function disconnectAp(p0: ApPanel): ApPanel {
  const p = clone(p0)
  p.master = false; p.lateral = 'ROL'; p.vertical = 'PIT'
  return p
}

function needMaster(p: ApPanel): ApResult | null {
  return p.master ? null : { panel: p, message: 'ENGAGE THE AUTOPILOT FIRST' }
}

export function pressHdg(p0: ApPanel, s: ApSnapshot): ApResult {
  const refuse = needMaster(p0)
  if (refuse) return refuse
  const p = clone(p0)
  if (p.lateral === 'HDG') { p.lateral = 'ROL'; return { panel: p, message: 'HDG OFF' } }
  if (!p.touched.heading) p.sel.headingDeg = wrap360(s.headingDeg) || 360
  p.lateral = 'HDG'
  return { panel: p, message: `HDG ${String(p.sel.headingDeg).padStart(3, '0')}°` }
}

export function pressNav(p0: ApPanel, a: ApAvailability): ApResult {
  const refuse = needMaster(p0)
  if (refuse) return refuse
  const p = clone(p0)
  if (p.lateral === 'NAV') { p.lateral = 'ROL'; return { panel: p, message: 'NAV OFF' } }
  if (!a.gps && !a.nav) return { panel: p, message: 'NO NAV SOURCE — LOAD A FLIGHT PLAN OR TUNE A VOR' }
  p.lateral = 'NAV'
  return { panel: p, message: a.gps ? 'NAV — FLIGHT PLAN' : 'NAV — VOR' }
}

export function pressApr(p0: ApPanel, s: ApSnapshot, a: ApAvailability): ApResult {
  const refuse = needMaster(p0)
  if (refuse) return refuse
  const p = clone(p0)
  if (p.lateral === 'APR') {
    p.lateral = 'ROL'
    if (p.vertical === 'GS') p.vertical = 'PIT'
    return { panel: p, message: 'APPROACH OFF' }
  }
  if (!a.loc) return { panel: p, message: 'NO ILS TUNED — TUNE NAV1 TO A LOCALIZER' }
  p.lateral = 'APR'
  if (a.gs) {
    // Glideslope armed from level or a vertical-speed hold, as pilots do.
    if (p.vertical === 'PIT' || p.vertical === 'FLC') { p.vertical = 'VS'; p.sel.vsFpm = round100(s.verticalSpeedFpm) }
    else if (p.vertical === 'ALT') { p.vertical = 'VS'; p.sel.vsFpm = 0 }
    p.vertical = 'GS'
  }
  return { panel: p, message: a.gs ? 'APPROACH ARMED — LOC + GS' : 'APPROACH — LOC ONLY' }
}

export function pressAlt(p0: ApPanel, s: ApSnapshot): ApResult {
  const refuse = needMaster(p0)
  if (refuse) return refuse
  const p = clone(p0)
  if (p.vertical === 'ALT') { p.vertical = 'PIT'; return { panel: p, message: 'ALT HOLD OFF' } }
  p.vertical = 'ALT'
  p.altHoldFt = Math.round(s.altitudeFt / 10) * 10
  return { panel: p, message: `ALT HOLD ${p.altHoldFt} FT` }
}

export function pressVs(p0: ApPanel, s: ApSnapshot): ApResult {
  const refuse = needMaster(p0)
  if (refuse) return refuse
  const p = clone(p0)
  if (p.vertical === 'VS') { p.vertical = 'PIT'; return { panel: p, message: 'VS OFF' } }
  if (!p.touched.altitude) p.sel.altitudeFt = defaultSelectedAltitude(s.altitudeFt)
  p.vertical = 'VS'
  p.sel.vsFpm = Math.max(-VS_MAX_FPM, Math.min(VS_MAX_FPM, round100(s.verticalSpeedFpm)))
  return { panel: p, message: `VS ${p.sel.vsFpm >= 0 ? '+' : ''}${p.sel.vsFpm} FPM` }
}

export function pressFlc(p0: ApPanel, s: ApSnapshot): ApResult {
  const refuse = needMaster(p0)
  if (refuse) return refuse
  const p = clone(p0)
  if (p.vertical === 'FLC') { p.vertical = 'PIT'; return { panel: p, message: 'FLC OFF' } }
  if (!p.touched.ias) p.sel.iasKt = Math.max(40, Math.round(s.iasKt))
  p.vertical = 'FLC'
  return { panel: p, message: `FLC ${p.sel.iasKt} KT` }
}

export type Knob = 'heading' | 'altitude' | 'vs' | 'ias'

/** Turn a selector knob by `steps` detents (negative = down). Altitude moves
 *  100 ft per step (pass 10 for a 1,000 ft turn); VS 100 fpm; speed 1 kt;
 *  heading 1°. */
export function turnKnob(p0: ApPanel, knob: Knob, steps: number, snap?: ApSnapshot): ApPanel {
  const p = clone(p0)
  switch (knob) {
    case 'heading': {
      if (!p.touched.heading && snap) p.sel.headingDeg = wrap360(snap.headingDeg)
      p.sel.headingDeg = wrap360(p.sel.headingDeg + steps) || 360
      p.touched.heading = true
      break
    }
    case 'altitude': {
      if (!p.touched.altitude && snap) p.sel.altitudeFt = defaultSelectedAltitude(snap.altitudeFt)
      p.sel.altitudeFt = Math.max(ALT_MIN_FT, Math.min(ALT_MAX_FT, p.sel.altitudeFt + steps * 100))
      p.touched.altitude = true
      break
    }
    case 'vs':
      p.sel.vsFpm = Math.max(-VS_MAX_FPM, Math.min(VS_MAX_FPM, p.sel.vsFpm + steps * 100))
      break
    case 'ias': {
      if (!p.touched.ias && snap) p.sel.iasKt = Math.max(40, Math.round(snap.iasKt))
      p.sel.iasKt = Math.max(40, Math.min(600, p.sel.iasKt + steps))
      p.touched.ias = true
      break
    }
  }
  return p
}

/** Direction (+1 up, −1 down, 0 none) in which the current vertical mode
 *  moves the airplane, for deciding whether the selected altitude is ahead. */
function motionDirection(p: ApPanel, s: ApSnapshot): number {
  if (p.vertical === 'VS') return Math.sign(p.sel.vsFpm)
  if (p.vertical === 'FLC') return Math.sign(p.sel.altitudeFt - s.altitudeFt)
  return 0
}

export interface ApFeedback {
  /** The control law reports the armed altitude capture has happened. */
  altsCaptured: boolean
}

/** Fold the control law's state back into the panel: once the armed
 *  altitude capture has happened the airplane is in ALT hold at the
 *  captured altitude, and the panel must say so — otherwise VS / FLC would
 *  carry on through the selected altitude. */
export function applyApFeedback(p: ApPanel, f: ApFeedback): ApPanel {
  if (p.master && f.altsCaptured && (p.vertical === 'VS' || p.vertical === 'FLC')) {
    return { ...p, sel: { ...p.sel }, touched: { ...p.touched }, vertical: 'ALT', altHoldFt: p.sel.altitudeFt }
  }
  return p
}

export interface ApTargetsOut {
  lateralMode: LateralMode
  verticalMode: VerticalMode
  underlyingVerticalMode: UnderlyingVerticalMode
  headingBugDeg: number
  altitudeBugFt: number
  vsTargetFpm: number
  iasTargetKt: number
}

/** Translate the panel to the control laws' targets for this frame: arms
 *  the altitude capture (ALTS) while VS / FLC head for the selected
 *  altitude, and feeds ALT its captured value. */
export function toApTargets(p: ApPanel, s: ApSnapshot): ApTargetsOut {
  const dir = motionDirection(p, s)
  // Armed whenever the mode is heading for the selected altitude — right up
  // to the capture itself (which the control law decides, with a lead
  // distance that grows with the climb or descent rate).
  const towardSel = p.sel.altitudeFt > 0 && Math.sign(p.sel.altitudeFt - s.altitudeFt) === dir && dir !== 0
  let verticalMode: VerticalMode = p.vertical
  let underlying: UnderlyingVerticalMode = 'VS'
  let altitudeBug = p.vertical === 'ALT' ? p.altHoldFt : p.sel.altitudeFt
  if ((p.vertical === 'VS' || p.vertical === 'FLC') && towardSel) {
    verticalMode = 'ALTS'
    underlying = p.vertical === 'FLC' ? 'FLC' : 'VS'
  } else if (p.vertical === 'GS') {
    verticalMode = 'GS'
    underlying = 'VS'
    altitudeBug = p.sel.altitudeFt
  } else if (p.vertical === 'VS' || p.vertical === 'FLC') {
    verticalMode = p.vertical
  }
  return {
    lateralMode: p.lateral,
    verticalMode,
    underlyingVerticalMode: underlying,
    headingBugDeg: p.sel.headingDeg,
    altitudeBugFt: altitudeBug,
    vsTargetFpm: p.sel.vsFpm,
    iasTargetKt: p.sel.iasKt,
  }
}

export interface EnvelopeInput {
  rollDeg: number
  pitchDeg: number
  kias: number
  vneKt: number
  stallFraction: number
  onGround: boolean
}

/** Reasons the autopilot must disconnect itself, or null. Real flight
 *  guidance systems drop out in unusual attitudes, at the stall warning
 *  and beyond the speed limit rather than fly the airplane into them. */
export function apEnvelopeFault(e: EnvelopeInput): string | null {
  if (e.onGround) return 'ON THE GROUND'
  if (Math.abs(e.rollDeg) > 65) return 'BANK ANGLE'
  if (e.pitchDeg > 30 || e.pitchDeg < -25) return 'PITCH ATTITUDE'
  if (e.stallFraction > 0.5) return 'STALL'
  if (e.kias > e.vneKt * 1.02) return 'OVERSPEED'
  return null
}
