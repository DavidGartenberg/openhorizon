/**
 * Wake turbulence cautions from the tower.
 *
 * ICAO wake categories by maximum takeoff mass: L ≤ 7,000 kg, M up to
 * 136,000 kg, H above, J the A380 (span > 75 m). When an aircraft of a
 * heavier category has just landed on or departed your runway (last three
 * minutes), the landing clearance carries "caution wake turbulence" with
 * what it was.
 */
export type Wtc = 'L' | 'M' | 'H' | 'J'

export interface RunwayUse {
  wtc: Wtc
  kind: 'arrival' | 'departure'
  atSimS: number
  /** Type name for the phrase, e.g. "Boeing 777". */
  typeName?: string
}

const RANK: Record<Wtc, number> = { L: 0, M: 1, H: 2, J: 3 }

export function wtcFor(mtowKg: number, spanM: number): Wtc {
  if (spanM > 75) return 'J'
  if (mtowKg > 136_000) return 'H'
  if (mtowKg > 7_000) return 'M'
  return 'L'
}

/** The caution phrase for `own`, or null when no heavier traffic recently. */
export function wakeCaution(own: Wtc, uses: readonly RunwayUse[], nowS: number, windowS = 180): string | null {
  const recent = uses
    .filter((u) => nowS - u.atSimS >= 0 && nowS - u.atSimS <= windowS && RANK[u.wtc] > RANK[own])
    .sort((a, b) => b.atSimS - a.atSimS)[0]
  if (!recent) return null
  const what = recent.typeName ?? (RANK[recent.wtc] >= 2 ? 'heavy jet' : 'jet')
  return `caution wake turbulence, ${recent.kind === 'arrival' ? 'landing' : 'departing'} ${what}`
}
