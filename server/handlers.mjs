/**
 * Data handlers shared by the Express server and the Vite dev middleware:
 * terrain tile proxy (AWS terrarium, disk-cached) and the OurAirports
 * build pipeline (§22 sources).
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { execFileSync } from 'node:child_process'
import { buildUsAirports, buildUsNavaids, buildCifpProcedures } from './parse.mjs'

const cacheDir = path.join(path.dirname(fileURLToPath(import.meta.url)), 'cache')
fs.mkdirSync(path.join(cacheDir, 'terrain'), { recursive: true })

const TERRAIN_BASE = 'https://s3.amazonaws.com/elevation-tiles-prod/terrarium'
const OA_BASE = 'https://davidmegginson.github.io/ourairports-data'

/** GET /proxy/terrain/{z}/{x}/{y}.png */
export async function terrainTile(z, x, y) {
  if (!/^\d+$/.test(z) || !/^\d+$/.test(x) || !/^\d+$/.test(y)) throw new Error('bad tile')
  const file = path.join(cacheDir, 'terrain', `${z}-${x}-${y}.png`)
  if (fs.existsSync(file)) return fs.readFileSync(file)
  const res = await fetch(`${TERRAIN_BASE}/${z}/${x}/${y}.png`)
  if (!res.ok) throw new Error(`tile ${z}/${x}/${y}: ${res.status}`)
  const buf = Buffer.from(await res.arrayBuffer())
  fs.writeFileSync(file, buf)
  return buf
}

let airportsJson = null

/** GET /api/airports.json — compact US airports+runways. */
export async function airportsData() {
  if (airportsJson) return airportsJson
  const jsonFile = path.join(cacheDir, 'us-airports.json')
  if (fs.existsSync(jsonFile)) {
    airportsJson = fs.readFileSync(jsonFile, 'utf8')
    return airportsJson
  }
  const fetchCached = async (name) => {
    const f = path.join(cacheDir, name)
    if (fs.existsSync(f)) return fs.readFileSync(f, 'utf8')
    const res = await fetch(`${OA_BASE}/${name}`)
    if (!res.ok) throw new Error(`${name}: ${res.status}`)
    const text = await res.text()
    fs.writeFileSync(f, text)
    return text
  }
  const [airports, runways] = await Promise.all([
    fetchCached('airports.csv'),
    fetchCached('runways.csv'),
  ])
  airportsJson = JSON.stringify(buildUsAirports(airports, runways))
  fs.writeFileSync(jsonFile, airportsJson)
  return airportsJson
}

let navaidsJson = null

/** GET /api/navaids.json — compact US VOR/NDB navaids. */
export async function navaidsData() {
  if (navaidsJson) return navaidsJson
  const jsonFile = path.join(cacheDir, 'us-navaids.json')
  if (fs.existsSync(jsonFile)) {
    navaidsJson = fs.readFileSync(jsonFile, 'utf8')
    return navaidsJson
  }
  const f = path.join(cacheDir, 'navaids.csv')
  let navaidsCsv
  if (fs.existsSync(f)) {
    navaidsCsv = fs.readFileSync(f, 'utf8')
  } else {
    const res = await fetch(`${OA_BASE}/navaids.csv`)
    if (!res.ok) throw new Error(`navaids.csv: ${res.status}`)
    navaidsCsv = await res.text()
    fs.writeFileSync(f, navaidsCsv)
  }
  navaidsJson = JSON.stringify(buildUsNavaids(navaidsCsv))
  fs.writeFileSync(jsonFile, navaidsJson)
  return navaidsJson
}

// ---- CIFP (SID/STAR/approach procedures, Phase 4 Task 4, §24/§10) ----

const FAA_CIFP_INDEX = 'https://www.faa.gov/air_traffic/flight_info/aeronav/digital_products/cifp/download/'

/**
 * Scrape the FAA's CIFP download index page for the current cycle's zip
 * URL. The filename is date-stamped per 28-day cycle (`CIFP_YYMMDD.zip`)
 * and changes every cycle, so this can't be hardcoded — the index page
 * lists every upcoming/current cycle with effective/ending dates in a
 * table; pick the row whose [effective, ending) window contains today,
 * falling back to the first (soonest) row if that fails (defensive, e.g.
 * clock skew or an unexpected page format change).
 */
