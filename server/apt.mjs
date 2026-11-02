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
  /** Per airport: its name and elevation (feet) from the header row. */
  const meta = new Map()
  out.meta = meta
  /** Per airport: its helipads (row 102) as [lat, lon, heading, length m, width m, surface]. */
  const pads = new Map()
  out.pads = pads
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
          if (m) { icao = m[2]; out.set(icao, []); ext.delete(icao); const h = /^(?:1|16|17)\s+(-?\d+)\s+\d+\s+\d+\s+\S+\s*(.*)$/.exec(buf.toString('latin1', i, nl)); meta.set(icao, { name: (h?.[2] ?? '').trim().slice(0, 60), elevFt: Number(h?.[1] ?? 0) || 0, code: Number(buf.toString('latin1', i, i + 2)) }) }
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
        } else if (icao && c0 === 0x31 && c1 === 0x30 && c2 === 0x32 && buf[i + 3] === 0x20) {
          const f = buf.toString('latin1', i, nl).trim().split(/\s+/)
          const row = [f[1], Number(f[2]), Number(f[3]), Number(f[4]), Number(f[5]), Number(f[6]), Number(f[7])]
          if (f.length >= 8 && row.slice(1).every(Number.isFinite)) { const list = pads.get(icao) ?? []; list.push(row); pads.set(icao, list) }
        } else if (icao && c0 === 0x31 && c1 === 0x30 && c2 === 0x30 && buf[i + 3] === 0x20) {
          const f = buf.toString('latin1', i, nl).trim().split(/\s+/)
          if (f.length >= 26) {
            const a = Math.round(Number(f[12])), b = Math.round(Number(f[21]))
            // [end A, end B, overrun beyond A (m), beyond B (m), A lat, A lon, B lat, B lon, width (m), surface code, edge lights]
            out.get(icao).push([f[8], f[17], Number.isFinite(a) ? Math.max(0, a) : 0, Number.isFinite(b) ? Math.max(0, b) : 0, Number(f[9]), Number(f[10]), Number(f[18]), Number(f[19]), Number(f[1]), Number(f[2]), Number(f[6])])
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

let padsTable = null       // { ICAO: [[designator, lat, lon, heading, length m, width m, surface], …] } for airports with helipads and no runway
let metaTable = null
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
      if (j.key === key && j.extents && j.runways && j.meta && j.pads) { runwaysTable = j.runways; metaTable = j.meta; padsTable = j.pads; extentsJson = JSON.stringify(j.extents); return }
    } catch { /* rescan */ }
  }
  const merged = new Map(), boxes = new Map(), metas = new Map(), padRows = new Map()
  for (const file of files) {
    const scanned = scanAptRunways(file)
    for (const [icao, rows] of scanned) { merged.set(icao, rows); boxes.delete(icao); const e = scanned.extents.get(icao); if (e) boxes.set(icao, e.box); metas.set(icao, scanned.meta.get(icao)); padRows.delete(icao); const p = scanned.pads.get(icao); if (p) padRows.set(icao, p) }
  }
  const runways = {}, meta = {}
  for (const [icao, rows] of merged) if (rows.length) { runways[icao] = rows; meta[icao] = metas.get(icao) ?? { name: '', elevFt: 0, code: 1 } }
  const pads = {}
  for (const [icao, rows] of merged) if (!rows.length && padRows.get(icao)?.length) { pads[icao] = padRows.get(icao); meta[icao] = metas.get(icao) ?? { name: '', elevFt: 0, code: 17 } }
  // Only airports bigger than ~1.5 km across need an extent: the client's own size rule covers the rest.
  const extents = {}
  for (const [icao, b] of boxes) {
    const dLat = (b[2] - b[0]) * 111_319.5, dLon = (b[3] - b[1]) * 111_319.5 * Math.cos((((b[0] + b[2]) / 2) * Math.PI) / 180)
    if (Math.hypot(dLat, dLon) > 1500) extents[icao] = b.map((v) => Math.round(v * 1e5) / 1e5)
  }
  if (cacheFile) { try { fs.writeFileSync(cacheFile, JSON.stringify({ key, runways, meta, pads, extents })) } catch { /* cache is optional */ } }
  runwaysTable = runways; metaTable = meta; padsTable = pads; extentsJson = JSON.stringify(extents)
}

