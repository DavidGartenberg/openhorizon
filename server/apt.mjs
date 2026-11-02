/**
 * X-Plane airport layouts served from the user's own install.
 *
 *   GET /api/apt/<ICAO>.json → one airport's real layout (see apt-parse.mjs), parsed on demand.
 *
 * `Global Scenery/Global Airports/Earth nav data/apt.dat` (~380 MB, every airport) is
 * indexed once — a byte-offset table keyed by ICAO, cached on disk against the file's
 * size and mtime — and only the requested airport's rows are read and parsed. Custom
 * Scenery packs' own apt.dat files are indexed after it, so a pack overrides the global
 * layout exactly as in X-Plane. Nothing is copied into the repository; when X-Plane is
 * not installed the route answers "not found" and the client keeps its OSM/procedural
 * layout.
 */
import fs from 'node:fs'
import path from 'node:path'
import { XPLANE_DIR } from './xp-static.mjs'
import { parseAptAirport } from './apt-parse.mjs'

const root = () => process.env.XPLANE_ROOT || path.resolve(XPLANE_DIR, '..', '..')

export function aptFiles(base = root()) {
  const files = []
  const global = path.join(base, 'Global Scenery', 'Global Airports', 'Earth nav data', 'apt.dat')
  if (fs.existsSync(global)) files.push(global)
  const custom = path.join(base, 'Custom Scenery')
  try {
    for (const pack of fs.readdirSync(custom)) {
      const f = path.join(custom, pack, 'Earth nav data', 'apt.dat')
      if (fs.existsSync(f)) files.push(f)
    }
  } catch { /* no Custom Scenery folder */ }
  return files
}

const NL = 0x0a
/** Byte offsets of every airport header row ("1|16|17 elev tower deprecated ICAO …") in one file. */
export function indexAptFile(file) {
  const entries = []
  const fd = fs.openSync(file, 'r')
  try {
    const size = fs.fstatSync(fd).size
    const chunk = Buffer.alloc(8 * 1024 * 1024)
    let carry = Buffer.alloc(0), pos = 0, lineStart = 0
    while (pos < size) {
      const n = fs.readSync(fd, chunk, 0, chunk.length, pos)
      if (n <= 0) break
      const buf = carry.length ? Buffer.concat([carry, chunk.subarray(0, n)]) : chunk.subarray(0, n)
      const base = pos - carry.length
      let i = 0
      for (;;) {
        const nl = buf.indexOf(NL, i)
        if (nl < 0) { carry = Buffer.from(buf.subarray(i)); break }
        const c0 = buf[i], c1 = buf[i + 1], c2 = buf[i + 2]
        // quick reject: a header starts with 1, 16 or 17 followed by a space
        if (c0 === 0x31 && (c1 === 0x20 || ((c1 === 0x36 || c1 === 0x37) && c2 === 0x20))) {
          const m = /^(1|16|17)\s+-?\d+\s+\d+\s+\d+\s+(\S+)/.exec(buf.toString('latin1', i, nl))
          if (m) entries.push({ icao: m[2], start: base + i })
        }
        i = nl + 1
      }
      lineStart = base + i
      pos += n
    }
    void lineStart
    for (let k = 0; k < entries.length; k++) entries[k].end = k + 1 < entries.length ? entries[k + 1].start : size
    return entries
  } finally { fs.closeSync(fd) }
}

let index = null // Map<ICAO, {file, start, end}>
const parsed = new Map()

function stamp(files) {
  return files.map((f) => { const s = fs.statSync(f); return `${f}:${s.size}:${Math.round(s.mtimeMs)}` }).join('|')
}

export function loadAptIndex(cacheDir, files = aptFiles()) {
  if (index) return index
  const key = stamp(files)
  const cacheFile = cacheDir ? path.join(cacheDir, 'apt-index.json') : null
  if (cacheFile && fs.existsSync(cacheFile)) {
    try {
      const j = JSON.parse(fs.readFileSync(cacheFile, 'utf8'))
      if (j.key === key) { index = new Map(j.entries); return index }
    } catch { /* rebuild */ }
  }
  const map = new Map()
  for (const file of files) for (const e of indexAptFile(file)) map.set(e.icao, { file, start: e.start, end: e.end })
  index = map
  if (cacheFile) { try { fs.writeFileSync(cacheFile, JSON.stringify({ key, entries: [...map] })) } catch { /* cache is optional */ } }
  return index
}

/** @returns the airport as a JSON string, or null when X-Plane has no such airport. */
export function aptAirport(icao, cacheDir) {
  if (!/^[A-Z0-9]{3,7}$/.test(icao)) throw new Error('bad icao')
  if (parsed.has(icao)) return parsed.get(icao)
  const entry = loadAptIndex(cacheDir).get(icao)
  if (!entry) return null
  const fd = fs.openSync(entry.file, 'r')
  let text
  try {
    const buf = Buffer.alloc(entry.end - entry.start)
    fs.readSync(fd, buf, 0, buf.length, entry.start)
    text = buf.toString('utf8')
  } finally { fs.closeSync(fd) }
  const json = JSON.stringify(parseAptAirport(text))
  if (parsed.size >= 40) parsed.delete(parsed.keys().next().value)
  parsed.set(icao, json)
  return json
}

