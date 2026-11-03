/**
 * When the sky's rarer optics show.
 *  - 22° halo and sun dogs: hexagonal ice crystals in thin high cloud
 *    (cirrostratus: a layer based at 18,000 ft or above that isn't
 *    overcast-dense below), with the sun out. Sun dogs want a sun below
 *    ~45–60°; the shader handles that.
 *  - Aurora: poleward of ~55° magnetic-ish latitude, on active nights (a
 *    deterministic nightly activity drawn from the date, so the same night
 *    looks the same for everyone).
 */
export interface SlabLite { cover: string; baseMslFt: number }

export function haloStrength(slabs: readonly SlabLite[], sunElevDeg: number, sunTransmission: number): number {
  const thinHigh = slabs.some((s) => s.baseMslFt >= 18_000 && s.cover !== 'OVC')
  const lowDeck = slabs.some((s) => s.baseMslFt < 18_000 && (s.cover === 'BKN' || s.cover === 'OVC'))
  if (!thinHigh || lowDeck) return 0
  const ss = (a: number, b: number, x: number): number => { const t = Math.min(Math.max((x - a) / (b - a), 0), 1); return t * t * (3 - 2 * t) }
  return ss(0, 3, sunElevDeg) * ss(0.25, 0.5, sunTransmission)
}

/** Nightly aurora activity 0..1 at a latitude on a UTC date. */
export function auroraStrength(latDeg: number, date: Date): number {
  const lat = Math.abs(latDeg)
  if (lat < 52) return 0
  // One draw per night (UTC date), mostly quiet with active spells.
  const day = Math.floor(date.getTime() / 86_400_000)
  const h = Math.sin(day * 12.9898 + 78.233) * 43_758.5453
  const activity = Math.pow(h - Math.floor(h), 2)
  const reach = Math.min(Math.max((lat - 52) / 14, 0), 1) // 52° → 66°
  return Math.min(1, activity * 1.4) * reach
}
