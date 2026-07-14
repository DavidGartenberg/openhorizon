/**
 * Data handlers shared by the Express server and the Vite dev middleware:
 * terrain tile proxy (AWS terrarium, disk-cached) and the OurAirports
 * build pipeline (§22 sources).
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { buildUsAirports } from './parse.mjs'

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
  } catch (err) {
    res.writeHead(502, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify({ error: String(err) }))
    return true
  }
  return false
}
