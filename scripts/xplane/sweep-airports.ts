/**
 * Builds X-Plane's layout (pavement, paint, lights, gate numbers, parked-airplane spots, taxiway names) for EVERY
 * airport in the install's apt.dat in node, over a gently sloping ground, and reports exceptions, non-finite
 * vertices, slow builds (> 4 s) and very large ones (> 1.2 M triangles). About eight minutes.
 *
 *   npx tsx scripts/xplane/sweep-airports.ts
 *
 * Airports with no drawable pavement (heliports, seaplane bases, strips) have no layout and are counted, not built.
 */
import * as THREE from 'three'
const noop: ProxyHandler<object> = { get: (_t, k) => (k === 'canvas' ? {} : () => new Proxy(function () {}, noop)), apply: () => new Proxy(function () {}, noop) }
;(globalThis as unknown as { document: unknown }).document = { createElement: () => ({ width: 0, height: 0, getContext: () => new Proxy({}, noop), style: {} }) }
// @ts-expect-error plain ES module without types (server code)
import { aptAirport, loadAptIndex } from '../../server/apt.mjs'
import { normalizeApt, buildAptPavement, buildAptPaint, buildAptLights, buildAptGateLabels, runwayRects, taxiIdentSegments } from '../../src/world/apt-layout'
import { parkedAircraftFor } from '../../src/world/parked-aircraft'

const cache = new URL('../../server/cache', import.meta.url).pathname
const idx = loadAptIndex(cache) as Map<string, unknown>
const all = [...idx.keys()]
const t0 = Date.now()
let done = 0, built = 0, noLayout = 0
const issues: string[] = []
const slow: Array<[string, number]> = [], big: Array<[string, number]> = []
let totalTris = 0
for (const icao of all) {
  done++
  try {
    const json = aptAirport(icao, cache)
    if (!json) { noLayout++; continue }
    const layout = normalizeApt(JSON.parse(json))
    if (!layout) { noLayout++; continue }
    if (!layout.pav.length) { noLayout++; continue }
    const ring0 = layout.pav[0]!.rings[0]!
    const lat0 = ring0[0]![0], lon0 = ring0[0]![1]
    const mLat = 111_320, mLon = 111_320 * Math.cos((lat0 * Math.PI) / 180)
    const toLocal = (lat: number, lon: number) => ({ x: (lon - lon0) * mLon, z: -(lat - lat0) * mLat })
    const t = performance.now()
    const rects = runwayRects(layout.rwy, toLocal)
    const ground = (x: number, z: number) => 3 + 0.0004 * x - 0.0003 * z       // a gentle slope exercises the draping
    const meshes = [...buildAptPavement(layout, toLocal, 0, ground, rects), ...buildAptPaint(layout, toLocal, 0, ground)]
    const extras = [buildAptLights(layout, toLocal, 0, ground), buildAptGateLabels(layout, toLocal, 0, ground)]
    parkedAircraftFor(layout.ramps.map((r) => ({ ...toLocal(r.lat, r.lon), hdg: r.hdg, kind: r.kind, cats: r.cats, name: r.name })))
    taxiIdentSegments(layout, toLocal)
    let tris = 0
    for (const m of [...meshes, ...extras.filter((e): e is THREE.Mesh => !!e && 'geometry' in e)]) {
      const g = m.geometry as THREE.BufferGeometry
      const pos = g.getAttribute('position')
      const arr = pos.array as Float32Array
      for (let i = 0; i < arr.length; i++) if (!Number.isFinite(arr[i]!)) { issues.push(`${icao}: non-finite vertex in ${m.name}`); break }
      tris += (g.index ? g.index.count : pos.count) / 3
    }
    totalTris += tris
    built++
    const ms = performance.now() - t
    if (ms > 4000) slow.push([icao, Math.round(ms)])
    if (tris > 1_200_000) big.push([icao, Math.round(tris)])
  } catch (e) { issues.push(`${icao}: ${(e as Error).message}`) }
  if (done % 4000 === 0) console.log(`progress ${done}/${all.length} built ${built} issues ${issues.length} ${Math.round((Date.now() - t0) / 1000)}s`)
}
console.log(JSON.stringify({ airports: all.length, built, noLayout, issues: issues.length, slow, big, avgTris: Math.round(totalTris / Math.max(built, 1)), seconds: Math.round((Date.now() - t0) / 1000) }))
console.log(issues.join('\n') || 'no issues')
