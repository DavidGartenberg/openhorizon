/**
 * Convection and orographic lift (soaring physics).
 *
 * Thermals: a deterministic field of columns, one candidate per grid cell.
 * Existence, position, strength and lifecycle come from a lattice hash, so
 * the same airspace has the same thermals on every run and for every
 * viewer. Vigour follows the solar heating (sun elevation), is cut by
 * overcast and by strong wind (shear tears thermals apart), and is zero over
 * water and at night. Each column:
 *   - rises through a convective boundary layer whose depth grows with
 *     heating (≈ 0.4–2 km);
 *   - has the classic mixed-layer vertical profile (z/zi)^⅓·(1 − 1.1·z/zi),
 *     peaking about a quarter of the way up and dying at the inversion;
 *   - has a Gaussian core that widens with height, a weak sink ring around
 *     it, and leans downwind as air parcels drift while they rise;
 *   - is born, peaks and decays over a 15–25 minute cycle.
 * A small environmental sink between columns returns the mass the cores lift.
 *
 * Ridge lift: wind forced up a slope rises at U·∇h at the surface (sink on
 * the lee side), decaying with height above the terrain.
 */
import { clamp01, hash2 } from './rng'

export interface ConvectionConditions {
  /** Sun elevation above the horizon, degrees. */
  sunElevDeg: number
  /** Total cloud cover, 0 (clear) – 1 (overcast). */
  cloudCover: number
  /** Steady surface wind, m/s. */
  surfaceWindMs: number
  /** The ground below is open water (no convection). */
  overWater: boolean
}

/** Convective vigour 0..1. */
export function convectiveStrength(c: ConvectionConditions): number {
  if (c.overWater) return 0
  const heat = clamp01((Math.sin((c.sunElevDeg * Math.PI) / 180) - 0.17) / 0.7)
  const cloud = 1 - 0.85 * clamp01(c.cloudCover)
  const shear = 1 - 0.7 * clamp01((c.surfaceWindMs - 8) / 12)
  return heat * cloud * shear
}

/** Convective boundary-layer depth (m above ground). */
export function boundaryLayerDepthM(strength: number): number {
  return 400 + 1600 * clamp01(strength)
}

/** Convective velocity scale w* (m/s) — strong days reach ~4 m/s. */
export function convectiveVelocity(strength: number): number {
  return 4 * clamp01(strength)
}

/** Mixed-layer vertical profile, normalised to peak 1. */
export function thermalProfile(zOverZi: number): number {
  if (zOverZi <= 0 || zOverZi >= 1 / 1.1) return 0
  const raw = Math.cbrt(zOverZi) * (1 - 1.1 * zOverZi)
  return raw / 0.4578 // max of cbrt(x)(1−1.1x) is at x = 1/4.4 → 0.4578
}

export interface Thermal {
  n: number
  e: number
  /** Relative strength 0.6–1.4 and life factor 0–1 at the queried time. */
  strength: number
  life: number
}

export class ThermalField {
  constructor(readonly seed = 7, readonly cellM = 1800) {}

  /** The thermal belonging to grid cell (i, j) at time t, or null. */
  thermalInCell(i: number, j: number, timeS: number): Thermal | null {
    if (hash2(i, j, this.seed) > 0.62) return null
    const n = (i + 0.15 + 0.7 * hash2(i, j, this.seed + 1)) * this.cellM
    const e = (j + 0.15 + 0.7 * hash2(i, j, this.seed + 2)) * this.cellM
    const strength = 0.6 + 0.8 * hash2(i, j, this.seed + 3)
    const period = 900 + 600 * hash2(i, j, this.seed + 4)
    const phase = hash2(i, j, this.seed + 5)
    const life = Math.sin(Math.PI * ((timeS / period + phase) % 1)) ** 2
    return { n, e, strength, life }
  }

