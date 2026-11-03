/**
 * Humid air. Water vapour (18 g/mol) is lighter than dry air (29 g/mol), so
 * humid air is less dense at the same pressure and temperature: the
 * virtual temperature Tv = T / (1 − 0.378·e/p) stands in for T. Piston
 * engines lose more: the vapour displaces oxygen, so power scales with the
 * dry-air partial pressure (p − e)/p, about 3–4% on a hot, muggy day.
 * The dew point (METAR) gives the vapour pressure (Magnus).
 */

/** Saturation / actual vapour pressure (hPa) at a temperature (Magnus–Tetens). */
export function vapourPressureHpa(tempC: number): number {
  return 6.1094 * Math.exp((17.625 * tempC) / (tempC + 243.04))
}

/** Air density (kg/m³) with water vapour at dew point `dewC`. */
export function humidDensity(pressurePa: number, temperatureK: number, dewC: number): number {
  const e = Math.min(vapourPressureHpa(dewC) * 100, pressurePa * 0.2)
  return (pressurePa / (287.05 * temperatureK)) * (1 - (0.378 * e) / pressurePa)
}

/** Humid / dry density ratio (≤ 1). */
export function humidDensityRatio(pressurePa: number, dewC: number): number {
  const e = Math.min(vapourPressureHpa(dewC) * 100, pressurePa * 0.2)
  return 1 - (0.378 * e) / pressurePa
}

/** Piston power factor from vapour displacing oxygen: (p − e)/p (≤ 1). */
export function humidPowerFactor(pressurePa: number, dewC: number): number {
  const e = Math.min(vapourPressureHpa(dewC) * 100, pressurePa * 0.2)
  return 1 - e / pressurePa
}

/** Vapour pressure (hPa) aloft from the surface value: the mixing ratio
 *  carries up (e ∝ p), capped at saturation at the local temperature. */
export function vapourAtHpa(e0Hpa: number, p0Pa: number, pPa: number, tempK: number): number {
  return Math.min(e0Hpa * (pPa / p0Pa), vapourPressureHpa(tempK - 273.15))
}

/** Humidity from a surface report: dew point (°C) and the pressure (Pa)
 *  at the reporting station. */
export interface SurfaceHumidity { dewPointC: number; stationPressurePa: number }

/** Vapour fraction e/p (0..0.2) at pressure `pPa` and temperature `tempK`
 *  from the surface report: density scales by 1 − 0.378·f, a piston
 *  engine's charge by 1 − f. */
export function vapourFraction(h: SurfaceHumidity, pPa: number, tempK: number): number {
  if (!Number.isFinite(h.dewPointC) || !(h.stationPressurePa > 0) || !(pPa > 0)) return 0
  const e = vapourAtHpa(vapourPressureHpa(h.dewPointC), h.stationPressurePa, pPa, tempK) * 100
  return Math.min(Math.max(e / pPa, 0), 0.2)
}