const endKey = (id) => String(id).trim().toUpperCase().replace(/^0+(?=\d)/, '')
const metres = (la1, lo1, la2, lo2) => Math.hypot((lo2 - lo1) * 111_319.5 * Math.cos((la1 * Math.PI) / 180), (la2 - la1) * 111_319.5)
/** Beyond this the old database's runway is taken to be a different runway (or a database error) and is left alone. */
export const MAX_RUNWAY_FIX_M = 5000
/** A difference worth overriding the old database for: end position (m) or width (m). */
export const RUNWAY_FIX_MIN_M = 3

/** Shortest runway (m) X-Plane has to list, and how far (m) / how many degrees off a database runway may be before it is a different runway. */
const MISSING_RUNWAY_MIN_M = 200, SAME_RUNWAY_CENTRE_M = 250, SAME_RUNWAY_HEADING_DEG = 25

/** True when an X-Plane runway (scan row) at a database airport is on no database runway — not just numbered differently. */
function isMissingRunway(ap, row) {
  const [, , , , laA, loA, laB, loB] = row
  if (![laA, loA, laB, loB].every(Number.isFinite) || metres(laA, loA, laB, loB) < MISSING_RUNWAY_MIN_M) return false
  const cLa = (laA + laB) / 2, cLo = (loA + loB) / 2
  const hdg = Math.atan2((loB - loA) * Math.cos((cLa * Math.PI) / 180), laB - laA)
  return !ap.r.some((q) => {
    if (metres(cLa, cLo, (q.la1 + q.la2) / 2, (q.lo1 + q.lo2) / 2) > SAME_RUNWAY_CENTRE_M) return false
    const qh = Math.atan2((q.lo2 - q.lo1) * Math.cos((cLa * Math.PI) / 180), q.la2 - q.la1)
    const d = Math.abs(((hdg - qh) * 180) / Math.PI) % 180
    return Math.min(d, 180 - d) <= SAME_RUNWAY_HEADING_DEG
  })
}

/** How far (m) from every X-Plane runway a database runway with no matching designator may lie before X-Plane is taken to disprove it. */
const UNCONFIRMED_RUNWAY_M = 1500

/**
 * Database runways X-Plane does not confirm: none of X-Plane's runways at the airport has the same designators or lies
 * within `UNCONFIRMED_RUNWAY_M` of it (a wrong position, a duplicate or a renumbered copy of a runway X-Plane has right).
 * At least one runway of the airport is always kept.
 */
function unconfirmedRunways(ap, rows) {
  if (!rows.length || ap.r.length < 2) return []
  const out = ap.r.filter((q) => {
    if (![q.la1, q.lo1, q.la2, q.lo2].every(Number.isFinite)) return false
    const a = endKey(q.li), b = endKey(q.hi)
    if (rows.some((r) => (endKey(r[0]) === a && endKey(r[1]) === b) || (endKey(r[0]) === b && endKey(r[1]) === a))) return false
    const cLa = (q.la1 + q.la2) / 2, cLo = (q.lo1 + q.lo2) / 2
    return !rows.some((r) => [r[4], r[5], r[6], r[7]].every(Number.isFinite) && metres(cLa, cLo, (r[4] + r[6]) / 2, (r[5] + r[7]) / 2) < UNCONFIRMED_RUNWAY_M)
  })
  return out.length < ap.r.length ? out : []
}

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
      let fix = false, finish = false
      const m = ap?.r.find((q) => { const a = endKey(q.li), b = endKey(q.hi); return (a === endKey(idA) && b === endKey(idB)) || (a === endKey(idB) && b === endKey(idA)) })
      if (m && [laA, loA, laB, loB].every(Number.isFinite)) {
        const forward = endKey(m.li) === endKey(idA)
        const [a1, a2] = forward ? [[laA, loA], [laB, loB]] : [[laB, loB], [laA, loA]]
        const off = Math.max(metres(m.la1, m.lo1, a1[0], a1[1]), metres(m.la2, m.lo2, a2[0], a2[1]))
        const dw = Number.isFinite(w) && w > 0 ? Math.abs(m.w * 0.3048 - w) : 0
        fix = off <= MAX_RUNWAY_FIX_M && (off > RUNWAY_FIX_MIN_M || dw > RUNWAY_FIX_MIN_M)
        // Where X-Plane disagrees about hard / soft or about edge lights, it is the newer record.
        finish = (SOFT_SURFACES.has(Number(r[9])) ? 1 : 0) !== m.s || (Number(r[10]) > 0 ? 1 : 0) !== m.lt
        if (finish && !fix) fix = ap.r.length > 0 && off <= MAX_RUNWAY_FIX_M            // carry its ends with the finish
      }
      const flags = [SOFT_SURFACES.has(Number(r[9])) ? 1 : 0, Number(r[10]) > 0 ? 1 : 0]
      if (fix && finish) list.push([idA, idB, oA, oB, laA, loA, laB, loB, Math.round(w * 10) / 10, ...flags])
      else if (fix) list.push([idA, idB, oA, oB, laA, loA, laB, loB, Math.round(w * 10) / 10])
      else if (!m && ap && isMissingRunway(ap, r)) list.push([idA, idB, oA, oB, laA, loA, laB, loB, Math.round((Number(w) || 0) * 10) / 10, ...flags])
      else if (oA > 0 || oB > 0) list.push([idA, idB, oA, oB])
    }
    if (ap) for (const q of unconfirmedRunways(ap, rows)) list.push([q.li, q.hi, -1, -1])
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

