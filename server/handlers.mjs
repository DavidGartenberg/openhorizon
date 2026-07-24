/**
 * Data handlers shared by the Express server and the Vite dev middleware:
 * terrain tile proxy (AWS terrarium, disk-cached) and the OurAirports
 * build pipeline (§22 sources).
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { execFileSync } from 'node:child_process'
import { buildUsAirports, buildUsNavaids, buildCifpProcedures, buildUsAirspace, buildUsFrequencies, buildAircraftTypes, isImageBuf, normalizeAdsb } from './parse.mjs'

const cacheDir = path.join(path.dirname(fileURLToPath(import.meta.url)), 'cache')
/** Vendored offline fallbacks committed with the repo (Phase 12a). */
const seedDir = path.join(path.dirname(fileURLToPath(import.meta.url)), 'cache-seed')
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

// ---- ICAO aircraft-type designators (Phase 12a) ----
// Sources (community mirrors of ICAO Doc 8643 — recorded deviation: may
// lag ICAO revisions): desc/wtc from the tar1090-db ADS-B ecosystem table,
// names best-effort from the rikgale ICAOList CSV. A vendored seed
// (server/cache-seed/aircraft-types.json) makes the endpoint work offline.
const TYPES_URL = 'https://raw.githubusercontent.com/wiedehopf/tar1090-db/master/icao_aircraft_types.json'
const TYPE_NAMES_URL = 'https://raw.githubusercontent.com/rikgale/ICAOList/main/ICAOList.csv'
// ---- USGS satellite imagery (Phase 13b) ----
// USGS National Map "USGSImageryOnly" tile service: public domain, US-only
// (matches the sim's scope — recorded deviation). ArcGIS path order z/y/x.
const IMAGERY_BASE = 'https://basemap.nationalmap.gov/arcgis/rest/services/USGSImageryOnly/MapServer/tile'

export async function imageryTile(z, x, y) {
  const f = path.join(cacheDir, `im-${z}-${x}-${y}.jpg`)
  if (fs.existsSync(f)) return fs.readFileSync(f)
  const res = await fetch(`${IMAGERY_BASE}/${z}/${y}/${x}`)
  if (!res.ok) throw new Error(`imagery ${z}/${x}/${y}: upstream ${res.status}`)
  const buf = Buffer.from(await res.arrayBuffer())
  // Never cache junk: ArcGIS failures can arrive as 200 text/html. Magic
  // bytes, not headers, decide what goes in the disk cache.
  if (!isImageBuf(buf)) {
    throw new Error(`imagery ${z}/${x}/${y}: non-image upstream (${res.headers.get('content-type')}, ${buf.length} B)`)
  }
  fs.writeFileSync(f, buf)
  return buf
}

// ---- live ADS-B traffic (Phase 14a) ----
// Free-feed etiquette (recorded in the plan): coordinates bucket to
// 0.25° so nearby clients share one upstream query, 10 s TTL,
// single-flight dedup per bucket, ≥5 s spacing between ANY two
// upstream calls, provider chain with per-provider cooldowns, and
// stale-while-error (the cached payload keeps its old ts, so client
// age displays climb honestly instead of lying about freshness).
const TRAFFIC_TTL_MS = 10_000
const TRAFFIC_RADIUS_NM = 40
const TRAFFIC_SPACING_MS = 5_000
const TRAFFIC_COOLDOWN_MS = 60_000

const trafficCache = new Map() // bucket -> { payload, at }
const trafficInFlight = new Map() // bucket -> Promise
let trafficLastUpstreamAt = 0
const trafficCooldownUntil = { adsblol: 0, adsbfi: 0, opensky: 0 }

const trafficSleep = (ms) => new Promise((r) => setTimeout(r, ms))