/**
 * The runway rows ("100 …") of every airport in one apt.dat: for each runway, both end designators and the
 * blast pad / overrun length beyond each end. Streams the file like indexAptFile.
 * @returns Map<ICAO, Array<[endA, endB, overrunA, overrunB]>> (every airport, empty when it has no runways)
 */
export function scanAptRunways(file) {
  const out = new Map()
  /** Per airport: the reference (first runway end) and the box of its pavement / line nodes within 0.1° of it. */
  const ext = new Map()
  out.extents = ext
  const fd = fs.openSync(file, 'r')
  try {
    const size = fs.fstatSync(fd).size
    const chunk = Buffer.alloc(8 * 1024 * 1024)
    let carry = Buffer.alloc(0), pos = 0, icao = null
    while (pos < size) {
      const n = fs.readSync(fd, chunk, 0, chunk.length, pos)
      if (n <= 0) break
      const buf = carry.length ? Buffer.concat([carry, chunk.subarray(0, n)]) : chunk.subarray(0, n)
      let i = 0
      for (;;) {
        const nl = buf.indexOf(NL, i)
        if (nl < 0) { carry = Buffer.from(buf.subarray(i)); break }
        const c0 = buf[i], c1 = buf[i + 1], c2 = buf[i + 2]
        if (c0 === 0x31 && (c1 === 0x20 || ((c1 === 0x36 || c1 === 0x37) && c2 === 0x20))) {
          const m = /^(1|16|17)\s+-?\d+\s+\d+\s+\d+\s+(\S+)/.exec(buf.toString('latin1', i, nl))
          if (m) { icao = m[2]; out.set(icao, []); ext.delete(icao) }
        } else if (icao && c0 === 0x31 && c1 === 0x31 && c2 >= 0x31 && c2 <= 0x36 && buf[i + 3] === 0x20) {
          // A pavement / line / boundary node (111…116): lat lon are the next two fields.
          const e = ext.get(icao)
          if (e) {
            const f = buf.toString('latin1', i, Math.min(nl, i + 48)).split(/\s+/)
            const la = Number(f[1]), lo = Number(f[2])
            if (Math.abs(la - e.ref[0]) < 0.1 && Math.abs(lo - e.ref[1]) < 0.1 / Math.max(Math.cos((e.ref[0] * Math.PI) / 180), 0.2)) {
              if (la < e.box[0]) e.box[0] = la; if (lo < e.box[1]) e.box[1] = lo
              if (la > e.box[2]) e.box[2] = la; if (lo > e.box[3]) e.box[3] = lo
            }
          }
        } else if (icao && c0 === 0x31 && c1 === 0x30 && c2 === 0x30 && buf[i + 3] === 0x20) {
          const f = buf.toString('latin1', i, nl).trim().split(/\s+/)
          if (f.length >= 26) {
            const a = Math.round(Number(f[12])), b = Math.round(Number(f[21]))
            // [end A, end B, overrun beyond A (m), beyond B (m), A lat, A lon, B lat, B lon, width (m)]
            out.get(icao).push([f[8], f[17], Number.isFinite(a) ? Math.max(0, a) : 0, Number.isFinite(b) ? Math.max(0, b) : 0, Number(f[9]), Number(f[10]), Number(f[18]), Number(f[19]), Number(f[1])])
            if (!ext.has(icao)) { const la = Number(f[9]), lo = Number(f[10]); if (Number.isFinite(la) && Number.isFinite(lo)) ext.set(icao, { ref: [la, lo], box: [la, lo, la, lo] }) }
          }
        }
        i = nl + 1
      }
      pos += n
    }
    return out
  } finally { fs.closeSync(fd) }
}

let runwaysTable = null     // { ICAO: [[endA, endB, overA, overB, laA, loA, laB, loB, widthM], …] } for every airport with runways
let extentsJson = null
let extrasMemo = null

