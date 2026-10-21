/**
 * Flight checklists (pure): challenge / response lists whose items are
 * checked against the REAL state of the airplane where that is possible —
 * the parking brake really is set, the battery really is on — and left for
 * the pilot to tick where it is not (controls free and correct, a visual
 * scan). Items that do not apply to the airplane (a mixture on a jet, gear
 * on a fixed-gear trainer) are not shown.
 *
 * Nothing here knows about three.js, the DOM or the aircraft model.
 */

export interface ChecklistState {
  onGround: boolean
  parkingBrake: boolean
  engineRunning: boolean
  /** Throttle lever, 0 (idle) … 1 (full). */
  throttle: number
  masterBattery: boolean
  alternator: boolean
  avionics: boolean
  magneto: string
  mixtureRich: boolean
  fuelSelector: string
  /** Fuel on board is above the low-fuel threshold. */
  fuelOk: boolean
  pitotHeat: boolean
  landingLight: boolean
  flapsDeg: number
  /** The airplane's landing flap setting, deg (its largest detent ≤ 40). */
  landingFlapsDeg: number
  /** Elevator trim, −1 … 1. */
  trim: number
  gearRetractable: boolean
  gearDown: boolean
  kias: number
  aglFt: number
  groundSpeedKt: number
  apMaster: boolean
  isJet: boolean
  /** A piston engine with a mixture control. */
  hasMixture: boolean
  hasSpoilers: boolean
  spoilersArmed: boolean
  spoilersStowed: boolean
  /** Reference landing speed, kt (1.3 × Vs0), for the approach-speed check. */
  vrefKt: number
}

export interface ChecklistItem {
  id: string
  challenge: string
  response: string
  /** Real-state check; omitted = the pilot ticks it. */
  auto?: (s: ChecklistState) => boolean
  /** Hidden when this is false. */
  applies?: (s: ChecklistState) => boolean
}

export interface Checklist {
  id: string
  title: string
  items: ChecklistItem[]
}

const piston = (s: ChecklistState): boolean => !s.isJet

