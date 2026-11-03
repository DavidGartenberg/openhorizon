/**
 * Rain on the airframe. Water films and drop impacts roughen the wing's
 * leading edge and cratering adds drag. NASA's heavy-rain experiments
 * (Bezos et al., 1992) measured CLmax losses from a few per cent in
 * thunderstorm downpours up to ~20% at extreme rates, with drag rising
 * alongside. Light rain does nothing, moderate rain almost nothing; a
 * +TSRA cell is worth a few per cent of lift margin.
 *
 * Rain rate (mm/h) from METAR intensity: −RA ≈ 2, RA ≈ 6, +RA ≈ 25,
 * +TSRA cells ≈ 60. Showers sit a step heavier.
 */
export function rainRateMmH(weather: readonly string[]): number {
  let rate = 0
  for (const w of weather) {
    if (!/RA/.test(w)) continue
    const heavy = w.startsWith('+'), light = w.startsWith('-')
    let r = heavy ? 25 : light ? 2 : 6
    if (/TS/.test(w)) r *= heavy ? 2.4 : 2
    else if (/SH/.test(w)) r *= 1.5
    rate = Math.max(rate, r)
  }
  return rate
}

/** CLmax multiplier and added drag coefficient in rain of `rateMmH`.
 *  Light rain (≤ 2 mm/h) leaves the wing alone; the penalty builds in over
 *  2–8 mm/h as the film and the impacts start to roughen it. */
export function heavyRainPenalty(rateMmH: number): { clMaxFactor: number; dCd: number } {
  const r = Math.max(rateMmH, 0)
  if (r <= 2) return { clMaxFactor: 1, dCd: 0 }
  const t = Math.min((r - 2) / 6, 1), onset = t * t * (3 - 2 * t)
  const x = r / 50
  return {
    clMaxFactor: 1 - Math.min(0.05 * Math.sqrt(x) * onset, 0.12),
    dCd: Math.min(0.003 * Math.pow(x, 0.7) * onset, 0.008),
  }
}
