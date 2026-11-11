/**
 * Airliner spoiler panels (pure, headless).
 *
 * A transport's wing carries a row of spoiler panels. They do three jobs and each panel takes part in some of them:
 *
 *  - **ground spoilers**: on the ground (armed at touchdown, or the lever pulled up, or reverse selected on the roll) every
 *    panel goes fully up, in a quick cascade from the wing root outward, to dump lift and put the weight on the wheels;
 *  - **speedbrakes**: in the air the lever raises the middle panels together, slowly, to a partial angle that the airflow
 *    pushes back down at high speed (blowdown), and some types stow them as the flaps reach full;
 *  - **roll spoilers**: the panels on the wing the airplane is rolling toward rise a little with aileron, on top of
 *    whatever the speedbrake is doing.
 *
 * Panels are numbered 0 (inboard) … n−1 (outboard) on each wing; `left` and `right` hold each panel's angle in degrees.
 * Angles, rates and which panel does what are typical of each family rather than any one airplane's data: they are
 * recorded here as approximations (the speedbrake and roll panel sets follow the published A320 / A330 / 737 arrangements
 * in outline; the rates are set so a ground cascade finishes in about a second and a half and a speedbrake takes about
 * three seconds).
 */

export type SpoilerFamily = 'a320' | 'a330' | 'a350' | 'a380' | 'b737' | 'wide' | 'regional' | 'bizjet'

export interface SpoilerPanelSpec { ground: boolean; brake: boolean; roll: boolean }

export interface SpoilerLayout {
  family: SpoilerFamily
  panels: SpoilerPanelSpec[]
  /** Angle of a panel standing as a ground spoiler, degrees. */
  groundMaxDeg: number
  /** Angle of a speedbrake panel at full lever in still air, degrees. */
  flightMaxDeg: number
  /** Angle a roll spoiler reaches at full aileron, degrees. */
  rollMaxDeg: number
  /** Panel speeds, degrees per second: ground extension, ground retraction, and either way in flight. */
  groundRateDegS: number
  groundRetractDegS: number
  flightRateDegS: number
  /** Each panel starts its ground extension this much later than the one inboard of it. */
  staggerS: number
  /** Airspeed range (KCAS) over which the airflow pushes the speedbrakes back down, and the share it takes at the top. */
  blowdownKcas: [number, number]
  blowdownShare: number
  /** The speedbrakes stow themselves in the air when the flaps are at their last gate (Airbus). */
  flapsFullStowsBrakes: boolean
}

/** Panels as `ground/brake/roll` strings of 1s and 0s, inboard to outboard. */
const panels = (ground: string, brake: string, roll: string): SpoilerPanelSpec[] =>
  Array.from(ground, (g, i) => ({ ground: g === '1', brake: brake[i] === '1', roll: roll[i] === '1' }))

const COMMON = { groundRateDegS: 40, groundRetractDegS: 28, flightRateDegS: 10, staggerS: 0.08, blowdownKcas: [230, 340] as [number, number], blowdownShare: 0.35 }

export const SPOILER_LAYOUTS: Readonly<Record<SpoilerFamily, SpoilerLayout>> = {
  // A320 family: five panels a wing; speedbrakes are 2–4, roll 2–5, ground all five.
  a320: { family: 'a320', panels: panels('11111', '01110', '01111'), groundMaxDeg: 50, flightMaxDeg: 25, rollMaxDeg: 35, flapsFullStowsBrakes: true, ...COMMON },
  // A330 / A340: six panels; speedbrakes 2–5, roll 2–6, ground all six.
  a330: { family: 'a330', panels: panels('111111', '011110', '011111'), groundMaxDeg: 50, flightMaxDeg: 25, rollMaxDeg: 35, flapsFullStowsBrakes: true, ...COMMON },
  a350: { family: 'a350', panels: panels('111111', '011110', '011111'), groundMaxDeg: 50, flightMaxDeg: 30, rollMaxDeg: 35, flapsFullStowsBrakes: true, ...COMMON },
  a380: { family: 'a380', panels: panels('11111111', '01111110', '01111111'), groundMaxDeg: 50, flightMaxDeg: 30, rollMaxDeg: 35, flapsFullStowsBrakes: true, ...COMMON },
  // 737: four flight spoilers a wing, all of which brake, roll and (with the ground pair) dump.
  b737: { family: 'b737', panels: panels('1111', '1111', '1111'), groundMaxDeg: 60, flightMaxDeg: 33, rollMaxDeg: 40, flapsFullStowsBrakes: false, ...COMMON },
  wide: { family: 'wide', panels: panels('1111111', '0111110', '1111111'), groundMaxDeg: 60, flightMaxDeg: 35, rollMaxDeg: 40, flapsFullStowsBrakes: false, ...COMMON },
  regional: { family: 'regional', panels: panels('111', '111', '111'), groundMaxDeg: 55, flightMaxDeg: 40, rollMaxDeg: 40, flapsFullStowsBrakes: false, ...COMMON },
  bizjet: { family: 'bizjet', panels: panels('11', '11', '00'), groundMaxDeg: 55, flightMaxDeg: 40, rollMaxDeg: 40, flapsFullStowsBrakes: false, ...COMMON },
}

