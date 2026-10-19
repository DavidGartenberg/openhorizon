/**
 * Boeing 737NG aural-alert logic — pure, no DOM/audio. Decides WHICH of the
 * flight deck's non-voice aurals is sounding, from the airplane's real
 * state. Conditions follow the published 737NG warning-system descriptions
 * (FCOM 15 "Warning Systems"); the sounds themselves are synthesized in
 * `audio/boeing-aurals-audio.ts` (no Boeing recordings are shipped).
 *
 *  - Takeoff configuration: INTERMITTENT horn — on the ground, a forward
 *    thrust lever advanced for takeoff while flaps are outside the takeoff
 *    range (1–25), the speedbrake lever is not DOWN, the parking brake is
 *    set, or the stabilizer trim is outside the green band.
 *  - Landing gear configuration: STEADY horn — airborne, any gear not down
 *    and locked, and (flaps ≥ 15 with thrust levers at idle) or flaps > 25
 *    at any thrust, or (flaps 1–10, idle, below 800 ft RA). The low-flap
 *    case is the one HORN CUTOUT can silence.
 *  - Mach/airspeed: CLACKER above Vmo or Mmo.
 *  - Stall: STICK SHAKER airborne as the AoA vane approaches stall.
 *  - Autopilot disconnect: two-tone WAILER, minimum two seconds after any
 *    disengagement (a second disconnect press silences it early).
 *  - Altitude alert: momentary TONE when the airplane deviates more than
 *    300 ft from the selected altitude after having captured it.
 *  - Fire: BELL — no engine-fire model exists, so only the FIRE WARN TEST
 *    sounds it (never faked from an unmodeled condition).
 */

export type ContinuousAural = 'fireBell' | 'configHorn' | 'gearHorn' | 'clacker' | 'stickShaker' | 'apWailer'
export type OneShotAural = 'altAlert'

export interface AuralObs {
  onGround: boolean
  kias: number
  vmoKt: number
  mach?: number
  mmo?: number
  /** 0 = far from stall … 1 = at stall (aircraft.data.stallFraction). */
  stallFraction: number
  alphaDeg: number
  /** Thrust lever position 0..1 (forward thrust; reverse is separate). */
  throttle: number
  flapsDeg: number
  /** All gear down and locked. */
  gearDownLocked: boolean
  gearRetractable: boolean
  radioAltFt: number
  speedbrakeStowed: boolean
  parkingBrake: boolean
  /** Stabilizer within the takeoff green band (true when untracked). */
  stabInGreenBand: boolean
  apEngaged: boolean
  altitudeFt: number
  selectedAltFt: number
  /** Pilot pressed the AP disconnect switch this frame. */
  apDisconnectPressed?: boolean
  /** HORN CUTOUT pressed this frame. */
  hornCutout?: boolean
  /** FIRE WARN test switch held. */
  fireTest?: boolean
}

export interface AuralLatches {
  wailerUntilS: number
  wasApEngaged: boolean
  /** Selected altitude the airplane has captured (within 200 ft), or NaN. */
  capturedAltFt: number
  altAlertFired: boolean
  hornCutoutLatched: boolean
}

export function makeAuralLatches(): AuralLatches {
  return { wailerUntilS: -Infinity, wasApEngaged: false, capturedAltFt: Number.NaN, altAlertFired: false, hornCutoutLatched: false }
}

/** Thrust lever "advanced for takeoff" (≈ the 737's takeoff-warning arm). */
const TAKEOFF_LEVER = 0.6
/** Thrust levers "at idle" for the gear horn. */
const IDLE_LEVER = 0.08
export const WAILER_MIN_S = 2

export interface AuralOutput {
  continuous: Set<ContinuousAural>
  oneShots: OneShotAural[]
}

export function boeingAurals(o: AuralObs, L: AuralLatches, nowS: number): AuralOutput {
  const continuous = new Set<ContinuousAural>()
  const oneShots: OneShotAural[] = []

  if (o.fireTest) continuous.add('fireBell')

  // Takeoff configuration warning.
  if (o.onGround && o.throttle >= TAKEOFF_LEVER) {
    const flapsOk = o.flapsDeg >= 0.5 && o.flapsDeg <= 25.5
    if (!flapsOk || !o.speedbrakeStowed || o.parkingBrake || !o.stabInGreenBand) continuous.add('configHorn')
  }

  // Landing gear configuration warning.
  if (o.gearRetractable && !o.onGround && !o.gearDownLocked) {
    const idle = o.throttle <= IDLE_LEVER
    const lowFlap = o.flapsDeg >= 0.5 && o.flapsDeg < 14.5 && idle && o.radioAltFt < 800
    const midFlap = o.flapsDeg >= 14.5 && o.flapsDeg <= 25.5 && idle
    const landingFlap = o.flapsDeg > 25.5
    if (o.hornCutout && lowFlap) L.hornCutoutLatched = true
    if (!lowFlap) L.hornCutoutLatched = false
    if (midFlap || landingFlap || (lowFlap && !L.hornCutoutLatched)) continuous.add('gearHorn')
  } else {
    L.hornCutoutLatched = false
  }

  // Mach/airspeed warning.
  if (o.kias > o.vmoKt || (o.mach !== undefined && o.mmo !== undefined && o.mach > o.mmo)) continuous.add('clacker')

  // Stall warning (stick shaker): only the positive-AoA branch shakes.
  if (!o.onGround && o.stallFraction > 0.12 && o.alphaDeg > 0) continuous.add('stickShaker')

  // Autopilot disconnect wailer.
  if (L.wasApEngaged && !o.apEngaged) L.wailerUntilS = nowS + WAILER_MIN_S
  else if (!L.wasApEngaged && !o.apEngaged && o.apDisconnectPressed && nowS < L.wailerUntilS) L.wailerUntilS = -Infinity
  if (o.apEngaged) L.wailerUntilS = -Infinity
  L.wasApEngaged = o.apEngaged
  if (nowS < L.wailerUntilS) continuous.add('apWailer')

  // Altitude alert: deviation from a captured selected altitude.
  if (o.selectedAltFt !== L.capturedAltFt && Number.isFinite(L.capturedAltFt)) {
    // A new altitude was selected: re-arm and forget the old capture.
    L.capturedAltFt = Number.NaN
    L.altAlertFired = false
  }
  const dev = Math.abs(o.altitudeFt - o.selectedAltFt)
  if (!o.onGround && dev <= 200) { L.capturedAltFt = o.selectedAltFt; L.altAlertFired = false }
  else if (Number.isFinite(L.capturedAltFt) && dev > 300 && !L.altAlertFired && !o.onGround) {
    L.altAlertFired = true
    oneShots.push('altAlert')
  }

  return { continuous, oneShots }
}