function loadRunwayTables(cacheDir, files) {
  if (runwaysTable && extentsJson) return
  const key = stamp(files)
  const cacheFile = cacheDir ? path.join(cacheDir, 'apt-runways.json') : null
  if (cacheFile && fs.existsSync(cacheFile)) {
    try {
      const j = JSON.parse(fs.readFileSync(cacheFile, 'utf8'))
      if (j.key === key && j.extents && j.runways) { runwaysTable = j.runways; extentsJson = JSON.stringify(j.extents); return }
    } catch { /* rescan */ }
  }
  const merged = new Map(), boxes = new Map()
  for (const file of files) {
    const scanned = scanAptRunways(file)
    for (const [icao, rows] of scanned) { merged.set(icao, rows); boxes.delete(icao); const e = scanned.extents.get(icao); if (e) boxes.set(icao, e.box) }
  }
  const runways = {}
  for (const [icao, rows] of merged) if (rows.length) runways[icao] = rows
  // Only airports bigger than ~1.5 km across need an extent: the client's own size rule covers the rest.
  const extents = {}
  for (const [icao, b] of boxes) {
    const dLat = (b[2] - b[0]) * 111_319.5, dLon = (b[3] - b[1]) * 111_319.5 * Math.cos((((b[0] + b[2]) / 2) * Math.PI) / 180)
    if (Math.hypot(dLat, dLon) > 1500) extents[icao] = b.map((v) => Math.round(v * 1e5) / 1e5)
  }
  if (cacheFile) { try { fs.writeFileSync(cacheFile, JSON.stringify({ key, runways, extents })) } catch { /* cache is optional */ } }
  runwaysTable = runways; extentsJson = JSON.stringify(extents)
}

const endKey = (id) => String(id).trim().toUpperCase().replace(/^0+(?=\d)/, '')
const metres = (la1, lo1, la2, lo2) => Math.hypot((lo2 - lo1) * 111_319.5 * Math.cos((la1 * Math.PI) / 180), (la2 - la1) * 111_319.5)
/** Beyond this the old database's runway is taken to be a different runway (or a database error) and is left alone. */
export const MAX_RUNWAY_FIX_M = 5000
/** A difference worth overriding the old database for: end position (m) or width (m). */
export const RUNWAY_FIX_MIN_M = 3

/**
 * The runway table the client needs: X-Plane's blast pads / overruns, and — where the old airport database
 * (`db`, [{ i, r: [{ li, hi, la1, lo1, la2, lo2, w (ft) }] }]) disagrees with X-Plane about where a runway is or how wide —
 * X-Plane's own ends and width. Rows: [endA, endB, overrunA, overrunB] or, with a correction,
 * [endA, endB, overrunA, overrunB, laA, loA, laB, loB, widthM].
 */
export function runwayExtras(runways, db) {
  const byIcao = db ? new Map(db.map((a) => [a.i, a])) : null
  const out = {}
  for (const [icao, rows] of Object.entries(runways)) {
    const ap = byIcao?.get(icao)
    const list = []
    for (const r of rows) {
      const [idA, idB, oA, oB, laA, loA, laB, loB, w] = r
      let fix = false
      const m = ap?.r.find((q) => { const a = endKey(q.li), b = endKey(q.hi); return (a === endKey(idA) && b === endKey(idB)) || (a === endKey(idB) && b === endKey(idA)) })
      if (m && [laA, loA, laB, loB].every(Number.isFinite)) {
        const forward = endKey(m.li) === endKey(idA)
        const [a1, a2] = forward ? [[laA, loA], [laB, loB]] : [[laB, loB], [laA, loA]]
        const off = Math.max(metres(m.la1, m.lo1, a1[0], a1[1]), metres(m.la2, m.lo2, a2[0], a2[1]))
        const dw = Number.isFinite(w) && w > 0 ? Math.abs(m.w * 0.3048 - w) : 0
        fix = off <= MAX_RUNWAY_FIX_M && (off > RUNWAY_FIX_MIN_M || dw > RUNWAY_FIX_MIN_M)
      }
      if (fix) list.push([idA, idB, oA, oB, laA, loA, laB, loB, Math.round(w * 10) / 10])
      else if (oA > 0 || oB > 0) list.push([idA, idB, oA, oB])
    }
    if (list.length) out[icao] = list
  }
  return out
}

/**
 * GET /api/apt-runways.json — see `runwayExtras`. Scanned once (a few seconds) and cached on disk against the
 * apt.dat files' size and mtime; Custom Scenery packs replace an airport's runways as in X-Plane.
 * @returns the JSON text, or null when X-Plane is not installed
 */
export function aptRunwayExtras(cacheDir, files = aptFiles(), db) {
  if (!files.length) return null
  loadRunwayTables(cacheDir, files)
  if (db) { if (!extrasMemo) extrasMemo = JSON.stringify(runwayExtras(runwaysTable, db)); return extrasMemo }
  return JSON.stringify(runwayExtras(runwaysTable, null))
}

/**
 * GET /api/apt-extent.json — the box [minLat, minLon, maxLat, maxLon] that holds an airport's pavement, for
 * airports more than about 1.5 km across: { "KSFO": [37.59, -122.41, 37.64, -122.35], … }. Same scan and cache.
 */
export function aptExtents(cacheDir, files = aptFiles()) {
  if (!files.length) return null
  loadRunwayTables(cacheDir, files)
  return extentsJson
}
