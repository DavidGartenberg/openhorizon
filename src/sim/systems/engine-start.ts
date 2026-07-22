/**
 * Engine start state machine (Phase 3 §8): cold-and-dark → cranking →
 * running, following the real POH flow (battery on → fuel pump/mixture/
 * throttle are pilot actions taken as inputs here, not sequenced by this
 * module → starter engages → engine catches and RPM comes up → magneto
 * check → starter disengages once running). Pure state + step function,
 * no three.js/DOM (§4.1).
 *
 * This module also makes "engine not running" a real, reachable state:
 * `EngineStartState.rpm`/`status` are meant to drive `Aircraft.engineRunning`
 * each frame (a plain optional field on `Aircraft`, mirroring the
 * `groundElevAt` wiring pattern) so a stopped engine really does mean zero
 * thrust and RPM decay, and a successful start brings it back.
 *
 * Hot-start / flooded-start are modeled as distinct, honest failure/retry
 * paths rather than a full thermodynamic model:
 *  - Cold and dark: catches with mixture rich + throttle cracked (≤50%).
 *  - Hot engine: catches with the same normal technique, UNLESS the pilot
 *    also primes it (already-hot fuel doesn't need priming — priming a hot
 *    engine floods it).
 *  - Flooded: normal technique fails; requires the POH flooded-start
 *    technique — throttle open (≥50%) and mixture at idle cutoff (not
 *    rich) during cranking, no prime — before it will catch.
 *
 * NOTE ON SOURCING: cranking RPM, catch time, RPM decay rate, and the
 * per-magneto drop split (125/110 RPM) are not published in this repo's
 * POH excerpt. The magneto check *range* (100-150 RPM drop per mag, ≤50
 * RPM difference between mags) is the standard POH/AFM figure and is what
 * the test asserts; the specific 125/110 split is a representative value
 * inside that published range, flagged as an assumption.
 */
import { equilibriumRpm } from '../propulsion'
import { RHO0 } from '../atmosphere'

export type MagnetoPosition = 'off' | 'left' | 'right' | 'both'
export type EngineStatus = 'stopped' | 'cranking' | 'running'

// ---- flagged assumptions (see file header) ----
const CRANK_RPM = 180 // typical starter cranking speed
const MIN_CRANK_S = 1.5 // minimum crank time before the engine can catch
const MAX_CRANK_S = 10 // POH-typical starter duty-cycle limit before abandoning a crank attempt
const RPM_DECAY_PER_S = 400 // RPM/s decel when the engine is stopped (prop/friction drag)
const MAG_DROP_LEFT_RPM = 110 // RPM drop selecting L (losing the right magneto's contribution)
const MAG_DROP_RIGHT_RPM = 125 // RPM drop selecting R (losing the left magneto's contribution)

export interface EngineStartInputs {
  masterBattery: boolean
  starterEngaged: boolean
  magneto: MagnetoPosition
  mixtureRich: boolean
  throttleFrac: number // 0..1
  /** Fuel actually reaching the engine (from fuel.ts's `fuelFlowing`, or
   *  simply true if fuel systems aren't wired in yet). */
  fuelAvailable: boolean
  /** Scenario flags the caller sets to select a start-technique branch. */
  hotEngine: boolean
  floodedEngine: boolean
  /** Pilot primed/pumped the throttle before/during cranking. */
  primed: boolean
  /** false = no electrical system at all (J-3 Cub): the starter input is
   *  ignored (there is no starter motor) and `masterBattery` is not
   *  required — magnetos are self-powered. Absent/true = normal. */
  hasElectrical?: boolean
  /** Momentary: the pilot swings the prop through one compression stroke
   *  this step. With mags hot, fuel on, and the right technique the engine
   *  catches immediately; otherwise the blade just swings through. */
  handPropPull?: boolean
}

export interface EngineStartState {
  status: EngineStatus
  rpm: number
  crankTimeS: number
}

export function makeEngineStartState(): EngineStartState {
  return { status: 'stopped', rpm: 0, crankTimeS: 0 }
}

function magnetoDropRpm(magneto: MagnetoPosition): number {
  switch (magneto) {
    case 'left':
      return MAG_DROP_LEFT_RPM
    case 'right':
      return MAG_DROP_RIGHT_RPM
    default:
      return 0
  }
}

function canCatch(inp: EngineStartInputs): boolean {
  if (inp.floodedEngine) {
    // POH flooded-start technique: throttle open, mixture NOT rich, no prime.
    return inp.throttleFrac >= 0.5 && !inp.mixtureRich
  }
  if (inp.hotEngine) {
    // Hot engine catches with the normal technique; priming floods it.
    return inp.mixtureRich && !inp.primed
  }
  // Cold and dark: mixture rich, throttle cracked (not wide open).
  return inp.mixtureRich && inp.throttleFrac <= 0.5
}

export function stepEngineStart(st: EngineStartState, dt: number, inp: EngineStartInputs): void {
  const electrical = inp.hasElectrical !== false
  // Magnetos are engine-driven — a battery is only needed for the STARTER.
  // A running (or hand-propped) engine needs mags + fuel, nothing else.
  const canRun = (electrical ? inp.masterBattery : true) && inp.magneto !== 'off' && inp.fuelAvailable

  if (!canRun) {
    st.status = 'stopped'
    st.crankTimeS = 0
    st.rpm = Math.max(st.rpm - RPM_DECAY_PER_S * dt, 0)
    return
  }

  // Hand-prop: one compression stroke. Right technique → catches on the
  // spot; wrong technique → the blade swings through, nothing happens.
  if (st.status === 'stopped' && inp.handPropPull) {
    if (canCatch(inp)) {
      st.status = 'running'
      st.crankTimeS = 0
      st.rpm = Math.max(equilibriumRpm(inp.throttleFrac, 0, RHO0) - magnetoDropRpm(inp.magneto), 0)
    }
    return
  }

  if (st.status === 'stopped') {
    if (inp.starterEngaged && electrical) {
      st.status = 'cranking'
      st.crankTimeS = 0
      st.rpm = CRANK_RPM
    } else {
      st.rpm = Math.max(st.rpm - RPM_DECAY_PER_S * dt, 0)
    }
    return
  }

  if (st.status === 'cranking') {
    if (!inp.starterEngaged) {
      // Starter released before the engine caught: attempt aborted.
      st.status = 'stopped'
      st.rpm = 0
      st.crankTimeS = 0
      return
    }
    st.crankTimeS += dt
    st.rpm = CRANK_RPM
    if (st.crankTimeS >= MIN_CRANK_S && canCatch(inp)) {
      st.status = 'running'
      st.crankTimeS = 0
      st.rpm = Math.max(equilibriumRpm(inp.throttleFrac, 0, RHO0) - magnetoDropRpm(inp.magneto), 0)
    } else if (st.crankTimeS >= MAX_CRANK_S) {
      // Didn't catch within the duty-cycle limit — back to stopped so the
      // pilot must release the starter and retry (possibly with a
      // different technique, e.g. the flooded-start procedure).
      st.status = 'stopped'
      st.rpm = 0
      st.crankTimeS = 0
    }
    return
  }

  // running
  const baseline = equilibriumRpm(inp.throttleFrac, 0, RHO0)
  st.rpm = Math.max(baseline - magnetoDropRpm(inp.magneto), 0)
  st.crankTimeS = 0
}