const FT_PER_M = 1 / 0.3048
/** apt.dat surface codes that are not hard pavement: turf, dirt, gravel, dry lakebed, snow / ice. */
const SOFT_SURFACES = new Set([3, 4, 5, 12, 14])

/**
 * Airports X-Plane has that the old database does not (22,000 of them, mostly small fields), in the database's own
 * shape so the client can treat them alike: { i, n, la, lo, e (ft), t: 0, xo: true, r: [{ li, hi, la1, lo1, la2, lo2,
 * e1, e2 (ft), l, w (ft), s (1 = not hard), lt }] }. Land airports with a runway at least 200 m long.
 */
/** Helipads on platforms, rigs and ships stand over the sea: not drawn. */
const OFFSHORE_NAME = /\b(platform|rig|fpso|fso|ship|vessel|drill\w*|offshore|jack-?up|semi-?sub\w*|barge|tlp|spar|plattform|plataforma|pl\.)\b/i

export function aptOnlyAirports(runways, meta, db, pads = {}) {
  const have = new Set(db.map((a) => a.i))
  const out = []
  for (const [icao, rows] of Object.entries(runways)) {
    if (have.has(icao)) continue
    const m = meta[icao]
    if (m && m.code !== 1) continue                                   // not a land airport (16 seaplane base, 17 heliport)
    const r = []
    let sla = 0, slo = 0, n = 0
    for (const row of rows) {
      const [idA, idB, , , la1, lo1, la2, lo2, w, surf, edge] = row
      if (![la1, lo1, la2, lo2].every(Number.isFinite) || Math.abs(la1) > 90 || Math.abs(la2) > 90 || Math.abs(lo1) > 180 || Math.abs(lo2) > 180) continue
      const lenM = metres(la1, lo1, la2, lo2)
      if (lenM < 200) continue
      const e = m?.elevFt ?? 0
      r.push({ li: String(idA), hi: String(idB), la1: +la1.toFixed(6), lo1: +lo1.toFixed(6), la2: +la2.toFixed(6), lo2: +lo2.toFixed(6), e1: e, e2: e, l: Math.round(lenM * FT_PER_M), w: Math.round(Math.max(Number(w) || 0, 6) * FT_PER_M), s: SOFT_SURFACES.has(surf) ? 1 : 0, lt: edge > 0 ? 1 : 0 })
      sla += (la1 + la2) / 2; slo += (lo1 + lo2) / 2; n++
    }
    if (!n) continue
    out.push({ i: icao, n: m?.name || icao, la: +(sla / n).toFixed(5), lo: +(slo / n).toFixed(5), e: m?.elevFt ?? 0, t: 0, xo: true, r })
  }
  // Heliports: airports with helipads and no runway. Each pad is a short "runway" flagged `pad`, which the client leaves undrawn
  // (X-Plane's layout paints the pad and its H) but levels the ground under.
  for (const [icao, rows] of Object.entries(pads)) {
    if (have.has(icao) || runways[icao]) continue
    const m = meta[icao]
    if (OFFSHORE_NAME.test(m?.name ?? '')) continue                    // a rig or a ship: its deck is not on the ground
    const r = []
    let sla = 0, slo = 0
    for (const [id, la, lo, hdg, len, wid, surf] of rows) {
      if (Math.abs(la) > 90 || Math.abs(lo) > 180 || !(len >= 3 && len <= 200 && wid >= 3 && wid <= 200)) continue
      const h = (hdg * Math.PI) / 180, mLat = 111_319.5, mLon = mLat * Math.cos((la * Math.PI) / 180)
      if (!(mLon > 1)) continue
      const dLa = (Math.cos(h) * len) / 2 / mLat, dLo = (Math.sin(h) * len) / 2 / mLon
      const e = m?.elevFt ?? 0
      r.push({ li: String(id), hi: String(id), la1: +(la - dLa).toFixed(6), lo1: +(lo - dLo).toFixed(6), la2: +(la + dLa).toFixed(6), lo2: +(lo + dLo).toFixed(6), e1: e, e2: e, l: Math.round(len * FT_PER_M), w: Math.round(wid * FT_PER_M), s: SOFT_SURFACES.has(surf) ? 1 : 0, lt: 0, pad: true })
      sla += la; slo += lo
    }
    if (!r.length) continue
    out.push({ i: icao, n: m?.name || icao, la: +(sla / r.length).toFixed(5), lo: +(slo / r.length).toFixed(5), e: m?.elevFt ?? 0, t: 0, xo: true, r })
  }
  return out
}

