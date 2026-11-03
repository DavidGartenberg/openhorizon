/**
 * Wind model (§5.3): steady layered wind + gusts + turbulence.
 *
 * Turbulence: once the caller provides the flight state (`setFlightState`),
 * the model follows the MIL-F-8785C Dryden form. Scale lengths and
 * intensities depend on height: below 1,000 ft the low-altitude model
 * (L_w = h, σ_w = 0.1·W20, driven by the surface wind); above 2,000 ft the
 * medium/high-altitude model (L = 1,750 ft, σ from the light / moderate /
 * severe intensity); linear blend between. Each axis is an Ornstein–Uhlenbeck
 * process with time constant L/V, sampled with the exact discretisation so
 * any timestep is stable. A spanwise-antisymmetric vertical gust (correlation
 * exp(−b/L_w) across the span, Dryden roll-gust time constant 4b/πV) gives
 * the rotational roll gust `rollGustRate` that the aero model sees as relative
 * roll rate. Without a flight state the original fixed-constant filters run
 * unchanged.
 */
import type { V3 } from '../math/vec'
import { v3, v3set } from '../math/vec'
import { gaussian } from './environment/rng'

const FT = 0.3048
const KT = 0.514444

export interface DrydenScales {
  /** Scale lengths, m. */
  Lu: number
  Lv: number
  Lw: number
  /** RMS intensities, m/s. */
  su: number
  sv: number
  sw: number
}

/** Medium/high-altitude σ (m/s) for intensity 0..3 (none/light/moderate/severe). */
const SIGMA_HIGH = [0, 1.5, 3.0, 6.0]
/** W20 (wind at 20 ft) implied by intensity alone: light 15 kt, moderate 30, severe 45. */
const W20_BY_INTENSITY = [0, 15 * KT, 30 * KT, 45 * KT]

function lerpTable(t: number[], x: number): number {
  const i = Math.max(0, Math.min(t.length - 1.000001, x))
  const k = Math.floor(i)
  return t[k]! + (t[k + 1]! - t[k]!) * (i - k)
}

/** MIL-F-8785C Dryden scale lengths and intensities at a height above ground. */
export function drydenScales(aglM: number, w20Ms: number, intensity: number): DrydenScales {
  const hFt = Math.max(aglM / FT, 10)
  const low = (h: number): DrydenScales => {
    const k = 0.177 + 0.000823 * h
    const Lw = h * FT
    const Luv = (h / k ** 1.2) * FT
    const sw = 0.1 * w20Ms
    const suv = sw / k ** 0.4
    return { Lu: Luv, Lv: Luv, Lw, su: suv, sv: suv, sw }
  }
  const sHigh = lerpTable(SIGMA_HIGH, intensity)
  const high: DrydenScales = { Lu: 1750 * FT, Lv: 1750 * FT, Lw: 1750 * FT, su: sHigh, sv: sHigh, sw: sHigh }
  if (hFt <= 1000) return low(hFt)
  if (hFt >= 2000) return high
  const a = low(1000), f = (hFt - 1000) / 1000
  const mix = (x: number, y: number): number => x + (y - x) * f
  return { Lu: mix(a.Lu, high.Lu), Lv: mix(a.Lv, high.Lv), Lw: mix(a.Lw, high.Lw), su: mix(a.su, high.su), sv: mix(a.sv, high.sv), sw: mix(a.sw, high.sw) }
}

/** Atmospheric boundary layer (neutral stability). The METAR wind is the
 *  10 m wind; below it the log law, ln(z/z0)/ln(10/z0), thins it toward the
 *  ground. Above the 100 m surface layer it rises smoothly to the gradient
 *  wind at the boundary-layer top (the log law extrapolated there, ×0.9:
 *  ≈1.6× the surface wind over grassland, ≈1.25× over the sea). Ekman turning
 *  veers it with height, clockwise in the northern hemisphere: ≈30° over
 *  land, ≈12° over water. Returns the speed factor and the veer (rad, + =
 *  clockwise seen from above) at height z (m above ground). */
