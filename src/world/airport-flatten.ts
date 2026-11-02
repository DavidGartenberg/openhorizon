/**
 * How a whole airport sits on the terrain (pure). A real airport is level
 * ground: X-Plane flattens the terrain under its pavement. The runways already
 * carry their own corridor flattening (math/geo flattenForRunway); this adds
 * one level disk around the airport — expressed as a zero-length "runway" so the
 * terrain worker and the physics sampler need no new code — so the taxiways,
 * aprons and terminals beside the runways lie on the same ground as the runways
 * instead of sinking into (or hovering over) the bare elevation model.
 */
import type { AirportData } from './airports'

const FT = 0.3048
const M_PER_DEG_LAT = 111_319.5
/** Inner flat radius = halfWidth + 40 m in flattenForRunway, so a disk of radius R uses halfWidth R − 40. */
export const FLAT_INNER_MARGIN_M = 40

/** The level the airport's pavement lies at: the mean of its runway end elevations (m). */
export function airportFieldElevationM(ap: Pick<AirportData, 'r' | 'e'>): number {
  const ends = ap.r.flatMap((r) => [r.e1, r.e2]).filter(Number.isFinite)
  if (!ends.length) return (Number.isFinite(ap.e) ? ap.e : 0) * FT
  return (ends.reduce((a, b) => a + b, 0) / ends.length) * FT
}

/** The level area never grows past this radius (m), however far an airport's pavement reaches. */
export const MAX_FLAT_RADIUS_M = 4500
const EXTENT_MARGIN_M = 150

/** Radius (m) of the level area around the airport reference: from its runways, and from the reach of its pavement when X-Plane's layout is known. */
export function airportFlatRadiusM(ap: Pick<AirportData, 'r' | 't'> & Partial<Pick<AirportData, 'la' | 'lo' | 'x'>>): number {
  const longest = Math.max(0, ...ap.r.map((r) => (Number.isFinite(r.l) ? r.l : 0))) * FT
  if (longest < 400) return 0                                   // a strip or heli pad: runway corridor only
  const commercial = ap.t >= 1 && longest >= 2100
  const base = commercial ? Math.min(2600, Math.max(900, 0.4 * longest + 600)) : Math.min(700, Math.max(250, 0.2 * longest + 250))
  if (!ap.x || !Number.isFinite(ap.la) || !Number.isFinite(ap.lo)) return base
  // The farthest corner of the pavement's box from the airport reference.
  const mLon = M_PER_DEG_LAT * Math.cos((ap.la! * Math.PI) / 180)
  let far = 0
  for (const la of [ap.x[0], ap.x[2]]) for (const lo of [ap.x[1], ap.x[3]]) far = Math.max(far, Math.hypot((lo - ap.lo!) * mLon, (la - ap.la!) * M_PER_DEG_LAT))
  return Math.max(base, Math.min(MAX_FLAT_RADIUS_M, far + EXTENT_MARGIN_M))
}

export interface FlatDisk { lat: number; lon: number; elevM: number; halfWidthM: number }

/** The airport's level disk as a zero-length "runway" (null when it needs none). */
export function airportFlatDisk(ap: Pick<AirportData, 'r' | 't' | 'e' | 'la' | 'lo'> & Partial<Pick<AirportData, 'x'>>): FlatDisk | null {
  const radius = airportFlatRadiusM(ap)
  if (radius <= 0) return null
  return { lat: ap.la, lon: ap.lo, elevM: airportFieldElevationM(ap), halfWidthM: Math.max(1, radius - FLAT_INNER_MARGIN_M) }
}

export interface FlattenEnds { la1: number; lo1: number; la2: number; lo2: number; e1M?: number; e2M?: number }

/**
 * The two ends of the ground that is levelled for a runway: its pavement ends pushed outward by the blast pad /
 * overrun beyond each (`o1` beyond end 1, `o2` beyond end 2; X-Plane's apt.dat), so the level ground reaches
 * the end of the paved overrun instead of stopping about 70 m past the runway. The end elevations (`e1M`, `e2M`,
 * metres, when given) are carried along the runway's own slope, so the plane over the runway itself is unchanged.
 * No overrun → the runway's own ends.
 */
export function flattenEnds(r: FlattenEnds & { o1?: number; o2?: number }): FlattenEnds {
  const o1 = Number.isFinite(r.o1) ? Math.max(0, r.o1!) : 0, o2 = Number.isFinite(r.o2) ? Math.max(0, r.o2!) : 0
  const base: FlattenEnds = { la1: r.la1, lo1: r.lo1, la2: r.la2, lo2: r.lo2, ...(r.e1M !== undefined ? { e1M: r.e1M } : {}), ...(r.e2M !== undefined ? { e2M: r.e2M } : {}) }
  if (!(o1 > 0 || o2 > 0)) return base
  const mLon = M_PER_DEG_LAT * Math.cos((((r.la1 + r.la2) / 2) * Math.PI) / 180)
  const dx = (r.lo2 - r.lo1) * mLon, dy = (r.la2 - r.la1) * M_PER_DEG_LAT
  const len = Math.hypot(dx, dy)
  if (!(len > 1) || !(mLon > 1)) return base
  const ux = dx / len, uy = dy / len
  const out: FlattenEnds = {
    la1: r.la1 - (uy * o1) / M_PER_DEG_LAT, lo1: r.lo1 - (ux * o1) / mLon,
    la2: r.la2 + (uy * o2) / M_PER_DEG_LAT, lo2: r.lo2 + (ux * o2) / mLon,
  }
  if (Number.isFinite(r.e1M) && Number.isFinite(r.e2M)) {
    const slope = (r.e2M! - r.e1M!) / len                       // metres of rise per metre along the runway
    out.e1M = r.e1M! - slope * o1; out.e2M = r.e2M! + slope * o2
  }
  return out
}