let onlyList = null
/** The X-Plane-only airports (see `aptOnlyAirports`) as an array; built once per process. */
export function aptAirportsOnlyInXplane(cacheDir, files = aptFiles(), db = []) {
  if (!files.length) return null
  loadRunwayTables(cacheDir, files)
  if (!onlyList) onlyList = aptOnlyAirports(runwaysTable, metaTable, db, padsTable ?? {})
  return onlyList
}

/** The X-Plane-only airports within `radiusM` of a point (the whole list when no point is given). */
export function aptAirportsNear(list, lat, lon, radiusM) {
  if (!Number.isFinite(lat) || !Number.isFinite(lon) || !Number.isFinite(radiusM)) return list
  return list.filter((a) => metres(lat, lon, a.la, a.lo) <= radiusM)
}

/** Cell size (m) of the land mask, and the half width (m) its runs are levelled to. */
export const LAND_CELL_M = 100
const LAND_MAX_RUNS = 800

/**
 * Where an airport is certainly land: the cells (LAND_CELL_M) its X-Plane pavement and runways cover, grown by one cell,
 * as runs along rows: [[lat1, lon1, lat2, lon2], …] between the centres of a run's first and last cell. The client
 * levels the terrain there only where the elevation data says sea (polders, reclaimed land).
 * @param layout the parsed airport (`pav` polygons as rings of [lat, lon], `rwy` runways with end positions)
 */
