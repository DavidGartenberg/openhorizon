/**
 * Oil temperature / oil pressure / CHT thermal model (Phase 3 §8.3 MFD/EIS
 * task): none of oil temp, oil pressure, or cylinder-head temp exist
 * anywhere else in the sim (only EGT does, via `mixture.ts`). Rather than
 * rendering fake needle positions on the MFD EIS strip, this is a small,
 * honest first-order thermal-lag model — same spirit as `mixture.ts`'s
 * EGT curve: real (if approximate) physics, not an invented reading.
 *
 * Model: oil temp and CHT are thermal masses that exponentially approach an
 * RPM-dependent equilibrium over a time constant (oil: slow, large sump;
 * CHT: faster, less mass, more cooling airflow). Oil pressure is treated as
 * responding much faster (it's pump-driven, not thermal) but still through
 * a short lag rather than snapping instantly, so a rapid RPM change doesn't
 * read as a step function on the gauge. Pure state + step function, no
 * three.js/DOM (§4.1), mirrors the shape of `electrical.ts`/`fuel.ts`.
 *
 * NOTE ON SOURCING: no POH oil-temp/oil-pressure/CHT tables exist in this
 * repo. The equilibrium values and time constants below are representative
 * Lycoming IO-360-class figures (oil temp normal arc up to ~245°F/118°C,
 * CHT normal arc up to ~500°F/260°C redline, oil pressure normal arc
 * ~30-90 psi) chosen for plausible gauge behavior — flagged as assumptions,
 * not POH-verified numbers, same caveat status as `mixture.ts`'s EGT
 * constants and `electrical.ts`'s battery specs.
 */

export interface EngineTemps {
  oilTempC: number
  oilPressPsi: number
  chtC: number
}

/** Cold engine at ambient temperature, oil pressure at zero (not running). */
export function makeEngineTemps(ambientC = 15): EngineTemps {
  return { oilTempC: ambientC, oilPressPsi: 0, chtC: ambientC }
}

// ---- flagged assumptions (see file header) ----
const OIL_TEMP_TAU_S = 180 // large sump thermal mass, slow to respond (~3 min to ~63% of the way)
const CHT_TAU_S = 45 // cylinder heads: less mass, more cooling airflow, faster response
const OIL_PRESS_TAU_S = 2 // pump-driven; fast but not instant (avoids a gauge step-function)

export const OIL_TEMP_MAX_C = 118 // ≈245°F redline
const OIL_TEMP_CRUISE_C = 90 // representative steady cruise oil temp
export const CHT_MAX_C = 260 // ≈500°F redline
const CHT_CRUISE_C = 190 // representative steady cruise CHT
export const OIL_PRESS_MIN_GREEN_PSI = 25 // representative idle/green-arc-bottom oil pressure
export const OIL_PRESS_CRUISE_PSI = 70 // representative cruise oil pressure, mid-green-arc
export const OIL_PRESS_MAX_PSI = 100 // representative gauge redline, above the green/yellow arcs

/** First-order exponential approach of `current` toward `target` over `dt` with time constant `tau`. */
export function approachExp(current: number, target: number, dt: number, tau: number): number {
  const alpha = 1 - Math.exp(-Math.max(dt, 0) / Math.max(tau, 1e-6))
  return current + (target - current) * alpha
}

/**
 * Equilibrium temperature (°C) for a given rpm fraction (rpm/redlineRpm,
 * clamped [0,1]) and running state, blended from ambient (not running)
 * through a low idle baseline up to the cruise figure (reached by rpmFrac
 * ≈0.75, a representative cruise-power rpm fraction), capped at `maxC` so
 * the model can never imply an over-redline equilibrium.
 */
function equilibriumTempC(ambientC: number, cruiseC: number, maxC: number, rpmFrac: number, running: boolean): number {
  if (!running) return ambientC
  const idleC = ambientC + (cruiseC - ambientC) * 0.3
  const t = idleC + (cruiseC - idleC) * Math.min(rpmFrac / 0.75, 1)
  return Math.min(t, maxC)
}

/** Equilibrium oil pressure (psi) for a given rpm fraction — 0 when not running, rising quickly off idle. */
function equilibriumOilPressPsi(rpmFrac: number, running: boolean): number {
  if (!running) return 0
  return OIL_PRESS_MIN_GREEN_PSI + (OIL_PRESS_CRUISE_PSI - OIL_PRESS_MIN_GREEN_PSI) * Math.min(rpmFrac / 0.5, 1)
}

/**
 * Advance the thermal-lag state by `dt` seconds given current `rpm`,
 * the aircraft's `redlineRpm` (from `C172S.redlineRpm` — never re-guessed
 * here), whether the engine is running, and ambient (OAT) temperature.
 */
export function stepEngineTemps(st: EngineTemps, dt: number, rpm: number, redlineRpm: number, running: boolean, ambientC: number): void {
  const rpmFrac = Math.max(0, Math.min(rpm / redlineRpm, 1))
  const oilTarget = equilibriumTempC(ambientC, OIL_TEMP_CRUISE_C, OIL_TEMP_MAX_C, rpmFrac, running)
  const chtTarget = equilibriumTempC(ambientC, CHT_CRUISE_C, CHT_MAX_C, rpmFrac, running)
  const pressTarget = equilibriumOilPressPsi(rpmFrac, running)

  st.oilTempC = approachExp(st.oilTempC, oilTarget, dt, OIL_TEMP_TAU_S)
  st.chtC = approachExp(st.chtC, chtTarget, dt, CHT_TAU_S)
  st.oilPressPsi = approachExp(st.oilPressPsi, pressTarget, dt, OIL_PRESS_TAU_S)
}
