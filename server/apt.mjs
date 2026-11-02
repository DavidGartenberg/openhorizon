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
