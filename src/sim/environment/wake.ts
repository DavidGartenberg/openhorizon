/**
 * Wake turbulence behind other aircraft.
 *
 * Every generator (AI pattern traffic, live ADS-B targets) lays down a trail
 * of wake segments, one about every second. Each segment holds a
 * counter-rotating vortex pair:
 *   - initial circulation Γ₀ = M·g / (ρ·V·b₀), with b₀ = π·b/4 the spacing
 *     of the rolled-up vortices for an elliptic load;
 *   - each vortex is a Lamb–Oseen line vortex, v_θ = Γ/(2πr)·(1 − e^(−r²/rc²)),
 *     with core radius rc ≈ 0.05·b;
 *   - the pair sinks under mutual induction at Γ/(2π·b₀) and drifts with the
 *     wind;
 *   - circulation holds for ~30 s, then decays exponentially (τ ≈ 70 s), so a
 *     heavy's wake is dangerous for about two minutes and gone after four.
 * Between the vortices the air moves down, outboard of them it moves up.
 * The field answers the vertical air velocity at a point, and the roll gust
 * (rad/s) across a wingspan: the classic wake encounter is a violent roll.
 */

export interface WakeGenerator {
  id: string
  /** Frame-local north/east (m) and altitude (m MSL). */
  n: number
  e: number
  altM: number
  /** Ground track (rad from north) and true airspeed (m/s). */
  trackRad: number
  speedMs: number
  massKg: number
  spanM: number
}

interface WakeSegment {
  id: string
  n: number
  e: number
  altM: number
  trackRad: number
  t0: number
  gamma0: number
  b0: number
  rc: number
}

const G = 9.80665

/** Initial circulation (m²/s) and vortex spacing (m) for a generator. */
export function wakeCirculation(massKg: number, speedMs: number, spanM: number, rho = 1.225): { gamma0: number; b0: number } {
  const b0 = (Math.PI * spanM) / 4
  return { gamma0: (massKg * G) / (rho * Math.max(speedMs, 20) * b0), b0 }
}

/** Circulation fraction remaining after `ageS` seconds. */
export function wakeDecay(ageS: number): number {
  if (ageS < 0) return 0
  return ageS < 30 ? 1 : Math.exp(-(ageS - 30) / 70)
}

export class WakeField {
  private segments: WakeSegment[] = []
  private lastPush = new Map<string, number>()
  /** Segments older than this are dropped (s). */
  readonly maxAgeS = 240
  /** Minimum time between segments per generator (s). */
  readonly spacingS = 1

  get size(): number { return this.segments.length }

  /** Record a generator's position; adds a segment at most once per second. */
  push(g: WakeGenerator, timeS: number, rho = 1.225): void {
    const last = this.lastPush.get(g.id)
    if (last !== undefined && timeS - last < this.spacingS) return
    if (g.speedMs < 20 || g.massKg <= 0 || g.spanM <= 0) return // on the ground / unknown
    this.lastPush.set(g.id, timeS)
    const { gamma0, b0 } = wakeCirculation(g.massKg, g.speedMs, g.spanM, rho)
    this.segments.push({ id: g.id, n: g.n, e: g.e, altM: g.altM, trackRad: g.trackRad, t0: timeS, gamma0, b0, rc: 0.05 * g.spanM })
  }

  /** Drop expired segments. */
  prune(timeS: number): void {
    if (this.segments.length && timeS - this.segments[0]!.t0 > this.maxAgeS) {
      this.segments = this.segments.filter((s) => timeS - s.t0 <= this.maxAgeS)
    }
  }

  clear(): void {
    this.segments = []
    this.lastPush.clear()
  }

  /** Floating-origin rebase: move every stored segment by (dn, de). */
  shift(dn: number, de: number): void {
    for (const s of this.segments) { s.n += dn; s.e += de }
  }

  /**
   * Upward air velocity (m/s) induced at a point by the nearest segment of
   * each generator, given the wind the vortices drift with (north/east m/s).
   * `excludeId` skips a generator's own wake.
   */
  verticalAt(n: number, e: number, altM: number, timeS: number, windN = 0, windE = 0, excludeId?: string): number {
    // Nearest segment per generator (along-track spacing ≈ V·1 s).
    const best = new Map<string, { seg: WakeSegment; d: number }>()
    for (const s of this.segments) {
      if (s.id === excludeId) continue
      const age = timeS - s.t0
      if (age < 0 || age > this.maxAgeS) continue
      const dn = n - (s.n + windN * age), de = e - (s.e + windE * age)
      const d = dn * dn + de * de
      if (d > 4e6) continue // 2 km
      const cur = best.get(s.id)
      if (!cur || d < cur.d) best.set(s.id, { seg: s, d })
    }
    let w = 0
    for (const { seg: s } of best.values()) {
      const age = timeS - s.t0
      const gamma = s.gamma0 * wakeDecay(age)
      if (gamma < 1) continue
      // Cross-section coordinates: lateral (right of the generator's track)
      // and vertical, relative to the sunk, drifted vortex pair.
      const dn = n - (s.n + windN * age), de = e - (s.e + windE * age)
      const rightN = -Math.sin(s.trackRad), rightE = Math.cos(s.trackRad)
      const along = dn * Math.cos(s.trackRad) + de * Math.sin(s.trackRad)
      if (Math.abs(along) > 150) continue // only the local slice of the trail
      const y = dn * rightN + de * rightE
      const sink = (s.gamma0 / (2 * Math.PI * s.b0)) * Math.min(age, 30) + (s.gamma0 / (2 * Math.PI * s.b0)) * 70 * (1 - wakeDecay(Math.max(age, 30)))
      const z = altM - (s.altM - sink)
      // Right vortex (+b0/2) turns counter-clockwise seen from behind; left clockwise.
      for (const [y0, sign] of [[s.b0 / 2, 1], [-s.b0 / 2, -1]] as const) {
        const dy = y - y0, dz = z
        const r2 = dy * dy + dz * dz
        if (r2 > 250_000) continue
        const core = 1 - Math.exp(-r2 / (s.rc * s.rc))
        // CCW point vortex: (v_y, v_z) = Γ/(2πr²)·(−dz, dy).
        w += ((sign * gamma) / (2 * Math.PI * Math.max(r2, 1e-6))) * dy * core
      }
    }
    return w
  }

  /**
   * Roll gust (rad/s) across a wing of `spanM` centred at a point, for an
   * aircraft whose heading is `headingRad`: (w_up,left − w_up,right)/span.
   */
  rollGustAt(n: number, e: number, altM: number, headingRad: number, spanM: number, timeS: number, windN = 0, windE = 0, excludeId?: string): number {
    const h = spanM / 2
    const rn = -Math.sin(headingRad) * h, re = Math.cos(headingRad) * h
    const wR = this.verticalAt(n + rn, e + re, altM, timeS, windN, windE, excludeId)
    const wL = this.verticalAt(n - rn, e - re, altM, timeS, windN, windE, excludeId)
    return (wL - wR) / spanM
  }
}
