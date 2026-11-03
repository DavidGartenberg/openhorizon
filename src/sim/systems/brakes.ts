/**
 * Wheel-brake thermal model: heating, cooling and fade.
 *
 * The brakes turn the friction work (brake force × wheel slip speed, from
 * the gear model) into heat in a sink whose capacity scales with the
 * airplane: a C172's Cleveland disc assembly is ≈1.45 kg of steel (≈670 J/K
 * a side); a 737's carbon heat stacks are ≈80 kg a side (≈88 kJ/K). They cool
 * by convection, ten times faster in airflow than standing. Linings fade
 * when hot:
 *  - organic and metallic GA pads hold to 300 °C, fall to 55% by 500 °C and
 *    40% by 650 °C;
 *  - carbon hold to 1,000 °C.
 * A single maximum-braking C172 stop from 50 kt at full weight heats them
 * ≈240 K (no fade: the POH distances stand); back-to-back stops without cooling do not. A 737's
 * rejected takeoff at maximum energy heats them ≈1,000 K, which is why
 * brake cooling schedules exist.
 */
export interface BrakeSpec {
  /** Heat capacity per side, J/K. */
  capacityJK: number
  /** Standing (no airflow) cooling time constant, s. */
  coolTauS: number
  /** Fade onset / 55% / floor temperatures, °C. */
  fadeC: [number, number, number]
}

export function brakeSpecFor(mtowKg: number, jet: boolean): BrakeSpec {
  return jet
    ? { capacityJK: 1.1 * mtowKg, coolTauS: 3600, fadeC: [1000, 1250, 1450] }
    : { capacityJK: 0.6 * mtowKg, coolTauS: 600, fadeC: [300, 500, 650] }
}

/** Friction multiplier at a lining temperature (1 = cold brakes). */
export function brakeFade(tempC: number, spec: BrakeSpec): number {
  const [a, b, c] = spec.fadeC
  if (tempC <= a) return 1
  if (tempC <= b) return 1 - 0.45 * ((tempC - a) / (b - a))
  if (tempC <= c) return 0.55 - 0.15 * ((tempC - b) / (c - b))
  return 0.4
}

export class BrakeThermal {
  /** Lining temperatures, °C (left, right). */
  readonly tempC: [number, number]
  /** Current friction multipliers from fade (left, right). */
  readonly fade: [number, number] = [1, 1]
  constructor(readonly spec: BrakeSpec, ambientC = 15) {
    this.tempC = [ambientC, ambientC]
  }

  /** @param powerW friction work rate per side (W); @param airspeedMs cooling airflow */
  step(dt: number, powerLeftW: number, powerRightW: number, airspeedMs: number, ambientC: number): void {
    if (!(dt > 0)) return
    const k = (this.spec.capacityJK / this.spec.coolTauS) * (1 + Math.max(airspeedMs, 0) / 6)
    const pw = [powerLeftW, powerRightW]
    for (let i = 0; i < 2; i++) {
      const p = Number.isFinite(pw[i]!) ? Math.max(pw[i]!, 0) : 0
      const t = this.tempC[i]!
      // Exact exponential step for the cooling (stable at any dt).
      const tau = this.spec.capacityJK / k
      const tInf = ambientC + p / k
      this.tempC[i] = tInf + (t - tInf) * Math.exp(-dt / tau)
      this.fade[i] = brakeFade(this.tempC[i]!, this.spec)
    }
  }

  /** Hottest side, °C. */
  get maxTempC(): number {
    return Math.max(this.tempC[0], this.tempC[1])
  }

  reset(ambientC = 15): void {
    this.tempC[0] = this.tempC[1] = ambientC
    this.fade[0] = this.fade[1] = 1
  }
}