export function pickCurrentCifpUrl(indexHtml, now = new Date()) {
  const rowRe = /<a href="(https:\/\/aeronav\.faa\.gov\/Upload_313-d\/cifp\/CIFP_\d+\.zip)">.*?<\/tr>/gs
  const dateRe = /<td>\s*([A-Za-z]+ \d+, \d+)\s*<\/td>/g
  const rows = []
  for (const m of indexHtml.matchAll(rowRe)) {
    const dates = [...m[0].matchAll(dateRe)].map((d) => new Date(d[1]))
    const [eff, end] = dates
    if (eff && end && !isNaN(eff.getTime()) && !isNaN(end.getTime())) rows.push({ url: m[1], eff, end })
  }
  if (rows.length === 0) {
    // Fallback: just grab the first zip link on the page.
    const m = indexHtml.match(/https:\/\/aeronav\.faa\.gov\/Upload_313-d\/cifp\/CIFP_\d+\.zip/)
    if (!m) throw new Error('no CIFP zip link found on download page')
    return m[0]
  }
  const current = rows.find((r) => now >= r.eff && now < r.end)
  return (current ?? rows[0]).url
}

let cifpByAirport = null // Map<icao, Procedure[]>

async function loadCifpData() {
  if (cifpByAirport) return cifpByAirport
  const jsonFile = path.join(cacheDir, 'cifp-procedures.json')
  if (fs.existsSync(jsonFile)) {
    cifpByAirport = new Map(Object.entries(JSON.parse(fs.readFileSync(jsonFile, 'utf8'))))
    return cifpByAirport
  }
  const zipFile = path.join(cacheDir, 'cifp.zip')
  if (!fs.existsSync(zipFile)) {
    const indexRes = await fetch(FAA_CIFP_INDEX)
    if (!indexRes.ok) throw new Error(`CIFP index page: ${indexRes.status}`)
    const indexHtml = await indexRes.text()
    const zipUrl = pickCurrentCifpUrl(indexHtml)
    const zipRes = await fetch(zipUrl)
    if (!zipRes.ok) throw new Error(`${zipUrl}: ${zipRes.status}`)
    fs.writeFileSync(zipFile, Buffer.from(await zipRes.arrayBuffer()))
  }
  // Extract just FAACIFP18 (the ~53MB fixed-width ARINC 424 data file) from
  // the zip via the system `unzip` binary — no JS zip dependency needed for
  // this one-time server-side build step. The zip also bundles PDFs
  // (readme/disclaimer/coverage) which are intentionally never touched.
  const cifpText = execFileSync('unzip', ['-p', zipFile, 'FAACIFP18'], {
    maxBuffer: 200 * 1024 * 1024,
    encoding: 'latin1',
  })
  const parsed = buildCifpProcedures(cifpText)
  cifpByAirport = parsed
  fs.writeFileSync(jsonFile, JSON.stringify(Object.fromEntries(parsed)))
  return cifpByAirport
}

/** GET /api/procedures/{ICAO}.json — that airport's SID/STAR/approach
 *  procedures, or `[]` if the airport has none / isn't found. Served
 *  per-airport (not one nationwide blob) since the full parsed dataset is
 *  ~14MB — impractical to ship to every client for a single airport's
 *  worth of procedures. */
export async function proceduresData(icao) {
  const byAirport = await loadCifpData()
  return JSON.stringify(byAirport.get(icao.toUpperCase()) ?? [])
}

/** Node http-style routing used by both Express and Vite middleware. */
export async function route(url, res) {
  const terrain = url.match(/^\/proxy\/terrain\/(\d+)\/(\d+)\/(\d+)\.png$/)
  try {
    if (terrain) {
      const buf = await terrainTile(terrain[1], terrain[2], terrain[3])
      res.writeHead(200, {
        'Content-Type': 'image/png',
        'Cache-Control': 'public, max-age=604800',
        'Access-Control-Allow-Origin': '*',
      })
      res.end(buf)
      return true
    }
    if (url === '/api/airports.json') {
      const json = await airportsData()
      res.writeHead(200, {
        'Content-Type': 'application/json',
        'Cache-Control': 'public, max-age=86400',
        'Access-Control-Allow-Origin': '*',
      })
      res.end(json)
      return true
    }
    if (url === '/api/navaids.json') {
      const json = await navaidsData()
      res.writeHead(200, {
        'Content-Type': 'application/json',
        'Cache-Control': 'public, max-age=86400',
        'Access-Control-Allow-Origin': '*',
      })
      res.end(json)
      return true
    }
    const procMatch = url.match(/^\/api\/procedures\/([A-Za-z0-9]+)\.json$/)
    if (procMatch) {
      const json = await proceduresData(procMatch[1])
      res.writeHead(200, {
        'Content-Type': 'application/json',
        'Cache-Control': 'public, max-age=86400',
        'Access-Control-Allow-Origin': '*',
      })
      res.end(json)
      return true
    }
  } catch (err) {
    res.writeHead(502, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify({ error: String(err) }))
    return true
  }
  return false
}
