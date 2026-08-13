import * as THREE from 'three'

/**
 * Real airport ground layouts (night-shift N8): render the airport's
 * ACTUAL taxiway network, aprons, and terminal footprints from the OSM
 * aeroway pipeline (/api/osm/{ICAO}.json — cached forever server-side).
 * When data lands, the procedural taxiway stand-in is removed; where OSM
 * has nothing, the stand-in stays (recorded honest fallback).
 *
 * Known limitation (recorded): geometry is laid flat at field elevation —
 * terrain flattening only covers the runway corridor, so at hilly fields
 * distant taxiways can sink/float. Flat major airports render true.
 */

const TAXI = new THREE.MeshStandardMaterial({ color: 0x3c4043, roughness: 0.95 })
const STRIPE = new THREE.MeshBasicMaterial({ color: 0xd8b23a })
const APRON = new THREE.MeshStandardMaterial({ color: 0x55595e, roughness: 0.9 })
const TERMINAL = new THREE.MeshStandardMaterial({ color: 0x9aa2ab, roughness: 0.6, metalness: 0.2 })

interface OsmLayout {
  tw: { r: string; p: [number, number][] }[]
  ap: [number, number][][]
  tm: [number, number][][]
  st: { r: string; p: [number, number][] }[]
}

/** Butt-jointed ribbon strip along a polyline (local x/z), one quad per
 *  segment, merged into the shared position/index arrays. */
function appendRibbon(
  pos: number[], idx: number[], pts: { x: number; z: number }[], width: number, y: number,
): void {
  const hw = width / 2
  for (let i = 0; i < pts.length - 1; i++) {
    const a = pts[i]!
    const b = pts[i + 1]!
    const dx = b.x - a.x
    const dz = b.z - a.z
    const len = Math.hypot(dx, dz) || 1
    const nx = (-dz / len) * hw
    const nz = (dx / len) * hw
    const base = pos.length / 3
    pos.push(a.x + nx, y, a.z + nz, a.x - nx, y, a.z - nz, b.x + nx, y, b.z + nz, b.x - nx, y, b.z - nz)
    idx.push(base, base + 2, base + 1, base + 1, base + 2, base + 3)
  }
}

function meshFromBuffers(pos: number[], idx: number[], mat: THREE.Material): THREE.Mesh {
  const geo = new THREE.BufferGeometry()
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3))
  geo.setIndex(idx)
  geo.computeVertexNormals()
  const m = new THREE.Mesh(geo, mat)
  m.receiveShadow = true
  return m
}

/** Fetch + build the real layout into `group` (airport-local frame:
 *  x = east meters from the airport ref, z = −north). */
export async function enhanceAirportWithOsm(
  group: THREE.Group,
  icao: string,
  refLat: number,
  refLon: number,
  elevM: number,
): Promise<void> {
  let data: OsmLayout
  try {
    const res = await fetch(`/api/osm/${icao}.json?lat=${refLat}&lon=${refLon}`)
    if (!res.ok) return
    data = await res.json()
  } catch {
    return
  }
  if (!data.tw.length && !data.ap.length && !data.tm.length) return // unmapped — keep the stand-in

  const mLat = 111_320
  const mLon = 111_320 * Math.cos((refLat * Math.PI) / 180)
  const toLocal = (lat: number, lon: number): { x: number; z: number } => ({
    x: (lon - refLon) * mLon,
    z: -(lat - refLat) * mLat,
  })
  const osm = new THREE.Group()
  osm.name = 'osmLayout'

  // Aprons first (lowest).
  if (data.ap.length) {
    const shapes: THREE.Shape[] = []
    for (const poly of data.ap) {
      if (poly.length < 3) continue
      const s = new THREE.Shape()
      poly.forEach(([lat, lon], i) => {
        const p = toLocal(lat, lon)
        if (i === 0) s.moveTo(p.x, p.z)
        else s.lineTo(p.x, p.z)
      })
      shapes.push(s)
    }
    const geo = new THREE.ShapeGeometry(shapes)
    geo.rotateX(Math.PI / 2)
    const m = new THREE.Mesh(geo, APRON)
    m.position.y = elevM + 0.03
    m.receiveShadow = true
    osm.add(m)
  }

  // Taxiway ribbons + centerline stripes.
  const twPos: number[] = []
  const twIdx: number[] = []
  const stPos: number[] = []
  const stIdx: number[] = []
  for (const tw of data.tw) {
    const pts = tw.p.map(([lat, lon]) => toLocal(lat, lon))
    appendRibbon(twPos, twIdx, pts, 18, elevM + 0.06)
    appendRibbon(stPos, stIdx, pts, 0.38, elevM + 0.1)
  }
  if (twPos.length) {
    osm.add(meshFromBuffers(twPos, twIdx, TAXI))
    osm.add(meshFromBuffers(stPos, stIdx, STRIPE))
  }

  // Terminal footprints, extruded (footprint REAL, height class-estimated
  // — recorded).
  for (const poly of data.tm) {
    if (poly.length < 3) continue
    const s = new THREE.Shape()
    poly.forEach(([lat, lon], i) => {
      const p = toLocal(lat, lon)
      if (i === 0) s.moveTo(p.x, p.z)
      else s.lineTo(p.x, p.z)
    })
    const geo = new THREE.ExtrudeGeometry(s, { depth: 11, bevelEnabled: false })
    geo.rotateX(Math.PI / 2)
    const m = new THREE.Mesh(geo, TERMINAL)
    m.position.y = elevM + 11
    m.castShadow = true
    m.receiveShadow = true
    osm.add(m)
  }

  // Real layout in — retire the procedural taxiway stand-in.
  const stale: THREE.Object3D[] = []
  group.traverse((o) => { if (o.name === 'proceduralTaxi') stale.push(o) })
  for (const o of stale) o.removeFromParent()
  group.add(osm)
}