/**
 * X-Plane's runway table by airport. Each row is [one end's designator, the other end's, overrun beyond the first (m),
 * beyond the second (m)] and, where the old database has the runway in the wrong place or width, also
 * [first end's lat, lon, second end's lat, lon, width (m)] — X-Plane's own; with two more (surface code, edge lights) the
 * runway is one the database lacks altogether.
 */
export type RunwayExtras = Record<string, Array<[string, string, number, number] | [string, string, number, number, number, number, number, number, number] | [string, string, number, number, number, number, number, number, number, number, number]>>

/** "09L" and "9L" are the same runway end. */
const endKey = (id: string): string => String(id).trim().toUpperCase().replace(/^0+(?=\d)/, '')
const FT_PER_M = 1 / 0.3048
/** apt.dat surface codes that are not hard pavement: turf, dirt, gravel, dry lakebed, snow / ice. */
const SOFT_SURFACES = new Set([3, 4, 5, 12, 14])

/** Put X-Plane's overrun lengths — and where it differs, its runway ends and width — on the matching runways (in place). Unmatched or malformed entries are ignored. */
export function applyRunwayExtras(airports: ReadonlyArray<Pick<AirportData, 'i' | 'r'> & { e?: number }>, extras: RunwayExtras): void {
  if (!extras || typeof extras !== 'object') return
  for (const ap of airports) {
    const rows = extras[ap.i]
    if (!Array.isArray(rows)) continue
    addMissingRunways(ap, rows)
    for (const r of ap.r) {
      const li = endKey(r.li), hi = endKey(r.hi)
      for (const row of rows) {
        if (!Array.isArray(row) || row.length < 4) continue
        const a = endKey(row[0]), b = endKey(row[1])
        const forward = a === li && b === hi, reverse = a === hi && b === li
        if (!forward && !reverse) continue
        const oa = Number(row[2]), ob = Number(row[3])
        const first = forward ? oa : ob, second = forward ? ob : oa
        if (Number.isFinite(first) && first > 0) r.o1 = Math.min(first, 600)
        if (Number.isFinite(second) && second > 0) r.o2 = Math.min(second, 600)
        if (row.length >= 9) {
          const [laA, loA, laB, loB, wM] = row.slice(4, 9).map(Number) as [number, number, number, number, number]
          if ([laA, loA, laB, loB].every(Number.isFinite) && Math.abs(laA) <= 90 && Math.abs(laB) <= 90 && Math.abs(loA) <= 180 && Math.abs(loB) <= 180) {
            const [l1, o1, l2, o2] = forward ? [laA, loA, laB, loB] : [laB, loB, laA, loA]
            r.la1 = l1; r.lo1 = o1; r.la2 = l2; r.lo2 = o2
            r.l = Math.hypot((o2 - o1) * 111_319.5 * Math.cos((((l1 + l2) / 2) * Math.PI) / 180), (l2 - l1) * 111_319.5) * FT_PER_M
            if (Number.isFinite(wM) && wM > 0) r.w = wM * FT_PER_M
          }
        }
        break
      }
    }
  }
}

/** Add the runways X-Plane lists that the database lacks: rows of 11 fields (…, width m, surface code, edge lights) that match none of the airport's runways. */
function addMissingRunways(ap: Pick<AirportData, 'i' | 'r'> & { e?: number }, rows: RunwayExtras[string]): void {
  for (const row of rows) {
    if (!Array.isArray(row) || row.length < 11) continue
    const a = endKey(row[0]), b = endKey(row[1])
    if (ap.r.some((q) => { const li = endKey(q.li), hi = endKey(q.hi); return (a === li && b === hi) || (a === hi && b === li) })) continue
    const [laA, loA, laB, loB, wM, surf, edge] = row.slice(4, 11).map(Number) as [number, number, number, number, number, number, number]
    if (![laA, loA, laB, loB].every(Number.isFinite) || Math.abs(laA) > 90 || Math.abs(laB) > 90 || Math.abs(loA) > 180 || Math.abs(loB) > 180) continue
    const lenFt = Math.hypot((loB - loA) * 111_319.5 * Math.cos((((laA + laB) / 2) * Math.PI) / 180), (laB - laA) * 111_319.5) * FT_PER_M
    if (lenFt < 200 / 0.3048) continue
    const elev = Number.isFinite(ap.e) ? (ap.e as number) : (ap.r[0]?.e1 ?? 0)
    ap.r.push({
      li: String(row[0]), hi: String(row[1]), la1: laA, lo1: loA, la2: laB, lo2: loB, e1: elev, e2: elev, l: lenFt,
      w: Number.isFinite(wM) && wM > 0 ? wM * FT_PER_M : 60, s: SOFT_SURFACES.has(surf) ? 1 : 0, lt: edge > 0 ? 1 : 0,
    })
  }
}

/** X-Plane's pavement boxes by airport: [minLat, minLon, maxLat, maxLon], only for airports more than ~1.5 km across. */
export type AirportExtents = Record<string, [number, number, number, number]>

/** Put each airport's pavement box on it (in place); malformed boxes are ignored. */
export function applyAirportExtents(airports: ReadonlyArray<Pick<AirportData, 'i'> & { x?: [number, number, number, number] }>, extents: AirportExtents): void {
  if (!extents || typeof extents !== 'object') return
  for (const ap of airports) {
    const b = extents[ap.i]
    if (Array.isArray(b) && b.length === 4 && b.every((v) => Number.isFinite(v)) && b[0] <= b[2] && b[1] <= b[3]) ap.x = [b[0], b[1], b[2], b[3]]
  }
}
