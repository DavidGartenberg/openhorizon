/**
 * Total-energy variometer (sailplanes).
 *
 * Reads the rate of change of total energy height, h + V²/(2g), so a pull-up
 * that trades speed for height ("stick thrust") does not show as lift. Only
 * the air mass moving up or down does. A first-order lag (τ ≈ 1.5 s) gives it
 * the response of a real mechanical or electronic vario.
 */
const G = 9.80665

export class TeVario {
  private lastE: number | null = null
  /** Filtered total-energy climb rate, m/s (+ = lift). */
  rateMs = 0

  constructor(readonly tauS = 1.5) {}

  step(dt: number, altM: number, tasMs: number): number {
    if (dt <= 0) return this.rateMs
    const e = altM + (tasMs * tasMs) / (2 * G)
    if (this.lastE !== null) {
      const raw = (e - this.lastE) / dt
      const a = 1 - Math.exp(-dt / this.tauS)
      this.rateMs += a * (raw - this.rateMs)
    }
    this.lastE = e
    return this.rateMs
  }

  reset(): void {
    this.lastE = null
    this.rateMs = 0
  }
}

/**
 * Audio vario convention: climb is a beeping tone whose pitch and cadence
 * rise with the climb rate. Sink beyond the dead band is a low, continuous,
 * falling tone. Weak sink and zero are silent.
 */
export function varioTone(rateMs: number): { on: boolean; freqHz: number; beepHz: number } {
  if (rateMs > 0.3) {
    const r = Math.min(rateMs, 6)
    return { on: true, freqHz: 600 + 110 * r, beepHz: 1.5 + 1.2 * r }
  }
  if (rateMs < -2) {
    const r = Math.min(-rateMs, 6)
    return { on: true, freqHz: Math.max(180, 420 - 40 * r), beepHz: 0 }
  }
  return { on: false, freqHz: 0, beepHz: 0 }
}