async function fetchTrafficProvider(provider, lat, lon) {
  let url
  if (provider === 'adsblol') url = `https://api.adsb.lol/v2/point/${lat}/${lon}/${TRAFFIC_RADIUS_NM}`
  else if (provider === 'adsbfi') url = `https://opendata.adsb.fi/api/v2/lat/${lat}/lon/${lon}/dist/${TRAFFIC_RADIUS_NM}`
  else {
    const dLat = TRAFFIC_RADIUS_NM / 60
    const dLon = dLat / Math.cos((lat * Math.PI) / 180)
    url = `https://opensky-network.org/api/states/all?lamin=${(lat - dLat).toFixed(3)}&lomin=${(lon - dLon).toFixed(3)}&lamax=${(lat + dLat).toFixed(3)}&lomax=${(lon + dLon).toFixed(3)}`
  }
  const res = await fetch(url, { signal: AbortSignal.timeout(8000) })
  if (!res.ok) throw new Error(`traffic ${provider}: ${res.status}`)
  return normalizeAdsb(await res.json(), provider)
}

export async function trafficData(latStr, lonStr) {
  const lat = Number(latStr)
  const lon = Number(lonStr)
  if (!Number.isFinite(lat) || !Number.isFinite(lon) || Math.abs(lat) > 89 || Math.abs(lon) > 180) {
    throw new Error('bad traffic coords')
  }
  const bLat = Math.round(lat * 4) / 4
  const bLon = Math.round(lon * 4) / 4
  const bucket = `${bLat},${bLon}`
  const cached = trafficCache.get(bucket)
  if (cached && Date.now() - cached.at < TRAFFIC_TTL_MS) return cached.payload
  const inflight = trafficInFlight.get(bucket)
  if (inflight) return inflight
  const p = (async () => {
    try {
      const wait = trafficLastUpstreamAt + TRAFFIC_SPACING_MS - Date.now()
      if (wait > 0) await trafficSleep(wait)
      trafficLastUpstreamAt = Date.now()
      for (const provider of ['adsblol', 'adsbfi', 'opensky']) {
        if (Date.now() < trafficCooldownUntil[provider]) continue
        try {
          const payload = await fetchTrafficProvider(provider, bLat, bLon)
          trafficCache.set(bucket, { payload, at: Date.now() })
          return payload
        } catch {
          trafficCooldownUntil[provider] = Date.now() + TRAFFIC_COOLDOWN_MS
        }
      }
      if (cached) return cached.payload // stale-while-error
      return { ac: [], ts: Date.now() }
    } finally {
      trafficInFlight.delete(bucket)
    }
  })()
  trafficInFlight.set(bucket, p)
  return p
}

let aircraftTypesJson = null