/** Which family of spoiler arrangement a type flies, from its ICAO type designator (best guess for anything unlisted). */
export function spoilerFamilyFor(designator: string, engines = 2): SpoilerFamily {
  const d = designator.toUpperCase()
  if (/^(A318|A319|A320|A321|A20N|A21N|BCS)/.test(d)) return 'a320'
  if (/^(A33|A34|A30|A31[0-9]|A3ST)/.test(d) && !/^A31[89]/.test(d)) return 'a330'
  if (/^A35/.test(d)) return 'a350'
  if (/^A38/.test(d)) return 'a380'
  if (/^(B73|B37)/.test(d)) return 'b737'
  if (/^(B74|B75|B76|B77|B78|MD1|DC1|DC8|A124|IL|C17|C5)/.test(d) || engines >= 3) return 'wide'
  if (/^(CRJ|CL6|E1|E7|E9|MD8|MD9|B71|F28|F70|F100|RJ|BAE|AT|DH8|SF3|JS|AN)/.test(d)) return 'regional'
  if (/^(C25|C5[0-9]|C56|C68|C75|GL|GLF|FA|F2|F9|LJ|E50|E55|HDJT|PC24|SF50|LEGA|CL3|BE4|H25|ASTR|WW2)/.test(d)) return 'bizjet'
  return 'b737'
}

export const spoilerLayoutFor = (family: SpoilerFamily): SpoilerLayout => SPOILER_LAYOUTS[family]

export interface SpoilerPanels {
  readonly layout: SpoilerLayout
  /** Each panel's angle, degrees up from stowed, inboard first. */
  left: number[]
  right: number[]
  /** The ground spoilers are out (or going out), and for how long. */
  ground: boolean
  groundTimerS: number
  /** They have just been released and are still coming down: that stowing runs at the ground rate, not the speedbrake's. */
  stowing: boolean
}

export function makeSpoilerPanels(layout: SpoilerLayout): SpoilerPanels {
  const n = layout.panels.length
  return { layout, left: new Array<number>(n).fill(0), right: new Array<number>(n).fill(0), ground: false, groundTimerS: 0, stowing: false }
}

export function resetSpoilerPanels(s: SpoilerPanels): void {
  s.left.fill(0); s.right.fill(0); s.ground = false; s.groundTimerS = 0; s.stowing = false
}

export interface SpoilerInputs {
  /** Speedbrake lever, 0 (down) … 1 (full). */
  lever: number
  onGround: boolean
  groundSpeedKt: number
  /** Thrust lever 0…1 and whether reverse thrust is selected. */
  throttle: number
  reverse: boolean
  /** Flap position as a share of the last gate, 0…1. */
  flapsFrac: number
  /** Aileron / sidestick roll, −1 … 1 (+ = right). */
  roll: number
  kcas: number
}

const clamp = (v: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, v))
const smooth = (a: number, b: number, x: number): number => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t) }

/** Roll command below this share of full aileron raises no roll spoilers. */
export const ROLL_SPOILER_DEADBAND = 0.12
/** Ground spoilers retract when the thrust levers are advanced past this on the ground (a go-around or a takeoff). */
export const GROUND_SPOILER_THRUST_CUTOFF = 0.7
/** Reverse thrust on the roll (above this ground speed) raises the ground spoilers even if they were not armed. */
export const REVERSE_GROUND_SPOILER_KT = 40

/**
 * Advance the panels by `dt`. Returns the share of the airplane's aerodynamic spoiler effect they give, 0…1 (1 = full
 * ground spoilers on the ground, or full lever in the air): the drag and lift dump scale with it.
 */
