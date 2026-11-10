/**
 * Real building footprints from OpenStreetMap, by slippy tile, for the 3D scenery around the airplane
 * (src/world/scenery.ts). The source is OpenFreeMap's public vector tiles (OpenMapTiles schema, OpenStreetMap data):
 * one z14 tile (about 2 km on a side) per request, decoded here and cached forever on disk as compact JSON.
 * (Overpass, which serves the airport layouts, is rate-limited and was unreachable when this was written.)
 *
 * Each building is its height and base height in metres (when the data gives a real one) and its outline as
 * micro-degree offsets from the tile's south-west corner. An outline that crosses the tile's edge is cut there, so
 * neighbouring tiles each draw their own piece and the pieces meet exactly.
 *
 * The tile's roads and railways come along as centrelines with a half width, so that nothing is planted on them.
 *
 *   GET /api/osm-buildings/14/{x}/{y}.json → { v: 3, s, w, n, e, b: [{ h, m, t, p: [dLat, dLon, …] }, …], r: [{ w, p: [dLat, dLon, …] }, …] }
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

export const BUILDING_TILE_Z = 14
const cacheDir = path.join(path.dirname(fileURLToPath(import.meta.url)), 'cache', 'osm-bld')
const TILEJSON = 'https://tiles.openfreemap.org/planet'
const MEMORY_TILES = 96
/** OpenMapTiles writes this height when OSM has neither a height nor a level count. */
const UNKNOWN_HEIGHT_M = 5
/** The cached JSON's format version. */
const FORMAT = 3

/** The lat/lon box of a slippy tile. */
export function tileBounds(z, x, y) {
  const lon = (tx) => (tx / 2 ** z) * 360 - 180
  const lat = (ty) => { const n = Math.PI - (2 * Math.PI * ty) / 2 ** z; return (180 / Math.PI) * Math.atan(0.5 * (Math.exp(n) - Math.exp(-n))) }
  return { s: lat(y + 1), w: lon(x), n: lat(y), e: lon(x + 1) }
}

// ---------------------------------------------------------------- vector tile --

/** A minimal protocol-buffer reader: just what a Mapbox vector tile needs. */
class Pbf {
  constructor(buf, pos = 0, end = buf.length) { this.buf = buf; this.pos = pos; this.end = end }
  varint() {
    let result = 0, scale = 1, byte
    do {
      if (this.pos >= this.end) throw new Error('vector tile: truncated varint')
      byte = this.buf[this.pos++]
      result += (byte & 0x7f) * scale
      scale *= 128
    } while (byte >= 0x80)
    return result
  }
  /** Calls `field(tag, wireType)` for each field; a field the callback leaves unread is skipped. */
  fields(field) {
    while (this.pos < this.end) {
      const key = this.varint(), tag = Math.floor(key / 8), wire = key % 8
      const before = this.pos
      field(tag, wire)
      if (this.pos === before) this.skip(wire)
    }
  }
  skip(wire) {
    if (wire === 0) this.varint()
    else if (wire === 1) this.pos += 8
    else if (wire === 2) this.pos += this.varint()
    else if (wire === 5) this.pos += 4
    else throw new Error(`vector tile: wire type ${wire}`)
  }
  sub() { const len = this.varint(), start = this.pos; this.pos += len; return new Pbf(this.buf, start, start + len) }
  string() { const s = this.sub(); return Buffer.from(this.buf.buffer, this.buf.byteOffset + s.pos, s.end - s.pos).toString('utf8') }
  packed() { const s = this.sub(), out = []; while (s.pos < s.end) out.push(s.varint()); return out }
}

const zigzag = (n) => (n % 2 === 0 ? n / 2 : -(n + 1) / 2)

function readValue(pbf) {
  let value = null
  const view = new DataView(pbf.buf.buffer, pbf.buf.byteOffset)
  pbf.fields((tag, wire) => {
    if (tag === 1 && wire === 2) value = pbf.string()
    else if (tag === 2 && wire === 5) { value = view.getFloat32(pbf.pos, true); pbf.pos += 4 }
    else if (tag === 3 && wire === 1) { value = view.getFloat64(pbf.pos, true); pbf.pos += 8 }
    else if ((tag === 4 || tag === 5) && wire === 0) value = pbf.varint()
    else if (tag === 6 && wire === 0) value = zigzag(pbf.varint())
    else if (tag === 7 && wire === 0) value = pbf.varint() !== 0
  })
  return value
}

/** A feature's geometry commands → rings of [x, y] in tile units (MoveTo starts a ring; ClosePath ends it). */
function readRings(commands) {
  const rings = []
  let ring = null, x = 0, y = 0, i = 0
  while (i < commands.length) {
    const cmd = commands[i] & 7, count = commands[i] >>> 3
    i++
    if (cmd === 1 || cmd === 2) {
      for (let k = 0; k < count && i + 1 < commands.length; k++) {
        x += zigzag(commands[i]); y += zigzag(commands[i + 1]); i += 2
        if (cmd === 1) { ring = []; rings.push(ring) }
        ring?.push([x, y])
      }
    } else if (cmd === 7) ring = null
    else break
  }
  return rings
}

