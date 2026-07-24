/**
 * Wind model (§5.3): steady layered wind + gusts + simplified Dryden-style
 * turbulence (first-order colored noise per axis with MIL-F-8785C-flavored
 * scales). METAR-driven winds arrive in Phase 5; the interface is ready.
 */
import type { V3 } from '../math/vec'
import { v3, v3set } from '../math/vec'

export class WindModel {
  /** Steady wind: direction FROM (deg true), speed (kt) → NED vector. */
  private steady = v3()
  private turb = v3()
  /** 0 = calm air, 1 = light chop, 2 = moderate, 3 = severe. */
  intensity = 0
  gustKt = 0
  private gustPhase = Math.random() * 1000

  setSteady(directionFromDeg: number, speedKt: number, gustKt = 0): void {
    const toRad = ((directionFromDeg + 180) % 360) * (Math.PI / 180)
    const ms = speedKt * 0.514444
    v3set(this.steady, Math.cos(toRad) * ms, Math.sin(toRad) * ms, 0)
    this.gustKt = Math.max(gustKt - speedKt, 0)
  }

  /** Steady surface wind speed, m/s (13e: feeds the ocean sea state). */
  get steadyMs(): number {
    return Math.hypot(this.steady.x, this.steady.y)
  }

  /** Bearing the steady wind blows TOWARD, rad (0 = north, +cw). */
  get steadyTowardRad(): number {
    return Math.atan2(this.steady.y, this.steady.x)
  }

  /** Advance turbulence states; returns total wind (NED, m/s). */
  step(dt: number, out: V3): V3 {
    // Dryden-flavored first-order shaping filters.
    const tau = { x: 3.5, y: 2.5, z: 1.8 }
    const sigma = this.intensity * 0.9 // m/s per axis at intensity 1
    for (const axis of ['x', 'y', 'z'] as const) {
      const t = tau[axis]
      const noise = (Math.random() * 2 - 1) * Math.sqrt(3)
      this.turb[axis] +=
        (dt / t) * (-this.turb[axis]) + sigma * Math.sqrt((2 * dt) / t) * noise
    }

    // Slow gust swell on top of steady wind.
    this.gustPhase += dt
    const gustFactor =
      1 +
      (this.gustKt * 0.514444 *
        Math.max(Math.sin(this.gustPhase * 0.35) + Math.sin(this.gustPhase * 0.13) - 1.2, 0)) /
        Math.max(Math.hypot(this.steady.x, this.steady.y), 0.1)

    return v3set(
      out,
      this.steady.x * gustFactor + this.turb.x,
      this.steady.y * gustFactor + this.turb.y,
      this.turb.z,
    )
  }
}