export const CHECKLISTS: Checklist[] = [
  {
    id: 'before-start', title: 'Before start',
    items: [
      { id: 'bs-park', challenge: 'Parking brake', response: 'SET', auto: (s) => s.parkingBrake },
      { id: 'bs-batt', challenge: 'Battery', response: 'ON', auto: (s) => s.masterBattery },
      { id: 'bs-avi', challenge: 'Avionics', response: 'ON', auto: (s) => s.avionics },
      { id: 'bs-fuelsel', challenge: 'Fuel selector', response: 'BOTH', auto: (s) => s.fuelSelector === 'BOTH', applies: piston },
      { id: 'bs-fuel', challenge: 'Fuel quantity', response: 'CHECKED', auto: (s) => s.fuelOk },
      { id: 'bs-mix', challenge: 'Mixture', response: 'RICH', auto: (s) => s.mixtureRich, applies: (s) => s.hasMixture },
      { id: 'bs-thr', challenge: 'Throttle', response: 'IDLE', auto: (s) => s.throttle < 0.1 },
      { id: 'bs-flaps', challenge: 'Flaps', response: 'UP', auto: (s) => s.flapsDeg < 1.5 },
      { id: 'bs-ctl', challenge: 'Flight controls', response: 'FREE AND CORRECT' },
    ],
  },
  {
    id: 'engine-start', title: 'Engine start',
    items: [
      { id: 'es-alt', challenge: 'Alternator', response: 'ON', auto: (s) => s.alternator, applies: piston },
      { id: 'es-mag', challenge: 'Magnetos', response: 'BOTH', auto: (s) => s.magneto === 'both' || s.magneto === 'start', applies: piston },
      { id: 'es-clear', challenge: 'Propeller area', response: 'CLEAR', applies: piston },
      { id: 'es-run', challenge: 'Engine', response: 'RUNNING', auto: (s) => s.engineRunning },
      { id: 'es-idle', challenge: 'Throttle', response: 'IDLE', auto: (s) => s.throttle < 0.35 },
      { id: 'es-park', challenge: 'Parking brake', response: 'SET UNTIL READY', auto: (s) => s.parkingBrake },
    ],
  },
  {
    id: 'before-takeoff', title: 'Before takeoff',
    items: [
      { id: 'bt-eng', challenge: 'Engine', response: 'RUNNING', auto: (s) => s.engineRunning },
      { id: 'bt-park', challenge: 'Parking brake', response: 'RELEASED', auto: (s) => !s.parkingBrake },
      { id: 'bt-flaps', challenge: 'Flaps', response: 'SET FOR TAKEOFF' },
      { id: 'bt-trim', challenge: 'Trim', response: 'TAKEOFF RANGE', auto: (s) => Math.abs(s.trim) < 0.5 },
      { id: 'bt-pitot', challenge: 'Pitot heat', response: 'AS REQUIRED' },
      { id: 'bt-light', challenge: 'Landing light', response: 'ON', auto: (s) => s.landingLight },
      { id: 'bt-ap', challenge: 'Autopilot', response: 'OFF', auto: (s) => !s.apMaster },
      { id: 'bt-ctl', challenge: 'Flight controls', response: 'FREE AND CORRECT' },
      { id: 'bt-brief', challenge: 'Takeoff briefing', response: 'COMPLETE' },
    ],
  },
  {
    id: 'before-landing', title: 'Before landing',
    items: [
      { id: 'ld-light', challenge: 'Landing light', response: 'ON', auto: (s) => s.landingLight },
      { id: 'ld-mix', challenge: 'Mixture', response: 'RICH', auto: (s) => s.mixtureRich, applies: (s) => s.hasMixture },
      { id: 'ld-gear', challenge: 'Landing gear', response: 'DOWN AND LOCKED', auto: (s) => s.gearDown, applies: (s) => s.gearRetractable },
      { id: 'ld-flaps', challenge: 'Flaps', response: 'LANDING', auto: (s) => s.flapsDeg >= s.landingFlapsDeg - 1 },
      { id: 'ld-spoil', challenge: 'Speedbrake', response: 'ARMED', auto: (s) => s.spoilersArmed, applies: (s) => s.hasSpoilers },
      { id: 'ld-speed', challenge: 'Approach speed', response: 'VREF + 5', auto: (s) => s.kias > 0 && Math.abs(s.kias - (s.vrefKt + 5)) <= 12 },
      { id: 'ld-ap', challenge: 'Autopilot', response: 'AS REQUIRED' },
    ],
  },
  {
    id: 'after-landing', title: 'After landing',
    items: [
      { id: 'al-flaps', challenge: 'Flaps', response: 'UP', auto: (s) => s.flapsDeg < 1.5 },
      { id: 'al-spoil', challenge: 'Speedbrake', response: 'STOWED', auto: (s) => s.spoilersStowed, applies: (s) => s.hasSpoilers },
      { id: 'al-light', challenge: 'Landing light', response: 'OFF', auto: (s) => !s.landingLight },
      { id: 'al-pitot', challenge: 'Pitot heat', response: 'OFF', auto: (s) => !s.pitotHeat },
      { id: 'al-ap', challenge: 'Autopilot', response: 'OFF', auto: (s) => !s.apMaster },
      { id: 'al-brake', challenge: 'Brakes', response: 'AS REQUIRED' },
    ],
  },
]

export type ItemStatus = 'done' | 'todo'

export interface ItemView {
  id: string
  challenge: string
  response: string
  /** True when the airplane's real state decides it (the pilot cannot tick it). */
  auto: boolean
  status: ItemStatus
}

/** The items of one checklist that apply to this airplane, each with its
 *  status: auto items follow the real state, manual ones the pilot's ticks. */
export function evaluateChecklist(list: Checklist, s: ChecklistState, ticked: ReadonlySet<string>): ItemView[] {
  return list.items
    .filter((it) => !it.applies || it.applies(s))
    .map((it) => ({
      id: it.id, challenge: it.challenge, response: it.response, auto: !!it.auto,
      status: it.auto ? (it.auto(s) ? 'done' : 'todo') : ticked.has(it.id) ? 'done' : 'todo',
    }))
}

export function checklistProgress(items: readonly ItemView[]): { done: number; total: number; complete: boolean } {
  const done = items.filter((i) => i.status === 'done').length
  return { done, total: items.length, complete: items.length > 0 && done === items.length }
}

/** Which checklist fits the situation. Heuristic, pure: cold airplane on the
 *  ground → before start; engine running and still → before takeoff;
 *  airborne and low and slow-ish → before landing; on the ground and fast →
 *  nothing special until it slows down → after landing. */
export function suggestChecklist(s: ChecklistState): string {
  if (s.onGround) {
    if (!s.engineRunning) return 'before-start'
    if (s.groundSpeedKt < 3 && s.throttle < 0.3 && s.parkingBrake) return 'engine-start'
    if (s.groundSpeedKt < 40 && s.flapsDeg >= s.landingFlapsDeg - 1 && s.landingFlapsDeg > 5) return 'after-landing'
    return 'before-takeoff'
  }
  return s.aglFt < 3500 && s.kias < s.vrefKt * 1.8 ? 'before-landing' : 'before-takeoff'
}