export function stepSpoilers(s: SpoilerPanels, i: SpoilerInputs, dt: number): { aeroFrac: number; ground: boolean } {
  const L = s.layout
  const lever = clamp(Number.isFinite(i.lever) ? i.lever : 0, 0, 1)
  const wantGround = i.onGround && i.throttle < GROUND_SPOILER_THRUST_CUTOFF
    && (lever >= 0.5 || (i.reverse && i.groundSpeedKt > REVERSE_GROUND_SPOILER_KT))
  if (wantGround && !s.ground) s.groundTimerS = 0
  if (!wantGround && s.ground) s.stowing = true
  if (wantGround) s.stowing = false
  s.ground = wantGround
  if (s.ground) s.groundTimerS += dt

  // Speedbrakes: the lever's share of the angle, less what the airflow takes at speed; stowed when the flaps are at their last gate.
  const blowdown = 1 - L.blowdownShare * smooth(L.blowdownKcas[0], L.blowdownKcas[1], i.kcas)
  const stowed = L.flapsFullStowsBrakes && !i.onGround && i.flapsFrac > 0.95
  // (On the ground the lever is a ground-spoiler command and nothing else: the panels are out or they are not.)
  const brakeDeg = s.ground || stowed || i.onGround ? 0 : lever * L.flightMaxDeg * blowdown
  const roll = clamp(Number.isFinite(i.roll) ? i.roll : 0, -1, 1)
  const rollDeg = s.ground ? 0 : clamp((Math.abs(roll) - ROLL_SPOILER_DEADBAND) / (1 - ROLL_SPOILER_DEADBAND), 0, 1) * L.rollMaxDeg

  let aeroSum = 0, aeroN = 0
  for (let k = 0; k < L.panels.length; k++) {
    const p = L.panels[k]!
    // Outer panels are a touch slower (a longer, lighter surface on a longer link), so a cascade does not arrive in step.
    const speed = 1 - 0.035 * k
    for (const side of [0, 1] as const) {
      const arr = side === 0 ? s.left : s.right
      let target = 0
      if (s.ground && p.ground) target = L.groundMaxDeg
      else {
        if (p.brake) target += brakeDeg
        // The wing the airplane rolls toward (right roll → right wing) raises its roll panels.
        if (p.roll && (side === 1 ? roll > 0 : roll < 0)) target += rollDeg
        target = Math.min(target, L.flightMaxDeg + L.rollMaxDeg * 0.5)
      }
      // A ground cascade: panel k waits for the ones inboard of it.
      const waiting = s.ground && s.groundTimerS < k * L.staggerS
      const cur = arr[k]!
      const standing = s.ground || s.stowing
      const rate = (standing ? (target > cur ? L.groundRateDegS : L.groundRetractDegS) : L.flightRateDegS) * speed
      arr[k] = waiting ? cur : clamp(cur + clamp(target - cur, -rate * dt, rate * dt), 0, L.groundMaxDeg)
    }
    if (p.brake || p.ground) {
      const mode = s.ground ? L.groundMaxDeg : L.flightMaxDeg
      // Only what both wings have raised counts: a roll spoiler on one wing steers, it does not slow the airplane.
      aeroSum += Math.min(s.left[k]!, s.right[k]!) / mode; aeroN++
    }
  }
  // Released ground spoilers are down once every panel is back inside the range the speedbrake and roll commands hold it to.
  if (s.stowing && s.left.every((a) => a < 1) && s.right.every((a) => a < 1)) s.stowing = false
  else if (s.stowing && s.left.every((a, k) => a <= L.flightMaxDeg + 0.5 && s.right[k]! <= L.flightMaxDeg + 0.5) && brakeDeg + rollDeg > 0) s.stowing = false
  return { aeroFrac: aeroN ? clamp(aeroSum / aeroN, 0, 1) : 0, ground: s.ground }
}

/**
 * The type's panel that stands where a panel of an exterior model does, by position along the wing, 0 (root) … 1 (tip):
 * the model has its own number of panels, which need not be the airplane type's, and each moves with its nearest one
 * (so a cascade keeps its separate panels rather than blending into one).
 */
export function panelAngleAt(values: readonly number[], rank: number): number {
  if (!values.length) return 0
  return values[Math.round(clamp(rank, 0, 1) * (values.length - 1))]!
}