export function boundaryLayerProfile(zM: number, z0M: number, latDeg: number): { factor: number; veerRad: number } {
  const z0 = Math.max(z0M, 1e-5)
  const water = z0 < 0.002
  const top = water ? 600 : 1000
  const surfaceTop = 100
  const z = Math.max(zM, Math.max(1, z0 * 20))
  const logAt = (h: number): number => Math.log(h / z0) / Math.log(10 / z0)
  const gradient = logAt(top) * 0.9
  let factor: number
  if (z <= surfaceTop) factor = logAt(z)
  else {
    const t = Math.min((z - surfaceTop) / (top - surfaceTop), 1)
    factor = logAt(surfaceTop) + (gradient - logAt(surfaceTop)) * t * t * (3 - 2 * t)
  }
  const alpha0 = ((water ? 12 : 30) * Math.PI) / 180
  const v = Math.min(Math.max((zM - 10) / (top - 10), 0), 1)
  const veerRad = alpha0 * Math.pow(v, 0.6) * (latDeg < 0 ? -1 : 1)
  return { factor, veerRad }
}

export class WindModel {
  /** Steady wind: direction FROM (deg true), speed (kt) → NED vector. */
  private steady = v3()
  private turb = v3()
  /** 0 = calm air, 1 = light chop, 2 = moderate, 3 = severe. */
  intensity = 0
  gustKt = 0
  private gustPhase = Math.random() * 1000
  private flight: { aglM: number; rawAglM: number; tasMs: number; spanM: number; onGround: boolean } | null = null
  /** Antisymmetric spanwise vertical gust (m/s at the right tip, upward +). */
  private delta = 0
  private rollGust = 0
  /** Uniform [0,1) source; tests inject a seeded generator. */
  rng: () => number = Math.random
  /** Boundary-layer profile (setSurface): roughness length (m) and latitude.
   *  Null = the steady wind blows at every height (legacy, bit-exact). */
  private surface: { z0M: number; latDeg: number } | null = null

  /** Enable the boundary-layer wind profile: roughness length z0 (m:
   *  0.0002 open sea, 0.03 grassland and airports, 0.5+ forest and towns)
   *  and latitude (the sense of the Ekman veer). */
  setSurface(z0M: number, latDeg: number): void {
    if (this.surface) { this.surface.z0M = z0M; this.surface.latDeg = latDeg }
    else this.surface = { z0M, latDeg }
  }

  /** The steady wind at a height above ground (NED m/s, horizontal). */
  steadyAt(aglM: number, out: { x: number; y: number }): { x: number; y: number } {
    if (!this.surface) { out.x = this.steady.x; out.y = this.steady.y; return out }
    const { factor, veerRad } = boundaryLayerProfile(aglM, this.surface.z0M, this.surface.latDeg)
    // Veering = the direction the wind comes FROM turns clockwise, and so does
    // the vector it blows along: rotate (north, east) by +veer.
    const c = Math.cos(veerRad), sn = Math.sin(veerRad)
    out.x = factor * (this.steady.x * c - this.steady.y * sn)
    out.y = factor * (this.steady.x * sn + this.steady.y * c)
    return out
  }
  private readonly prof = { x: 0, y: 0 }

  setSteady(directionFromDeg: number, speedKt: number, gustKt = 0): void {
    const toRad = ((directionFromDeg + 180) % 360) * (Math.PI / 180)
    const ms = speedKt * 0.514444
    v3set(this.steady, Math.cos(toRad) * ms, Math.sin(toRad) * ms, 0)
    this.gustKt = Math.max(gustKt - speedKt, 0)
  }

  /** Height above ground (m), true airspeed (m/s) and wingspan (m) for the
   *  Dryden scales; enables the MIL-F-8785C turbulence path. */
  setFlightState(aglM: number, tasMs: number, spanM: number, onGround = false): void {
    this.flight = { aglM: Math.max(aglM, 3), rawAglM: Math.max(aglM, 0), tasMs: Math.max(tasMs, 5), spanM: Math.max(spanM, 1), onGround }
  }

  /** Steady surface wind speed, m/s (13e: feeds the ocean sea state). */
  get steadyMs(): number {
    return Math.hypot(this.steady.x, this.steady.y)
  }