  /**
   * Vertical air velocity (m/s, + = up) at frame-local north/east (m), height
   * above ground (m) and time (s), for a convective strength 0..1 and the
   * steady wind (m/s, north/east) the columns drift with.
   */
  updraftAt(n: number, e: number, aglM: number, timeS: number, strength: number, windN = 0, windE = 0): number {
    if (strength <= 0 || aglM < 0) return 0
    const zi = boundaryLayerDepthM(strength)
    const zr = aglM / zi
    const prof = thermalProfile(zr)
    if (prof <= 0) return 0
    const wStar = convectiveVelocity(strength)
    // Core radius grows with height (≈ 60 m low, 150–250 m mid-layer).
    const R = 60 + 140 * Math.cbrt(zr) * (zi / 1000)
    // Parcels drift with the wind while they rise at roughly the core speed.
    const riseTime = aglM / Math.max(1.5 * wStar, 0.5)
    const ci = Math.floor(n / this.cellM), cj = Math.floor(e / this.cellM)
    let w = 0
    for (let di = -1; di <= 1; di++) for (let dj = -1; dj <= 1; dj++) {
      const t = this.thermalInCell(ci + di, cj + dj, timeS)
      if (!t || t.life <= 0.01) continue
      const dn = n - (t.n + windN * riseTime), de = e - (t.e + windE * riseTime)
      const s = Math.hypot(dn, de) / R
      if (s > 4) continue
      const core = Math.exp(-s * s) - 0.15 * Math.exp(-((s - 2.2) ** 2))
      w += 1.6 * wStar * t.strength * t.life * prof * core
    }
    // Environmental sink between the columns.
    return w - 0.12 * wStar * prof
  }
}

/**
 * Orographic (ridge) lift, m/s (+ up): wind (north/east, m/s) over terrain
 * with gradient (dh/dn, dh/de), decaying with height above ground.
 */
export function ridgeLift(windN: number, windE: number, dhdn: number, dhde: number, aglM: number): number {
  const surface = windN * dhdn + windE * dhde
  const bounded = Math.max(-8, Math.min(8, surface))
  return bounded * Math.exp(-Math.max(aglM, 0) / 350)
}

/** Brunt–Väisälä frequency of a standard-atmosphere airstream, 1/s. */
export const LEE_WAVE_N = 0.011

/**
 * Mountain lee waves (linear trapped-wave model), m/s (+ up). A stable
 * airstream crossing a ridge sets up standing waves downwind of it:
 *  - wavelength λ = 2πU/N (≈ 9–16 km in 15–25 m/s winds);
 *  - vertical speed amplitude ≈ N·A, with A half the ridge's prominence
 *    (2–5 m/s behind 500–1,000 m ridges, capped at 8);
 *  - sink on the lee slope, the first wave's lift ≈ ¾λ downwind, crests
 *    repeating every λ and decaying downstream over a few wavelengths;
 *  - no flow through the ground: the wave builds in over twice the ridge
 *    height above the terrain and fades above 6 km.
 * Needs ≈ 15 kt at ridge height; convection (thermals) wrecks the stable
 * layer, so `stability` (0..1) scales it.
 * @param xDownwindM distance downwind of the ridge crest (m)
 * @param zAglM height above the local terrain (m)
 */
export function leeWaveUpdraft(xDownwindM: number, zAglM: number, prominenceM: number, windMs: number, stability: number): number {
  if (xDownwindM <= 0 || prominenceM < 60 || windMs < 7 || stability <= 0) return 0
  const k = LEE_WAVE_N / windMs
  const lambda = (2 * Math.PI) / k
  const onset = clamp01((windMs - 7) / 5)
  const amp = Math.min(8, LEE_WAVE_N * 0.5 * Math.min(prominenceM, 1600)) * onset * clamp01(stability)
  const t = clamp01(zAglM / (2 * prominenceM))
  const vertical = t * t * (3 - 2 * t) * Math.exp(-Math.max(0, zAglM - 6000) / 2000)
  return -amp * Math.sin(k * xDownwindM) * Math.exp(-xDownwindM / (3 * lambda)) * vertical
}

/** The dominant ridge upwind of a point: crest distance (m) and prominence
 *  over the point's terrain (m), scanning `rangeM` along the wind every
 *  `stepM`. Null when nothing upwind stands `minProminenceM` proud. */
export function upwindRidge(
  elevAt: (n: number, e: number) => number, n: number, e: number, windN: number, windE: number,
  rangeM = 25_000, stepM = 500, minProminenceM = 60,
): { distanceM: number; prominenceM: number } | null {
  const u = Math.hypot(windN, windE)
  if (u < 0.5) return null
  // Wind blows TOWARD (windN, windE): upwind is the opposite way.
  const un = -windN / u, ue = -windE / u
  const here = elevAt(n, e)
  if (!Number.isFinite(here)) return null
  let best = -Infinity, at = 0
  for (let d = stepM; d <= rangeM; d += stepM) {
    const h = elevAt(n + un * d, e + ue * d)
    if (Number.isFinite(h) && h > best) { best = h; at = d }
  }
  const prominence = best - here
  return prominence >= minProminenceM ? { distanceM: at, prominenceM: prominence } : null
}