/** One named layer of a vector tile: { extent, features: [{ type, properties, rings }] }, or null when the tile has no such layer. */
export function decodeVectorLayer(bytes, layerName) {
  const buf = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes)
  const tile = new Pbf(buf)
  let found = null
  tile.fields((tag, wire) => {
    if (tag !== 3 || wire !== 2) return
    const layer = tile.sub()
    if (found) return
    let name = '', extent = 4096
    const keys = [], values = [], raw = []
    layer.fields((t, w) => {
      if (t === 1 && w === 2) name = layer.string()
      else if (t === 2 && w === 2) raw.push(layer.sub())
      else if (t === 3 && w === 2) keys.push(layer.string())
      else if (t === 4 && w === 2) values.push(readValue(layer.sub()))
      else if (t === 5 && w === 0) extent = layer.varint()
    })
    if (name !== layerName) return
    const features = raw.map((f) => {
      let type = 0, tags = [], geometry = []
      f.fields((t, w) => {
        if (t === 2 && w === 2) tags = f.packed()
        else if (t === 3 && w === 0) type = f.varint()
        else if (t === 4 && w === 2) geometry = f.packed()
      })
      const properties = {}
      for (let k = 0; k + 1 < tags.length; k += 2) properties[keys[tags[k]]] = values[tags[k + 1]]
      return { type, properties, rings: readRings(geometry) }
    })
    found = { extent, features }
  })
  return found
}

// ------------------------------------------------------------------ buildings --

/** Twice the signed area of a ring in tile units (y down): positive for an outer ring, negative for a hole. */
const ringArea2 = (ring) => { let a = 0; for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) a += (ring[j][0] - ring[i][0]) * (ring[i][1] + ring[j][1]); return a }

/** Cut a ring to the tile's own square (Sutherland–Hodgman). `cut` reports whether anything was cut away. */
export function clipRingToTile(ring, extent) {
  let pts = ring, cut = false
  const edges = [
    [(p) => p[0] >= 0, (a, b) => [0, a[1] + ((b[1] - a[1]) * (0 - a[0])) / (b[0] - a[0])]],
    [(p) => p[0] <= extent, (a, b) => [extent, a[1] + ((b[1] - a[1]) * (extent - a[0])) / (b[0] - a[0])]],
    [(p) => p[1] >= 0, (a, b) => [a[0] + ((b[0] - a[0]) * (0 - a[1])) / (b[1] - a[1]), 0]],
    [(p) => p[1] <= extent, (a, b) => [a[0] + ((b[0] - a[0]) * (extent - a[1])) / (b[1] - a[1]), extent]],
  ]
  for (const [inside, cross] of edges) {
    const out = []
    for (let i = 0; i < pts.length; i++) {
      const a = pts[i], b = pts[(i + 1) % pts.length]
      const ia = inside(a), ib = inside(b)
      if (ia) out.push(a)
      if (ia !== ib) { out.push(cross(a, b)); cut = true }
    }
    pts = out
    if (pts.length < 3) return { ring: [], cut: true }
  }
  return { ring: pts, cut }
}

/**
 * The `building` layer of a vector tile → the tile's buildings. Outer rings only (courtyards are roofed over);
 * a building whose outline OSM replaces with separately mapped parts (`hide_3d`) is left to its parts.
 */
export function buildingsFromLayer(layer, bounds, z, y) {
  const out = []
  if (!layer) return out
  const { extent } = layer
  const latAt = (ty) => { const n = Math.PI - (2 * Math.PI * (y + ty / extent)) / 2 ** z; return (180 / Math.PI) * Math.atan(0.5 * (Math.exp(n) - Math.exp(-n))) }
  for (const f of layer.features) {
    if (f.type !== 3 || f.properties.hide_3d === true) continue
    const height = Number(f.properties.render_height), base = Number(f.properties.render_min_height)
    for (const full of f.rings) {
      if (full.length < 3 || full.length > 600 || ringArea2(full) <= 0) continue
      // A ring repeats no closing point in a vector tile, but a clipped one can carry doubled points.
      const { ring, cut } = clipRingToTile(full, extent)
      if (ring.length < 3) continue
      const p = []
      let last = null
      for (const [tx, ty] of ring) {
        const dLat = Math.round((latAt(ty) - bounds.s) * 1e6), dLon = Math.round(((tx / extent) * (bounds.e - bounds.w)) * 1e6)
        if (last && last[0] === dLat && last[1] === dLon) continue
        p.push(dLat, dLon); last = [dLat, dLon]
      }
      if (p.length >= 4 && p[0] === p[p.length - 2] && p[1] === p[p.length - 1]) p.length -= 2
      if (p.length < 6) continue
      out.push({
        h: Number.isFinite(height) && height > 0 && height !== UNKNOWN_HEIGHT_M ? Math.min(Math.round(height * 10) / 10, 500) : null,
        m: Number.isFinite(base) && base > 0 ? Math.round(base * 10) / 10 : 0,
        t: cut ? 1 : 0,
        p,
      })
    }
  }
  return out
}

