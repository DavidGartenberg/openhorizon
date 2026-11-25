import type { AirportData } from './airports'

/** Departure search: exact ident first, then ident prefix (a 3-letter US
 *  code also matches its K-prefixed ICAO), then name / city words; larger
 *  airports first within a rank. Pure — tested. */
export function searchAirports(all: readonly AirportData[], query: string, limit = 8): AirportData[] {
  const q = query.trim().toUpperCase()
  if (q.length < 2) return []
  const rank = (a: AirportData): number => {
    if (a.i === q || a.i === `K${q}`) return 0
    if (a.i.startsWith(q) || (q.length === 3 && a.i === `K${q}`)) return 1
    const n = a.n.toUpperCase()
    if (n.startsWith(q)) return 2
    if (n.split(/[\s/-]+/).some((w) => w.startsWith(q))) return 3
    if (n.includes(q)) return 4
    return 9
  }
  const hits: Array<{ a: AirportData; r: number }> = []
  for (const a of all) {
    const r = rank(a)
    if (r < 9) hits.push({ a, r })
  }
  hits.sort((x, y) => x.r - y.r || y.a.t - x.a.t || x.a.i.localeCompare(y.a.i))
  return hits.slice(0, limit).map((h) => h.a)
}