  /** Bearing the steady wind blows TOWARD, rad (0 = north, +cw). */
  get steadyTowardRad(): number {
    return Math.atan2(this.steady.y, this.steady.x)
  }

  /** Steady wind components (NED m/s, horizontal). */
  get steadyNorthMs(): number { return this.steady.x }
  get steadyEastMs(): number { return this.steady.y }

  /** Rotational roll gust (rad/s): the air's roll rate across the span.
   *  The aero model sees p − rollGustRate. */
  get rollGustRate(): number {
    return this.rollGust
  }

  /** Advance turbulence states; returns total wind (NED, m/s). */
  step(dt: number, out: V3): V3 {
    if (this.flight) this.stepDryden(dt)
    else this.stepLegacy(dt)

    // Slow gust swell on top of steady wind.
    this.gustPhase += dt
    const gustFactor =
      1 +
      (this.gustKt * 0.514444 *
        Math.max(Math.sin(this.gustPhase * 0.35) + Math.sin(this.gustPhase * 0.13) - 1.2, 0)) /
        Math.max(Math.hypot(this.steady.x, this.steady.y), 0.1)

    const st = this.surface && this.flight ? this.steadyAt(this.flight.rawAglM, this.prof) : this.steady
    return v3set(
      out,
      st.x * gustFactor + this.turb.x,
      st.y * gustFactor + this.turb.y,
      this.turb.z,
    )
  }

  /** Original Dryden-flavoured filters (fixed time constants). */
  private stepLegacy(dt: number): void {
    const tau = { x: 3.5, y: 2.5, z: 1.8 }
    const sigma = this.intensity * 0.9 // m/s per axis at intensity 1
    for (const axis of ['x', 'y', 'z'] as const) {
      const t = tau[axis]
      const noise = (Math.random() * 2 - 1) * Math.sqrt(3)
      this.turb[axis] +=
        (dt / t) * (-this.turb[axis]) + sigma * Math.sqrt((2 * dt) / t) * noise
    }
  }

  private stepDryden(dt: number): void {
    if (dt <= 0) return
    const f = this.flight!
    const w20 = Math.max(this.steadyMs, lerpTable(W20_BY_INTENSITY, this.intensity))
    const s = drydenScales(f.aglM, w20, this.intensity)
    const V = f.tasMs
    // Exact OU update: x ← a·x + σ·√(1−a²)·n with a = exp(−dt/τ), τ = L/V.
    const ou = (x: number, L: number, sigma: number): number => {
      if (sigma <= 0) return x * Math.exp((-dt * V) / Math.max(L, 1))
      const a = Math.exp((-dt * V) / Math.max(L, 1))
      return a * x + sigma * Math.sqrt(1 - a * a) * gaussian(this.rng)
    }
    // Horizontal axes are taken along north/east (isotropic σu = σv here).
    this.turb.x = ou(this.turb.x, s.Lu, s.su)
    this.turb.y = ou(this.turb.y, s.Lv, s.sv)
    // Vertical air motion vanishes at the surface (no flow through the
    // ground): zero on the ground, tapering in over the first 8 m.
    const vTaper = f.onGround ? 0 : Math.min(1, f.rawAglM / 8)
    // NED z is down: an updraft is negative.
    this.turb.z = ou(this.turb.z, s.Lw, s.sw * vTaper)
    // Spanwise antisymmetric part of w: variance σw²(1 − ρ(b))/2 with
    // ρ(b) = exp(−b/Lw); Dryden roll-gust time constant τp = 4b/(πV).
    const b = f.spanM
    const sDelta = s.sw * vTaper * Math.sqrt(Math.max(0, (1 - Math.exp(-b / Math.max(s.Lw, 1))) / 2))
    const aP = Math.exp((-dt * Math.PI * V) / (4 * b))
    this.delta = sDelta > 0 ? aP * this.delta + sDelta * Math.sqrt(1 - aP * aP) * gaussian(this.rng) : this.delta * aP
    // Upward at the right tip, downward at the left → the air rolls left.
    this.rollGust = this.delta === 0 ? 0 : (-2 * this.delta) / b
  }
}
