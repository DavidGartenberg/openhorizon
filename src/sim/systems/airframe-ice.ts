/**
 * Airframe (structural) icing.
 *
 * Supercooled liquid water freezes on the leading edges at a rate
 *   dh/dt = E · LWC · V / ρ_ice
 * (collection efficiency E ≈ 0.4, ice density ≈ 880 kg/m³). Liquid water
 * content comes from being in cloud (≈ 0.3 g/m³ stratiform) or in
 * precipitation (freezing rain ≈ 0.8 g/m³, the worst case). Supercooled water
 * is most common from 0 to −10 °C and becomes rare below about −20 °C, when
 * clouds glaciate; E is scaled by that temperature range. Above freezing the ice melts
 * and sheds.
 *
 * Effects, modelled on the documented trend that even thin, rough ice costs
 * a large share of the maximum lift and adds drag:
 *   CLmax factor = 1 − 0.30·(1 − e^(−h/6 mm))
 *   ΔCD          =   0.025·(1 − e^(−h/8 mm))
 * Protected airframes (anti-ice or de-ice boots: the jets and turboprops in
 * the fleet) collect only 5% of that (runback). Estimates, not certification
 * data. They give the right shape: earlier stall, more drag, a slower, sinkier
 * airplane.
 */

export type Precipitation = 'none' | 'rain' | 'drizzle' | 'freezingRain' | 'snow'

export interface IcingInput {
  dt: number
  oatC: number
  /** In-cloud factor 0..1 (visible moisture). */
  inCloud: number
  precip: Precipitation
  tasMs: number
  /** Anti-ice / de-ice fitted and operating. */
  protectedAirframe: boolean
}

const RHO_ICE = 880
const E_COLLECT = 0.4

/** Fraction of cloud water that is supercooled at a temperature (0..1). */
export function supercooledFraction(oatC: number): number {
  if (oatC > 0 || oatC < -25) return 0
  if (oatC >= -10) return 1
  return Math.max(0, 1 - (-10 - oatC) / 15)
}

/** Precipitation code from METAR present-weather groups. */
export function precipitationFromWeather(weather: readonly string[]): Precipitation {
  const g = weather.filter((w) => !w.includes('VC'))
  if (g.some((w) => /FZ(RA|DZ)/.test(w))) return 'freezingRain'
  if (g.some((w) => /SN|SG|PL|GS|GR/.test(w))) return 'snow'
  if (g.some((w) => /RA/.test(w))) return 'rain'
  if (g.some((w) => /DZ/.test(w))) return 'drizzle'
  return 'none'
}

export class AirframeIce {
  /** Accreted thickness at the leading edge, mm. */
  thicknessMm = 0

  /** Liquid water content (kg/m³) available to freeze. */
  static lwc(inCloud: number, precip: Precipitation, oatC: number): number {
    if (precip === 'freezingRain') return oatC <= 0 ? 8e-4 : 0
    const cloud = Math.max(0, Math.min(1, inCloud)) * 3e-4
    const rain = precip === 'rain' || precip === 'drizzle' ? 2e-4 : 0
    return (cloud + rain) * supercooledFraction(oatC)
  }

  step(inp: IcingInput): void {
    if (inp.dt <= 0) return
    if (inp.oatC > 0.5) {
      // Melting / shedding: ~1 mm/min per degree above freezing, at least 0.5 mm/min.
      const melt = Math.max(0.5, inp.oatC) / 60
      this.thicknessMm = Math.max(0, this.thicknessMm - melt * inp.dt)
      return
    }
    const rate = (E_COLLECT * AirframeIce.lwc(inp.inCloud, inp.precip, inp.oatC) * Math.max(inp.tasMs, 0)) / RHO_ICE // m/s
    const k = inp.protectedAirframe ? 0.05 : 1
    this.thicknessMm = Math.min(40, this.thicknessMm + rate * 1000 * k * inp.dt)
  }

  get clMaxFactor(): number {
    return 1 - 0.3 * (1 - Math.exp(-this.thicknessMm / 6))
  }

  get cdIncrement(): number {
    return 0.025 * (1 - Math.exp(-this.thicknessMm / 8))
  }

  reset(): void {
    this.thicknessMm = 0
  }
}
