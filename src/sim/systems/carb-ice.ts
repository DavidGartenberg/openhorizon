/**
 * Carburetor icing (Phase 11b, §24 Phase-10 Cub spec). Envelope model of
 * the classic "serious icing at glide/cruise power" chart: accretion needs
 * a carbureted engine, high humidity (small temp/dewpoint spread), OAT in
 * the icing band, and is worst at low power (large venturi pressure drop,
 * little waste heat). Carb heat melts it — and costs ~10% power while on
 * (heated intake air is less dense), which is why you don't fly with it on.
 *
 * NOT a thermodynamic model: rates are envelope-shaped to the published
 * chart's qualitative behavior (full ice in minutes in the worst corner,
 * negligible outside the envelope) — the honest middle ground between
 * ignoring carb ice and pretending to CFD it.
 */

export interface CarbIceInputs {
  carburetor: boolean
  carbHeatOn: boolean
  /** Shaft power / rated, 0..1 (low power = most vulnerable). */
  powerFrac: number
  oatC: number
  dewpointC: number
}

export interface CarbIceState {
  /** 0 = clean venturi, 1 = fully blocked. */
  iceFraction: number
}

export function makeCarbIceState(): CarbIceState {
  return { iceFraction: 0 }
}

/** Full ice in ~5 min at the worst corner of the envelope. */
const GROWTH_PER_S = 1 / 300
/** Carb heat clears full ice in ~20 s. */
const MELT_PER_S = 1 / 20
/** Slow natural sublimation outside the icing band. */
const NATURAL_MELT_PER_S = 1 / 600
/** Carb heat power penalty while on (less dense intake air). */
const HEAT_POWER_FACTOR = 0.9

function clamp01(x: number): number {
  return Math.min(Math.max(x, 0), 1)
}

export function stepCarbIce(st: CarbIceState, dt: number, inp: CarbIceInputs): void {
  if (!inp.carburetor) {
    st.iceFraction = 0
    return
  }
  // Triangle band: 0 at -5 °C, peak 1 at +13 °C, 0 at +25 °C.
  const t = inp.oatC
  const tempFactor = t <= -5 || t >= 25 ? 0 : t < 13 ? (t + 5) / 18 : (25 - t) / 12
  // Humidity from the spread: saturated (0 °C spread) = 1 → 0 at ≥8 °C.
  const humidityFactor = clamp01(1 - (inp.oatC - inp.dewpointC) / 8)
  // Vulnerability: 1 at ≤30% power, tapering to 0.15 at full power.
  const powerVuln = inp.powerFrac <= 0.3 ? 1 : 1 - ((inp.powerFrac - 0.3) / 0.7) * 0.85

  if (inp.carbHeatOn) {
    st.iceFraction = clamp01(st.iceFraction - MELT_PER_S * dt)
    return
  }
  const growth = GROWTH_PER_S * tempFactor * humidityFactor * powerVuln
  if (growth > 0) st.iceFraction = clamp01(st.iceFraction + growth * dt)
  else st.iceFraction = clamp01(st.iceFraction - NATURAL_MELT_PER_S * dt)
}

/**
 * Intake power multiplier: gentle sag to −42% at 70% blockage, then a steep
 * fall to zero at full blockage (the engine quits). Carb heat's density
 * penalty applies whenever the knob is out.
 */
export function carbIcePowerFactor(st: CarbIceState, carbHeatOn: boolean): number {
  const f = st.iceFraction
  const iceFactor = f <= 0.7 ? 1 - 0.6 * f : (1 - 0.42) * clamp01((1 - f) / 0.3)
  return iceFactor * (carbHeatOn ? HEAT_POWER_FACTOR : 1)
}
