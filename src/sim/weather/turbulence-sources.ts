/**
 * Where turbulence comes from, beyond the reported gust spread (intensity
 * scale 0 none, 1 light, 2 moderate, 3 severe — WindModel's Dryden input).
 *
 * Convective: a thunderstorm at the station is moderate-to-severe air (heavy
 * +TS severe), one in the vicinity light-to-moderate; heavy radar cells add
 * turbulence that grows as you close on them.
 *
 * Mechanical / mountain-wave rotor: strong wind across high terrain breaks
 * into rotors on the lee side, worst low down. The effect scales with the
 * terrain relief upwind and the wind speed, and fades above ~1.5 km over the
 * ground.
 */

export function convectiveTurbulence(weather: readonly string[], heavyCellDistM: number | null): number {
  let k = 0
  for (const w of weather) {
    if (!w.includes('TS')) continue
    k = Math.max(k, w.includes('VC') ? 1.5 : w.startsWith('+') ? 3 : 2.3)
  }
  if (heavyCellDistM !== null) k = Math.max(k, 3 - Math.min(3, Math.max(0, heavyCellDistM - 2000) / 4000))
  return k
}

/**
 * @param surfaceWindMs steady surface wind
 * @param upwindReliefM how much higher the terrain upwind is than here (m)
 * @param aglM height above ground
 */
export function rotorTurbulence(surfaceWindMs: number, upwindReliefM: number, aglM: number): number {
  const wind = Math.max(0, Math.min(1, (surfaceWindMs - 7.5) / 10)) // from ~15 kt, full by ~35 kt
  const relief = Math.max(0, Math.min(1, (upwindReliefM - 150) / 650)) // a real ridge upwind
  const low = 1 - Math.max(0, Math.min(1, (aglM - 300) / 1200))
  return 3 * wind * relief * low
}

/** Effective Dryden intensity: the strongest of the sources. */
export function effectiveTurbulence(gustIntensity: number, convective: number, rotor: number): number {
  return Math.max(0, Math.min(3, Math.max(gustIntensity, convective, rotor)))
}