/** Half width, metres, of the ground a road or railway of each class takes (OpenMapTiles `transportation` classes). Paths are left out. */
const ROAD_HALF_WIDTH_M = { motorway: 12, trunk: 10, primary: 8.5, secondary: 7.5, tertiary: 6.5, minor: 5.5, service: 3.5, track: 2.5, raceway: 5, busway: 4, rail: 4, transit: 4 }

/** The `transportation` layer → centrelines with half widths, in the same micro-degree offsets as the buildings (they may run a little outside the tile). */
export function roadsFromLayer(layer, bounds, z, y) {
  const out = []
  if (!layer) return out
  const { extent } = layer
  const latAt = (ty) => { const n = Math.PI - (2 * Math.PI * (y + ty / extent)) / 2 ** z; return (180 / Math.PI) * Math.atan(0.5 * (Math.exp(n) - Math.exp(-n))) }
  for (const f of layer.features) {
    const w = ROAD_HALF_WIDTH_M[f.properties.class]
    if (f.type !== 2 || !w || f.properties.brunnel === 'tunnel') continue
    for (const line of f.rings) {
      if (line.length < 2) continue
      const p = []
      for (const [tx, ty] of line) p.push(Math.round((latAt(ty) - bounds.s) * 1e6), Math.round(((tx / extent) * (bounds.e - bounds.w)) * 1e6))
      out.push({ w, p })
    }
  }
  return out
}

// ------------------------------------------------------------------- fetching --

const memory = new Map()
const pending = new Map()
let template = null
let templateAt = 0

const remember = (key, json) => {
  memory.delete(key); memory.set(key, json)
  if (memory.size > MEMORY_TILES) memory.delete(memory.keys().next().value)
}

/** The tile URL template of the current planet build (it carries a version, so it is asked for and kept for a few hours). */
async function tileTemplate() {
  if (template && Date.now() - templateAt < 6 * 3600_000) return template
  try {
    const res = await fetch(TILEJSON, { signal: AbortSignal.timeout(15_000) })
    if (!res.ok) throw new Error(`tilejson ${res.status}`)
    const url = (await res.json())?.tiles?.[0]
    if (typeof url !== 'string' || !url.includes('{z}')) throw new Error('tilejson: no tile url')
    template = url; templateAt = Date.now()
  } catch (e) { if (!template) throw e }
  return template
}

async function fetchTile(z, x, y) {
  const url = (await tileTemplate()).replace('{z}', z).replace('{x}', x).replace('{y}', y)
  const res = await fetch(url, { signal: AbortSignal.timeout(30_000) })
  const b = tileBounds(z, x, y)
  const head = { v: FORMAT, s: +b.s.toFixed(6), w: +b.w.toFixed(6), n: +b.n.toFixed(6), e: +b.e.toFixed(6) }
  // No tile at all (open ocean) is an answer too: nothing is built there.
  if (res.status === 404 || res.status === 204) return JSON.stringify({ ...head, b: [], r: [] })
  if (!res.ok) throw new Error(`building tile ${z}/${x}/${y}: ${res.status}`)
  const bytes = new Uint8Array(await res.arrayBuffer())
  return JSON.stringify({ ...head, b: buildingsFromLayer(decodeVectorLayer(bytes, 'building'), b, z, y), r: roadsFromLayer(decodeVectorLayer(bytes, 'transportation'), b, z, y) })
}

/** The tile's buildings as a JSON string: memory, then disk, then the tile server. Throws when that cannot answer. */
export async function buildingTile(z, x, y) {
  z = Number(z); x = Number(x); y = Number(y)
  if (z !== BUILDING_TILE_Z || !Number.isInteger(x) || !Number.isInteger(y) || x < 0 || y < 0 || x >= 2 ** z || y >= 2 ** z) throw new Error('bad building tile')
  const key = `${z}-${x}-${y}`
  const hit = memory.get(key)
  if (hit) return hit
  const file = path.join(cacheDir, `${key}.json`)
  // A tile cached in an older format (before roads) is fetched once more.
  try { const json = await fs.promises.readFile(file, 'utf8'); if (json.startsWith(`{"v":${FORMAT},`)) { remember(key, json); return json } } catch { /* not cached yet */ }
  let job = pending.get(key)
  if (!job) {
    job = fetchTile(z, x, y).then(async (json) => {
      await fs.promises.mkdir(cacheDir, { recursive: true })
      await fs.promises.writeFile(file, json)
      remember(key, json)
      return json
    }).finally(() => pending.delete(key))
    pending.set(key, job)
  }
  return job
}
