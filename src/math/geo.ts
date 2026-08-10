/**
 * Geodesy for the streamed world (§4.3): WGS84 ↔ local ENU meters around a
 * movable anchor, web-mercator tile math, terrarium decoding, curvature.
 * Pure module.
 */

export const EARTH_R = 6_371_000 // mean radius, m (curvature drop)
const WGS84_A = 6_378_137

export interface LatLon {
  lat: number
  lon: number
}

/** Meters per degree at a latitude (spherical, plenty for ENU frames). */
export function metersPerDegree(latDeg: number): { north: number; east: number } {
  const north = (Math.PI / 180) * WGS84_A
  return { north, east: north * Math.cos((latDeg * Math.PI) / 180) }
}

/** Lat/lon → NED meters relative to an anchor (local flat frame). */
/** Wrap a longitude difference into [-180, 180] (17a: the flat local
 *  frame must survive a dateline crossing — one unwrapped frame threw
 *  the floating origin ~40,000 km). */
function wrapDLon(d: number): number {
  return d > 180 ? d - 360 : d < -180 ? d + 360 : d
}

export function toNedMeters(lat: number, lon: number, anchor: LatLon): { north: number; east: number } {
  const m = metersPerDegree(anchor.lat)
  return { north: (lat - anchor.lat) * m.north, east: wrapDLon(lon - anchor.lon) * m.east }
}

/** NED meters relative to anchor → lat/lon (longitude normalized to ±180). */
export function fromNedMeters(northM: number, eastM: number, anchor: LatLon): LatLon {
  const m = metersPerDegree(anchor.lat)
  let lon = anchor.lon + eastM / m.east
  if (lon > 180) lon -= 360
  else if (lon < -180) lon += 360
  return { lat: anchor.lat + northM / m.north, lon }
}

// ---- slippy tiles ----

export function lonToTileX(lon: number, z: number): number {
  return ((lon + 180) / 360) * 2 ** z
}

export function latToTileY(lat: number, z: number): number {
  const r = (lat * Math.PI) / 180
  return ((1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2) * 2 ** z
}

export function tileXToLon(x: number, z: number): number {
  return (x / 2 ** z) * 360 - 180
}

export function tileYToLat(y: number, z: number): number {
  const n = Math.PI - (2 * Math.PI * y) / 2 ** z
  return (180 / Math.PI) * Math.atan(0.5 * (Math.exp(n) - Math.exp(-n)))
}

/** Approx tile edge length in meters at a lat/zoom. */
export function tileSizeMeters(lat: number, z: number): number {
  return (Math.cos((lat * Math.PI) / 180) * 2 * Math.PI * WGS84_A) / 2 ** z
}

/** Terrain-grid vertex → imagery-tile UV (13b). Grid row j=0 is the tile's
 *  north edge; textures load with three's default flipY, so v=1 = image
 *  top = north. Height rows are sampled uniformly in tile-pixel
 *  (mercator-y) space and web-map imagery is mercator too, so the linear
 *  map aligns imagery with the heightfield pixel-for-pixel. */
export function tileGridUv(i: number, j: number, gridSize: number): [number, number] {
  return [i / (gridSize - 1), 1 - j / (gridSize - 1)]
}

/** Terrarium RGB → elevation meters. */
export function terrariumDecode(r: number, g: number, b: number): number {
  return r * 256 + g + b / 256 - 32768
}

/** Curvature drop below the tangent plane at distance d (d²/2R). */
export function curvatureDrop(distM: number): number {
  return (distM * distM) / (2 * EARTH_R)
}

/** Bilinear sample of a row-major heightfield grid. */
export function sampleGrid(
  heights: Float32Array,
  gridSize: number,
  fx: number, // 0..1 across the grid
  fy: number,
): number {
  const x = Math.min(Math.max(fx, 0), 1) * (gridSize - 1)
  const y = Math.min(Math.max(fy, 0), 1) * (gridSize - 1)
  const x0 = Math.floor(x)
  const y0 = Math.floor(y)
  const x1 = Math.min(x0 + 1, gridSize - 1)
  const y1 = Math.min(y0 + 1, gridSize - 1)
  const tx = x - x0
  const ty = y - y0
  const h00 = heights[y0 * gridSize + x0]!
  const h10 = heights[y0 * gridSize + x1]!
  const h01 = heights[y1 * gridSize + x0]!
  const h11 = heights[y1 * gridSize + x1]!
  return (h00 * (1 - tx) + h10 * tx) * (1 - ty) + (h01 * (1 - tx) + h11 * tx) * ty
}

/** Great-circle distance (m). */
export function distanceM(a: LatLon, b: LatLon): number {
  const rad = Math.PI / 180
  const dLat = (b.lat - a.lat) * rad
  const dLon = (b.lon - a.lon) * rad
  const s =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin(dLon / 2) ** 2
  return 2 * EARTH_R * Math.asin(Math.sqrt(s))
}

/**
 * Direction wind is blowing FROM (deg true) given its NED (x=north, y=east)
 * velocity vector — the "wind box" convention pilots expect (matches how
 * METARs report wind direction). This is the inverse of
 * `WindModel.setSteady`, which builds the NED vector from a "from" direction
 * by rotating it 180° to the "blowing toward" direction before projecting.
 * A vector that points due south (blowing toward the south, i.e. a wind
 * FROM the north) returns 0/360, not 180.
 */
export function windDirFromNed(windNed: { x: number; y: number }): number {
  return ((Math.atan2(windNed.y, windNed.x) * 180) / Math.PI + 180 + 360) % 360
}

/** Initial bearing a→b, degrees true. */
export function bearingDeg(a: LatLon, b: LatLon): number {
  const rad = Math.PI / 180
  const y = Math.sin((b.lon - a.lon) * rad) * Math.cos(b.lat * rad)
  const x =
    Math.cos(a.lat * rad) * Math.sin(b.lat * rad) -
    Math.sin(a.lat * rad) * Math.cos(b.lat * rad) * Math.cos((b.lon - a.lon) * rad)
  return (Math.atan2(y, x) / rad + 360) % 360
}

/**
 * Runway flattening: blend a terrain height toward the runway plane when
 * within the runway footprint + apron margin. Returns blended height.
 */
export function flattenForRunway(
  terrainH: number,
  px: number, // sample position, meters in any local frame
  py: number,
  ax: number, // runway end A
  ay: number,
  bx: number, // runway end B
  by: number,
  ha: number, // elevation at A (m)
  hb: number,
  halfWidthM: number,
): number {
  const dx = bx - ax
  const dy = by - ay
  const len2 = dx * dx + dy * dy || 1
  let t = ((px - ax) * dx + (py - ay) * dy) / len2
  t = Math.min(Math.max(t, 0), 1)
  const cx = ax + t * dx
  const cy = ay + t * dy
  const dist = Math.hypot(px - cx, py - cy)
  const inner = halfWidthM + 40 // fully flat zone
  const outer = inner + 120 // blend-out zone
  if (dist >= outer) return terrainH
  const planeH = ha + t * (hb - ha)
  if (dist <= inner) return planeH
  const w = (dist - inner) / (outer - inner)
  const s = w * w * (3 - 2 * w)
  return planeH * (1 - s) + terrainH * s
}
