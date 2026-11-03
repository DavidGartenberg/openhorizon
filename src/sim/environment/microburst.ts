/**
 * Microburst (downburst) wind field and a reactive windshear detector.
 *
 * Field: an axisymmetric, mass-conserving flow built from a Stokes stream
 * function ψ(r, z) = −W·R²·s²·e^(−s²)·g(z), s = r/R, with the height shape
 * g(z) = (1 − e^(−z/zm))·e^(−z/zh). Differentiating gives
 *   vertical  w   = −2W·(1 − s²)·e^(−s²)·g(z)        (downdraft in the core)
 *   radial    u_r =  W·R·s·e^(−s²)·g′(z)             (outflow near the ground)
 * so the continuity equation holds exactly, the flow is zero at the surface
 * (no penetration) and spreads outward beneath an inflow aloft. Flying
 * through it gives the textbook sequence: headwind (airspeed gain), then a
 * downdraft, then a strong tailwind (airspeed loss).
 *
 * Detector: the F-factor, F = (dWx/dt)/g − Wh/V, with Wx the along-track
 * wind (tailwind +) and Wh the vertical wind (updraft +). A sustained F
 * above ≈ 0.105 means performance-decreasing shear. Reactive windshear
 * systems alert on it; the threshold and averaging here follow that idea.
 */

export interface MicroburstSpec {
  /** Centre, frame-local north/east (m). */
  n: number
  e: number
  /** Core radius (m) and peak downdraft (m/s). */
  radiusM?: number
  peakDowndraftMs?: number
  /** Start time (s, sim clock) and total life (s). */
  startS: number
  lifeS?: number
}

export class Microburst {
  readonly n: number
  readonly e: number
  readonly R: number
  readonly W: number
  readonly startS: number
  readonly lifeS: number
  private readonly zm = 150
  private readonly zh = 1500

  constructor(spec: MicroburstSpec) {
    this.n = spec.n
    this.e = spec.e
    this.R = spec.radiusM ?? 1000
    this.W = (spec.peakDowndraftMs ?? 12) / 2
    this.startS = spec.startS
    this.lifeS = spec.lifeS ?? 900
  }

  /** Intensity envelope: ~2 min build, peak, then decay over the rest. */
  envelope(timeS: number): number {
    const t = timeS - this.startS
    if (t <= 0 || t >= this.lifeS) return 0
    const rise = Math.min(1, t / 120)
    const fall = Math.min(1, (this.lifeS - t) / (this.lifeS * 0.45))
    return rise * rise * (3 - 2 * rise) * Math.max(0, fall)
  }

  /** The same microburst re-centred after a floating-origin rebase. */
  shifted(dn: number, de: number): Microburst {
    return new Microburst({ n: this.n + dn, e: this.e + de, radiusM: this.R, peakDowndraftMs: this.W * 2, startS: this.startS, lifeS: this.lifeS })
  }

  isOver(timeS: number): boolean {
    return timeS - this.startS >= this.lifeS
  }

  private g(z: number): number {
    return (1 - Math.exp(-z / this.zm)) * Math.exp(-z / this.zh)
  }

  private gPrime(z: number): number {
    const a = Math.exp(-z / this.zm), b = Math.exp(-z / this.zh)
    return (a / this.zm) * b - ((1 - a) * b) / this.zh
  }

  /** Wind (NED, m/s; down +) at north/east (m), height above ground (m). */
  windAt(n: number, e: number, aglM: number, timeS: number, out: { x: number; y: number; z: number }): { x: number; y: number; z: number } {
    const k = this.envelope(timeS)
    const z = Math.max(aglM, 0)
    if (k <= 0) { out.x = 0; out.y = 0; out.z = 0; return out }
    const dn = n - this.n, de = e - this.e
    const r = Math.hypot(dn, de)
    const s = r / this.R
    if (s > 5) { out.x = 0; out.y = 0; out.z = 0; return out }
    const es = Math.exp(-s * s)
    const wUp = -2 * this.W * (1 - s * s) * es * this.g(z) * k
    const ur = this.W * this.R * s * es * this.gPrime(z) * k
    const cos = r > 1e-6 ? dn / r : 0, sin = r > 1e-6 ? de / r : 0
    out.x = ur * cos
    out.y = ur * sin
    out.z = -wUp
    return out
  }
}

/** Reactive windshear detection from the F-factor (jets/transports). */
export class WindshearDetector {
  private lastAlong: number | null = null
  private fAvg = 0
  private alerting = false
  /** Averaging time (s) and alert / clear thresholds on mean F. */
  constructor(readonly tauS = 5, readonly alertF = 0.105, readonly clearF = 0.04) {}

  get f(): number { return this.fAvg }
  get active(): boolean { return this.alerting }

  /**
   * @param windN/windE/windDown air-mass wind (NED m/s)
   * @param trackRad ground track (rad from north) and `tasMs` true airspeed
   * @returns true on the step an alert begins
   */
  step(dt: number, windN: number, windE: number, windDown: number, trackRad: number, tasMs: number, airborne: boolean): boolean {
    if (!airborne || tasMs < 30 || dt <= 0) {
      this.lastAlong = null
      this.fAvg = 0
      this.alerting = false
      return false
    }
    // Tailwind component along the track (+ = tailwind).
    const along = windN * Math.cos(trackRad) + windE * Math.sin(trackRad)
    const dWx = this.lastAlong === null ? 0 : (along - this.lastAlong) / dt
    this.lastAlong = along
    const f = dWx / 9.80665 - (-windDown) / tasMs
    const a = 1 - Math.exp(-dt / this.tauS)
    this.fAvg += a * (f - this.fAvg)
    if (!this.alerting && this.fAvg >= this.alertF) { this.alerting = true; return true }
    if (this.alerting && this.fAvg < this.clearF) this.alerting = false
    return false
  }
}