export function landMaskRuns(layout, refLat, refLon) {
  if (!layout || !Number.isFinite(refLat) || !Number.isFinite(refLon)) return []
  const mLat = 111_319.5, mLon = mLat * Math.cos((refLat * Math.PI) / 180)
  if (!(mLon > 1)) return []
  const toXY = (la, lo) => [(lo - refLon) * mLon, (la - refLat) * mLat]
  const rows = new Map()
  const mark = (x, y) => {
    const i = Math.floor(x / LAND_CELL_M), j = Math.floor(y / LAND_CELL_M)
    let r = rows.get(j); if (!r) rows.set(j, (r = new Set()))
    r.add(i)
  }
  const line = (x0, y0, x1, y1) => {
    const n = Math.max(1, Math.ceil(Math.hypot(x1 - x0, y1 - y0) / (LAND_CELL_M / 2)))
    for (let k = 0; k <= n; k++) mark(x0 + ((x1 - x0) * k) / n, y0 + ((y1 - y0) * k) / n)
  }
  for (const p of Array.isArray(layout.pav) ? layout.pav : []) {
    const ring = Array.isArray(p?.rings) ? p.rings[0] : null
    if (!Array.isArray(ring) || ring.length < 3) continue
    const xy = ring.map((q) => (Array.isArray(q) && Number.isFinite(q[0]) && Number.isFinite(q[1]) ? toXY(q[0], q[1]) : null))
    if (xy.some((q) => !q) || xy.some((q) => Math.abs(q[0]) > 30_000 || Math.abs(q[1]) > 30_000)) continue
    for (let k = 0; k < xy.length; k++) { const a = xy[k], b = xy[(k + 1) % xy.length]; line(a[0], a[1], b[0], b[1]) }
    const x0 = Math.min(...xy.map((q) => q[0])), x1 = Math.max(...xy.map((q) => q[0]))
    const y0 = Math.min(...xy.map((q) => q[1])), y1 = Math.max(...xy.map((q) => q[1]))
    if (((x1 - x0) / LAND_CELL_M) * ((y1 - y0) / LAND_CELL_M) > 40_000) continue
    for (let y = y0 + LAND_CELL_M / 2; y < y1; y += LAND_CELL_M) {
      for (let x = x0 + LAND_CELL_M / 2; x < x1; x += LAND_CELL_M) {
        let inside = false
        for (let a = 0, b = xy.length - 1; a < xy.length; b = a++) {
          if ((xy[a][1] > y) !== (xy[b][1] > y) && x < ((xy[b][0] - xy[a][0]) * (y - xy[a][1])) / (xy[b][1] - xy[a][1]) + xy[a][0]) inside = !inside
        }
        if (inside) mark(x, y)
      }
    }
  }
  for (const r of Array.isArray(layout.rwy) ? layout.rwy : []) {
    const e = Array.isArray(r?.ends) ? r.ends : []
    if (e.length !== 2 || ![e[0]?.lat, e[0]?.lon, e[1]?.lat, e[1]?.lon].every(Number.isFinite)) continue
    const [x0, y0] = toXY(e[0].lat, e[0].lon), [x1, y1] = toXY(e[1].lat, e[1].lon)
    const len = Math.hypot(x1 - x0, y1 - y0)
    if (!(len > 1) || len > 8000) continue
    const nx = -(y1 - y0) / len, ny = (x1 - x0) / len, half = Math.max(Number(r.w) || 30, 10) / 2
    for (let o = -half; o <= half + 0.01; o += Math.max(half, 5)) line(x0 + nx * o, y0 + ny * o, x1 + nx * o, y1 + ny * o)
  }
  // Grow by one cell, then read off the runs of each row.
  const grown = new Map()
  for (const [j, set] of rows) for (const i of set) for (let dj = -1; dj <= 1; dj++) for (let di = -1; di <= 1; di++) {
    let r = grown.get(j + dj); if (!r) grown.set(j + dj, (r = new Set()))
    r.add(i + di)
  }
  const out = []
  for (const [j, set] of [...grown].sort((a, b) => a[0] - b[0])) {
    const is = [...set].sort((a, b) => a - b)
    for (let k = 0; k < is.length;) {
      let e = k
      while (e + 1 < is.length && is[e + 1] === is[e] + 1) e++
      const y = (j + 0.5) * LAND_CELL_M
      out.push([+(refLat + y / mLat).toFixed(5), +(refLon + ((is[k] + 0.5) * LAND_CELL_M) / mLon).toFixed(5), +(refLat + y / mLat).toFixed(5), +(refLon + ((is[e] + 0.5) * LAND_CELL_M) / mLon).toFixed(5)])
      k = e + 1
    }
  }
  return out.length > LAND_MAX_RUNS ? [] : out
}

const landMemo = new Map()
/** Airports lower than this (m) get a land mask: polders and reclaimed land lie low. */
export const LAND_MASK_MAX_ELEV_M = 20

/**
 * The land masks of the airports in `list` (database-shaped: i, la, lo, e feet) low enough to need one:
 * { ICAO: [[lat1, lon1, lat2, lon2], …] }. An airport X-Plane has no layout for gets none.
 */
export function aptLandMasks(list, cacheDir) {
  const out = {}
  for (const a of list) {
    if (!(a.e * 0.3048 <= LAND_MASK_MAX_ELEV_M)) continue
    let runs = landMemo.get(a.i)
    if (!runs) {
      let layout = null
      try { const json = aptAirport(a.i, cacheDir); layout = json ? JSON.parse(json) : null } catch { layout = null }
      runs = landMaskRuns(layout, a.la, a.lo)
      if (landMemo.size > 400) landMemo.delete(landMemo.keys().next().value)
      landMemo.set(a.i, runs)
    }
    if (runs.length) out[a.i] = runs
  }
  return out
}
