/**
 * In-airspace detection (Phase 4 Task 5, §6.5): pure point-in-polygon +
 * altitude-range check against the compacted FAA airspace dataset produced
 * by `server/parse.mjs#buildUsAirspace`. Pure module — no three.js/DOM
 * (§4.1); mirrors `navaids.ts`/`gps.ts`'s "caller fetches `/api/*.json` and
 * hands the parsed array to this module" pattern rather than fetching data
 * itself.
 */
import type { LatLon } from '../../math/geo'

/** Airspace kind codes — must match `server/parse.mjs`'s
 *  `CLASS_LOCAL_TYPE_KIND`/`SUA_TYPE_KIND`/`AIRSPACE_KIND_NAMES` exactly. */
export const enum AirspaceKind {
  ClassB = 0,
  ClassC = 1,
  ClassD = 2,
  ClassESfc = 3,
  Restricted = 4,
  Prohibited = 5,
  Moa = 6,
  Alert = 7,
  Warning = 8,
  Danger = 9,
}

/** Sentinel ceiling value for "unlimited" airspace — matches
 *  `server/parse.mjs`'s `CEILING_UNLIMITED_FT`. Duplicated here (rather
 *  than imported) since `.mjs` server modules aren't imported by `/sim`
 *  (§4.1 purity — see `tests/sim-purity.test.ts`). */
export const CEILING_UNLIMITED_FT = 99999

/** A `[lon, lat]` ring point, matching `buildUsAirspace`'s compact output. */
export type RingPoint = readonly [number, number]

/** One compacted airspace polygon, matching `buildUsAirspace`'s per-record
 *  shape. `r` is one or more rings; ring 0 is the exterior boundary, any
 *  further rings are holes cut out of it (no holes were observed in the
 *  real FAA data sampled for this task, but the shape supports them). */
export interface AirspacePolygon {
  /** Display name, e.g. "SAN FRANCISCO CLASS B". */
  n: string
  k: AirspaceKind
  /** Floor, feet MSL. */
  fl: number
  /** Ceiling, feet MSL (or `CEILING_UNLIMITED_FT`). */
  ce: number
  /** ICAO airport ident (Class Airspace only, when present). */
  i?: string
  /** Shelf/sector label, e.g. "AREA A" (multi-shelf Class B/C). */
  se?: string
  r: readonly (readonly RingPoint[])[]
}

/**
 * Even-odd (ray-casting) point-in-polygon test against a single ring — the
 * standard, well-known algorithm: cast a ray from the point toward +x and
 * count how many ring edges it crosses; an odd count means the point is
 * inside. Treats `lon` as x and `lat` as y, a plain 2D test in degree-space
 * (adequate at the scale of individual airspace boundaries — real airspace
 * polygons span at most a few hundred nm, far from the pole/antimeridian
 * distortion that plain equirectangular math would introduce at a global
 * scale).
 *
 * Edge case: a point that falls exactly on a ring edge or vertex can
 * resolve to either `true` or `false` depending on which edge it aligns
 * with — this is a well-known, harmless property of the even-odd rule
 * (not a bug), so this module's tests treat exact-boundary points as
 * "allowed either way" rather than asserting one specific answer.
 */
function pointInRing(lon: number, lat: number, ring: readonly RingPoint[]): boolean {
  let inside = false
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i]!
    const [xj, yj] = ring[j]!
    const crosses = yi > lat !== yj > lat && lon < ((xj - xi) * (lat - yi)) / (yj - yi) + xi
    if (crosses) inside = !inside
  }
  return inside
}

/** Point-in-polygon against a full ring set: inside the exterior (ring 0)
 *  and not inside any hole (rings 1+). */
export function pointInPolygonRings(lon: number, lat: number, rings: readonly (readonly RingPoint[])[]): boolean {
  if (rings.length === 0 || rings[0]!.length < 3) return false
  if (!pointInRing(lon, lat, rings[0]!)) return false
  for (let h = 1; h < rings.length; h++) {
    if (pointInRing(lon, lat, rings[h]!)) return false // inside a hole cut from the exterior
  }
  return true
}

/** Is `altFtMsl` within a polygon's [floor, ceiling], inclusive of both
 *  bounds (matches how a real CDI/MFD "in airspace" indication treats the
 *  boundary altitudes themselves as inside). */
export function altitudeInRange(altFtMsl: number, floorFt: number, ceilingFt: number): boolean {
  return altFtMsl >= floorFt && altFtMsl <= ceilingFt
}

/**
 * Which airspace polygon(s) contain the given lat/lon + altitude. A real
 * aircraft position can be inside multiple overlapping shelves/classes at
 * once (e.g. a Class B shelf directly above a Class D surface area, or an
 * MOA overlapping a Class E surface area) — this returns every match, not
 * just the first or a "highest priority" one; picking a single
 * headline-display airspace (if ever needed) is left to the caller. Pure,
 * no three.js/DOM.
 */
export function airspacesContaining(
  point: LatLon,
  altFtMsl: number,
  polygons: readonly AirspacePolygon[],
): AirspacePolygon[] {
  const out: AirspacePolygon[] = []
  for (const poly of polygons) {
    if (!altitudeInRange(altFtMsl, poly.fl, poly.ce)) continue
    if (pointInPolygonRings(point.lon, point.lat, poly.r)) out.push(poly)
  }
  return out
}
