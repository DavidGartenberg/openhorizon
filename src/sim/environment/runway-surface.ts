/**
 * Runway contamination and tyre friction.
 *
 * The surface state comes from the reported present weather (METAR codes)
 * and temperature. Friction is scaled against the dry value with ratios in
 * line with published braking-action categories (wet ≈ medium, compacted
 * snow ≈ medium-poor, ice ≈ poor/nil). Slush and loose snow also add
 * displacement drag to the rolling resistance. Standing water causes dynamic
 * hydroplaning above V_P ≈ 9·√p knots (p = tyre pressure, psi), where the
 * tyre rides on the water film and braking all but disappears.
 */

export type RunwayCondition = 'dry' | 'wet' | 'flooded' | 'slush' | 'snow' | 'ice'

const PRECIP = /^[-+]?(VC)?(MI|PR|BC|DR|BL|SH|TS|FZ)?(DZ|RA|SN|SG|PL|GR|GS|UP)+$/

/** Runway state from METAR present-weather groups and temperature (°C). */
export function runwayConditionFromWeather(weather: readonly string[], tempC: number | undefined): RunwayCondition {
  const groups = weather.filter((w) => PRECIP.test(w) && !w.includes('VC'))
  if (groups.length === 0) return 'dry'
  const has = (re: RegExp): boolean => groups.some((g) => re.test(g))
  const heavy = groups.some((g) => g.startsWith('+'))
  if (has(/FZ(RA|DZ)/)) return 'ice'
  if (has(/SN|SG|PL|GS|GR/)) {
    if (tempC !== undefined && tempC > 1) return 'slush'
    return tempC !== undefined && tempC < -3 ? 'snow' : 'slush'
  }
  if (has(/RA|DZ/)) {
    if (tempC !== undefined && tempC <= 0) return 'ice'
    return heavy || has(/TSRA|SHRA/) ? 'flooded' : 'wet'
  }
  return 'dry'
}

export interface SurfaceFriction {
  brakeMuScale: number
  latMuScale: number
  rollingScale: number
  hydroplaning: boolean
}

const TABLE: Record<RunwayCondition, Omit<SurfaceFriction, 'hydroplaning'>> = {
  dry: { brakeMuScale: 1, latMuScale: 1, rollingScale: 1 },
  wet: { brakeMuScale: 0.6, latMuScale: 0.75, rollingScale: 1.1 },
  flooded: { brakeMuScale: 0.45, latMuScale: 0.6, rollingScale: 1.6 },
  slush: { brakeMuScale: 0.35, latMuScale: 0.5, rollingScale: 3 },
  snow: { brakeMuScale: 0.3, latMuScale: 0.45, rollingScale: 2.2 },
  ice: { brakeMuScale: 0.12, latMuScale: 0.18, rollingScale: 1 },
}

/** Dynamic hydroplaning onset (m/s) for a tyre pressure (psi): V_P = 9·√p kt. */
export function hydroplaningSpeedMs(tirePressurePsi: number): number {
  return 9 * Math.sqrt(Math.max(tirePressurePsi, 1)) * 0.514444
}

/** Typical main-tyre pressure by size: light GA ≈ 35 psi, turboprops and
 *  business jets ≈ 100–150, transports ≈ 200 (estimates, not per-type data). */
export function tirePressurePsiFor(mtowKg: number): number {
  if (mtowKg > 40_000) return 200
  if (mtowKg > 12_000) return 150
  if (mtowKg > 5_700) return 100
  return 35
}

export function surfaceFriction(cond: RunwayCondition, groundSpeedMs: number, tirePressurePsi: number): SurfaceFriction {
  const base = TABLE[cond]
  const hydro = (cond === 'flooded' || cond === 'slush') && groundSpeedMs > hydroplaningSpeedMs(tirePressurePsi)
  if (!hydro) return { ...base, hydroplaning: false }
  return { brakeMuScale: 0.08, latMuScale: 0.12, rollingScale: base.rollingScale, hydroplaning: true }
}
