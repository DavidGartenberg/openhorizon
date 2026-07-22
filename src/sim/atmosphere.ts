/**
 * ISA atmosphere (§5.2) and airspeed definitions, including the C172S
 * pitot-static position-error calibration (POH Section 5): at high AoA the
 * static source underreads, so indicated airspeed at the clean stall is
 * ~5 kt below calibrated (48 KIAS ↔ 53 KCAS). METAR-driven deviations from
 * ISA arrive in Phase 5.
 */

export const RHO0 = 1.225 // kg/m³ sea-level ISA
export const P0 = 101_325 // Pa
export const T0 = 288.15 // K
export const LAPSE = 0.0065 // K/m
export const R_AIR = 287.05
export const G = 9.80665
export const KT = 0.514444 // m/s per knot
export const FT = 0.3048 // m per foot

export interface AirState {
  temperatureK: number
  pressurePa: number
  densityKgM3: number
  speedOfSoundMs: number
}

export function isa(altitudeM: number, out?: AirState): AirState {
  const h = Math.min(Math.max(altitudeM, -500), 11_000)
  const T = T0 - LAPSE * h
  const p = P0 * Math.pow(T / T0, G / (R_AIR * LAPSE))
  const rho = p / (R_AIR * T)
  const a = Math.sqrt(1.4 * R_AIR * T)
  if (out) {
    out.temperatureK = T
    out.pressurePa = p
    out.densityKgM3 = rho
    out.speedOfSoundMs = a
    return out
  }
  return { temperatureK: T, pressurePa: p, densityKgM3: rho, speedOfSoundMs: a }
}

/**
 * Altimeter indication (Kollsman correction, §11): with the baro window set
 * to the actual QNH the altimeter reads true altitude; each 0.01 inHg of
 * mis-set shifts the reading ~9.25 ft (≈925 ft/inHg in the lower
 * troposphere). Sign: setting the window HIGHER than actual QNH reads HIGH.
 */
export function indicatedAltitudeFt(trueAltFt: number, baroSetInHg: number, qnhInHg: number): number {
  return trueAltFt + (baroSetInHg - qnhInHg) * 925
}

/** Density ratio σ at altitude. */
export function sigma(altitudeM: number): number {
  return isa(altitudeM).densityKgM3 / RHO0
}

/** CAS (m/s) from true airspeed and density — incompressible (fine < 200 kt). */
export function casFromTas(tasMs: number, densityKgM3: number): number {
  return tasMs * Math.sqrt(densityKgM3 / RHO0)
}

/**
 * C172S position-error calibration: KCAS → KIAS, piecewise linear from the
 * POH airspeed calibration table. Two curves: flaps up and flaps 30 (10/20
 * interpolate between them).
 */
const CAL_CLEAN: Array<[kcas: number, kias: number]> = [
  [45, 38],
  [53, 48],
  [56, 51],
  [62, 60],
  [71, 70],
  [80, 80],
  [89, 90],
  [98, 100],
  [108, 110],
  [117, 120],
  [127, 130],
  [140, 143],
]
const CAL_FLAP30: Array<[kcas: number, kias: number]> = [
  [40, 32],
  [47, 40],
  [51, 45],
  [56, 52],
  [62, 60],
  [71, 70],
  [80, 80],
  [90, 90],
]

function interp(table: ReadonlyArray<readonly [number, number]>, x: number): number {
  const first = table[0]!
  const last = table[table.length - 1]!
  if (x <= first[0]) return first[1] + (x - first[0])
  if (x >= last[0]) return last[1] + (x - last[0])
  for (let i = 1; i < table.length; i++) {
    const [x1, y1] = table[i]!
    const [x0, y0] = table[i - 1]!
    if (x <= x1) return y0 + ((x - x0) / (x1 - x0)) * (y1 - y0)
  }
  return last[1]
}

/** Position-error calibration tables (KCAS→KIAS). These are the C172S POH
 *  tables and remain this module's default so every existing caller is
 *  bit-unchanged; fleet aircraft supply their own via `AircraftParams.
 *  pitotCal` (Phase 11b) — or none, which honestly means IAS = CAS. */
export interface PitotCal {
  clean: ReadonlyArray<readonly [number, number]>
  flap: ReadonlyArray<readonly [number, number]>
  /** Flap angle at which the `flap` table fully applies (blend endpoint). */
  flapFullDeg: number
}

export const C172_PITOT_CAL: PitotCal = { clean: CAL_CLEAN, flap: CAL_FLAP30, flapFullDeg: 30 }

export function kiasFromKcas(kcas: number, flapsDeg: number, cal: PitotCal = C172_PITOT_CAL): number {
  const clean = interp(cal.clean, kcas)
  const flap = interp(cal.flap, kcas)
  const f = Math.min(Math.max(flapsDeg / cal.flapFullDeg, 0), 1)
  return clean * (1 - f) + flap * f
}

/** Inverse: KIAS → KCAS (numeric, for tests/targets given in KIAS). */
export function kcasFromKias(kias: number, flapsDeg: number, cal: PitotCal = C172_PITOT_CAL): number {
  let lo = kias - 5
  let hi = kias + 15
  for (let i = 0; i < 40; i++) {
    const mid = (lo + hi) / 2
    if (kiasFromKcas(mid, flapsDeg, cal) < kias) lo = mid
    else hi = mid
  }
  return (lo + hi) / 2
}