export async function aircraftTypesData() {
  if (aircraftTypesJson) return aircraftTypesJson
  const jsonFile = path.join(cacheDir, 'aircraft-types.json')
  if (fs.existsSync(jsonFile)) {
    aircraftTypesJson = fs.readFileSync(jsonFile, 'utf8')
    return aircraftTypesJson
  }
  try {
    const typesRes = await fetch(TYPES_URL)
    if (!typesRes.ok) throw new Error(`types: ${typesRes.status}`)
    const typesText = await typesRes.text()
    let namesText = null
    try {
      const namesRes = await fetch(TYPE_NAMES_URL)
      if (namesRes.ok) namesText = await namesRes.text()
    } catch { /* names are best-effort */ }
    aircraftTypesJson = JSON.stringify(buildAircraftTypes(typesText, namesText))
    fs.writeFileSync(jsonFile, aircraftTypesJson)
    return aircraftTypesJson
  } catch (err) {
    // Offline / mirror down: the vendored seed is the honest fallback.
    const seed = path.join(seedDir, 'aircraft-types.json')
    if (fs.existsSync(seed)) {
      aircraftTypesJson = fs.readFileSync(seed, 'utf8')
      return aircraftTypesJson
    }
    throw err
  }
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

// ---- Airspace (Class B/C/D/E-surface + SUA, Phase 4 Task 5, §6.5) ----

const ARCGIS_BASE = 'https://services6.arcgis.com/ssFJjBXIUyZDrSYZ/arcgis/rest/services'
const CLASS_AIRSPACE_FIELDS = 'NAME,ICAO_ID,LOCAL_TYPE,UPPER_VAL,UPPER_UOM,UPPER_CODE,LOWER_VAL,LOWER_UOM,LOWER_CODE,SECTOR'
const SUA_FIELDS = 'NAME,TYPE_CODE,UPPER_VAL,UPPER_UOM,UPPER_CODE,LOWER_VAL,LOWER_UOM,LOWER_CODE'

/**
 * Page through an ArcGIS FeatureServer `query` endpoint and return the
 * concatenated GeoJSON `Feature[]`. The server's own `maxRecordCount` is
 * 2000, but real ~500-feature/~34MB-per-page responses were observed
 * during this task's data-source verification to sometimes truncate
 * mid-transfer (a plain `fetch(...).json()` throwing "Unexpected end of
 * JSON input"), so this fetches in smaller 500-feature pages with retries
 * per page rather than trusting one large request. Stops once a page
 * returns fewer than `pageSize` features (the standard "last page" signal
 * — no separate count query needed).
 */
async function fetchArcgisFeatures(serviceUrl, fields) {
  const pageSize = 500
  let offset = 0
  let all = []
  for (;;) {
    const url = `${serviceUrl}/query?where=1=1&outFields=${fields}&f=geojson&resultOffset=${offset}&resultRecordCount=${pageSize}`
    let json
    let lastErr
    for (let attempt = 0; attempt < 4 && !json; attempt++) {
      try {
        const res = await fetch(url)
        if (!res.ok) throw new Error(`${url}: ${res.status}`)
        json = JSON.parse(await res.text())
      } catch (err) {
        lastErr = err
      }
    }
    if (!json) throw new Error(`airspace fetch failed at offset ${offset}: ${lastErr}`)
    const features = json.features ?? []
    all = all.concat(features)
    if (features.length < pageSize) break
    offset += pageSize
  }
  return all
}

let airspaceJson = null

/** GET /api/airspace.json — compact US Class B/C/D/E-surface + Special Use
 *  Airspace boundaries. Cached to disk like `airports.json`/`navaids.json`
 *  (cache-forever-until-manually-refreshed — airspace boundaries change on
 *  the same slow cycle as sectional charts, not per-run). */
export async function airspaceData() {
  if (airspaceJson) return airspaceJson
  const jsonFile = path.join(cacheDir, 'us-airspace.json')
  if (fs.existsSync(jsonFile)) {
    airspaceJson = fs.readFileSync(jsonFile, 'utf8')
    return airspaceJson
  }
  const rawFile = path.join(cacheDir, 'airspace-raw.json')
  let classFeatures, suaFeatures
  if (fs.existsSync(rawFile)) {
    ;({ classFeatures, suaFeatures } = JSON.parse(fs.readFileSync(rawFile, 'utf8')))
  } else {
    ;[classFeatures, suaFeatures] = await Promise.all([
      fetchArcgisFeatures(`${ARCGIS_BASE}/Class_Airspace/FeatureServer/0`, CLASS_AIRSPACE_FIELDS),
      fetchArcgisFeatures(`${ARCGIS_BASE}/Special_Use_Airspace/FeatureServer/0`, SUA_FIELDS),
    ])
    fs.writeFileSync(rawFile, JSON.stringify({ classFeatures, suaFeatures }))
  }
  airspaceJson = JSON.stringify(buildUsAirspace(classFeatures, suaFeatures))
  fs.writeFileSync(jsonFile, airspaceJson)
  return airspaceJson
}

/** Node http-style routing used by both Express and Vite middleware. */
// ---- Live METAR (Phase 5 §11): aviationweather.gov bbox query, 10-min TTL ----

const metarCache = new Map() // key → { at: ms, body: string }

/** GET /api/metar?bbox=lat0,lon0,lat1,lon1 — passes through the FAA/NWS
 *  aviationweather.gov JSON (station lat/lon + rawOb per entry). Cached
 *  10 minutes per bbox (METARs update hourly; §11 says ~10-min refresh). */
export async function metarData(bbox) {
  if (!/^-?\d+(\.\d+)?,-?\d+(\.\d+)?,-?\d+(\.\d+)?,-?\d+(\.\d+)?$/.test(bbox)) {
    throw new Error('bad bbox')
  }
  const hit = metarCache.get(bbox)
  if (hit && Date.now() - hit.at < 10 * 60 * 1000) return hit.body
  const url = `https://aviationweather.gov/api/data/metar?bbox=${bbox}&format=json`
  const res = await fetch(url)
  if (!res.ok) throw new Error(`metar: ${res.status}`)
  const body = await res.text()
  metarCache.set(bbox, { at: Date.now(), body })
  return body
}

// ---- Comms frequencies (Phase 6a, §12) ----

let frequenciesJson = null

/** GET /api/frequencies.json — per-US-airport TWR/GND/ATIS/CTAF/etc. */
export async function frequenciesData() {
  if (frequenciesJson) return frequenciesJson
  const jsonFile = path.join(cacheDir, 'us-frequencies.json')
  if (fs.existsSync(jsonFile)) {
    frequenciesJson = fs.readFileSync(jsonFile, 'utf8')
    return frequenciesJson
  }
  const f = path.join(cacheDir, 'frequencies.csv')
  let csv
  if (fs.existsSync(f)) csv = fs.readFileSync(f, 'utf8')
  else {
    const res = await fetch(`${OA_BASE}/airport-frequencies.csv`)
    if (!res.ok) throw new Error(`airport-frequencies.csv: ${res.status}`)
    csv = await res.text()
    fs.writeFileSync(f, csv)
  }
  const usIdents = new Set(JSON.parse(await airportsData()).map((a) => a.i))
  frequenciesJson = JSON.stringify(buildUsFrequencies(csv, usIdents))
  fs.writeFileSync(jsonFile, frequenciesJson)
  return frequenciesJson
}

// ---- NEXRAD composite tiles (Phase 5 §11, FIS-B presentation) ----

const nexradCache = new Map() // key → { at: ms, buf: Buffer }

/** GET /proxy/nexrad/{z}/{x}/{y}.png — IEM national composite (n0q),
 *  5-min TTL (matches the product's own update cadence). */
export async function nexradTile(z, x, y) {
  if (!/^\d+$/.test(z) || !/^\d+$/.test(x) || !/^\d+$/.test(y)) throw new Error('bad tile')
  const key = `${z}/${x}/${y}`
  const hit = nexradCache.get(key)
  if (hit && Date.now() - hit.at < 5 * 60 * 1000) return hit.buf
  const res = await fetch(`https://mesonet.agron.iastate.edu/cache/tile.py/1.0.0/nexrad-n0q-900913/${z}/${x}/${y}.png`)
  if (!res.ok) throw new Error(`nexrad ${key}: ${res.status}`)
  const buf = Buffer.from(await res.arrayBuffer())
  nexradCache.set(key, { at: Date.now(), buf })
  return buf
}

// ---- NLCD land cover via MRLC WMS (Phase 5 step 6, §6.2) ----

/** GET /proxy/landcover/{z}/{x}/{y}.png — slippy tile served from the MRLC
 *  NLCD 2021 WMS (EPSG:3857 bbox computed from the tile), disk-cached
 *  forever (land cover changes on a multi-year cycle). */
export async function landcoverTile(z, x, y) {
  if (!/^\d+$/.test(z) || !/^\d+$/.test(x) || !/^\d+$/.test(y)) throw new Error('bad tile')
  const file = path.join(cacheDir, 'terrain', `lc-${z}-${x}-${y}.png`)
  if (fs.existsSync(file)) return fs.readFileSync(file)
  const half = 20037508.342789244
  const size = (2 * half) / 2 ** Number(z)
  const minx = -half + Number(x) * size
  const maxy = half - Number(y) * size
  const bbox = `${minx},${maxy - size},${minx + size},${maxy}`
  const url =
    'https://www.mrlc.gov/geoserver/mrlc_display/NLCD_2021_Land_Cover_L48/wms' +
    `?SERVICE=WMS&VERSION=1.1.1&REQUEST=GetMap&LAYERS=NLCD_2021_Land_Cover_L48&STYLES=` +
    `&FORMAT=image/png&TRANSPARENT=true&SRS=EPSG:3857&WIDTH=256&HEIGHT=256&BBOX=${bbox}`
  const res = await fetch(url)
  if (!res.ok) throw new Error(`landcover ${z}/${x}/${y}: ${res.status}`)
  const buf = Buffer.from(await res.arrayBuffer())
  fs.writeFileSync(file, buf)
  return buf
}

export async function route(url, res) {
  const terrain = url.match(/^\/proxy\/terrain\/(\d+)\/(\d+)\/(\d+)\.png$/)
  const metar = url.match(/^\/api\/metar\?bbox=([-\d.,]+)$/)
  const nexrad = url.match(/^\/proxy\/nexrad\/(\d+)\/(\d+)\/(\d+)\.png$/)
  const landcover = url.match(/^\/proxy\/landcover\/(\d+)\/(\d+)\/(\d+)\.png$/)
  try {
    if (landcover) {
      const buf = await landcoverTile(landcover[1], landcover[2], landcover[3])
      res.writeHead(200, {
        'Content-Type': 'image/png',
        'Cache-Control': 'public, max-age=2592000',
        'Access-Control-Allow-Origin': '*',
      })
      res.end(buf)
      return true
    }
    if (nexrad) {
      const buf = await nexradTile(nexrad[1], nexrad[2], nexrad[3])
      res.writeHead(200, {
        'Content-Type': 'image/png',
        'Cache-Control': 'public, max-age=300',
        'Access-Control-Allow-Origin': '*',
      })
      res.end(buf)
      return true
    }
    if (metar) {
      const body = await metarData(metar[1])
      res.writeHead(200, {
        'Content-Type': 'application/json',
        'Cache-Control': 'public, max-age=600',
        'Access-Control-Allow-Origin': '*',
      })
      res.end(body)
      return true
    }
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
    {
      const m = url.match(/^\/proxy\/imagery\/(\d+)\/(\d+)\/(\d+)$/)
      if (m) {
        const buf = await imageryTile(m[1], m[2], m[3])
        res.writeHead(200, {
          'Content-Type': buf[0] === 0x89 ? 'image/png' : 'image/jpeg',
          'Cache-Control': 'public, max-age=2592000',
          'Access-Control-Allow-Origin': '*',
        })
        res.end(buf)
        return true
      }
    }
    {
      const m = url.match(/^\/api\/traffic\?lat=(-?[\d.]+)&lon=(-?[\d.]+)$/)
      if (m) {
        const json = await trafficData(m[1], m[2])
        res.writeHead(200, {
          'Content-Type': 'application/json',
          'Cache-Control': 'no-store',
          'Access-Control-Allow-Origin': '*',
        })
        res.end(JSON.stringify(json))
        return true
      }
    }
    if (url === '/api/aircraft-types.json') {
      const json = await aircraftTypesData()
      res.writeHead(200, {
        'Content-Type': 'application/json',
        'Cache-Control': 'public, max-age=86400',
        'Access-Control-Allow-Origin': '*',
      })
      res.end(json)
      return true
    }
    if (url === '/api/frequencies.json') {
      const json = await frequenciesData()
      res.writeHead(200, {
        'Content-Type': 'application/json',
        'Cache-Control': 'public, max-age=86400',
        'Access-Control-Allow-Origin': '*',
      })
      res.end(json)
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
    if (url === '/api/airspace.json') {
      const json = await airspaceData()
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
