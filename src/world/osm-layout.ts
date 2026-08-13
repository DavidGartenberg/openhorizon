import * as THREE from 'three'

/**
 * Real airport ground layouts (night-shift N8): render the airport's
 * ACTUAL taxiway network, aprons, and terminal footprints from the OSM
 * aeroway pipeline (/api/osm/{ICAO}.json — cached forever server-side).
 * When data lands, the procedural taxiway stand-in is removed; where OSM
 * has nothing, the stand-in stays (recorded honest fallback).
 *
 * Height ladder (N5 anti-flash): apron +0.02 < taxiway +0.04 < runway
 * +0.06 < centerline stripes +0.08 (lead-on lines legitimately paint over
 * the runway) < hold bars +0.12 — 20 mm separations, no coplanar pairs.
 *
 * Known limitation (recorded): geometry is laid flat at field elevation —
 * terrain flattening only covers the runway corridor, so at hilly fields
 * distant taxiways can sink/float. Flat major airports render true.
 */

/** Real taxiway-ident segment midpoints per airport (airport-local
 *  meters) — consumed by ground control's route naming (N7). */
export const osmIdentSegs = new Map<string, { ref: string; x: number; z: number }[]>()

const TAXI = new THREE.MeshStandardMaterial({ color: 0x3c4043, roughness: 0.95 })
const SIGN_FACE = new THREE.MeshBasicMaterial({ color: 0x1a1a08 })
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
  runways?: { la1: number; lo1: number; la2: number; lo2: number }[],
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
  // N7 route naming: every ident'd segment's midpoint.
  const segRegistry: { ref: string; x: number; z: number }[] = []
  for (const tw of data.tw) {
    if (!tw.r || tw.p.length < 2) continue
    const mid = tw.p[Math.floor(tw.p.length / 2)]!
    const p = toLocal(mid[0], mid[1])
    segRegistry.push({ ref: tw.r, x: p.x, z: p.z })
  }
  osmIdentSegs.set(icao, segRegistry)

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
    m.position.y = elevM + 0.02
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
    appendRibbon(twPos, twIdx, pts, 18, elevM + 0.04)
    appendRibbon(stPos, stIdx, pts, 0.38, elevM + 0.08)
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

  // N9: HOLD-SHORT BARS where real taxiways meet the runway — a taxiway
  // endpoint within 95 m of a runway centerline gets the amber double
  // bar perpendicular to its final segment, at its real position.
  if (runways?.length) {
    const rwLocal = runways.map((r) => ({ a: toLocal(r.la1, r.lo1), b: toLocal(r.la2, r.lo2) }))
    const distToRunway = (p: { x: number; z: number }): number => {
      let best = Infinity
      for (const { a, b } of rwLocal) {
        const dx = b.x - a.x, dz = b.z - a.z
        const len2 = dx * dx + dz * dz || 1
        const t = Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.z - a.z) * dz) / len2))
        best = Math.min(best, Math.hypot(p.x - (a.x + t * dx), p.z - (a.z + t * dz)))
      }
      return best
    }
    const HOLD = new THREE.MeshBasicMaterial({ color: 0xd8b23a })
    let bars = 0
    for (const tw of data.tw) {
      if (tw.p.length < 2 || bars >= 30) continue
      for (const endIdx of [0, tw.p.length - 1]) {
        const end = toLocal(tw.p[endIdx]![0], tw.p[endIdx]![1])
        const d = distToRunway(end)
        if (d > 95) continue
        const prevIdx = endIdx === 0 ? 1 : tw.p.length - 2
        const prev = toLocal(tw.p[prevIdx]![0], tw.p[prevIdx]![1])
        const segLen = Math.hypot(end.x - prev.x, end.z - prev.z) || 1
        const backX = (prev.x - end.x) / segLen
        const backZ = (prev.z - end.z) / segLen
        // Connectors that reach the runway (d≈0) hold ~75 m short of the
        // centerline — the real hold-position setback class for these
        // runways; ends already stopping 25–95 m out get the bar there.
        const setback = d < 25 ? Math.min(75 - d, segLen) : 0
        const bx = end.x + backX * setback
        const bz = end.z + backZ * setback
        const ang = Math.atan2(end.x - prev.x, end.z - prev.z)
        const bar = new THREE.Mesh(new THREE.BoxGeometry(12, 0.02, 1.0), HOLD)
        bar.position.set(bx, elevM + 0.12, bz)
        bar.rotation.y = ang + Math.PI / 2
        osm.add(bar)
        bars++
      }
    }
  }

  // N9: taxiway identifier signs at the real segment locations. One
  // canvas-textured board per DISTINCT ident, placed at the midpoint of
  // that ident's longest segment (real position from the data; board
  // styling is the standard black-on-yellow location sign). Idents come
  // from OSM `ref` tags — segments without one get no sign (recorded).
  const byRef = new Map<string, { pts: { x: number; z: number }[]; len: number }>()
  for (const tw of data.tw) {
    if (!tw.r) continue
    const pts = tw.p.map(([lat, lon]) => toLocal(lat, lon))
    const len = pts.reduce((acc, p, i) => (i ? acc + Math.hypot(p.x - pts[i - 1]!.x, p.z - pts[i - 1]!.z) : 0), 0)
    const prev = byRef.get(tw.r)
    if (!prev || len > prev.len) byRef.set(tw.r, { pts, len })
  }
  let signCount = 0
  for (const [ref, { pts }] of byRef) {
    if (signCount >= 40) continue
    const mid = pts[Math.floor(pts.length / 2)]!
    const canvas = document.createElement('canvas')
    canvas.width = 128
    canvas.height = 64
    const c = canvas.getContext('2d')!
    c.fillStyle = '#d8b23a'
    c.fillRect(0, 0, 128, 64)
    c.fillStyle = '#141405'
    c.font = 'bold 44px sans-serif'
    c.textAlign = 'center'
    c.textBaseline = 'middle'
    c.fillText(ref.slice(0, 4), 64, 34)
    const tex = new THREE.CanvasTexture(canvas)
    const board = new THREE.Mesh(new THREE.PlaneGeometry(2.4, 1.2), new THREE.MeshBasicMaterial({ map: tex, side: THREE.DoubleSide }))
    board.position.set(mid.x + 10, elevM + 1.0, mid.z + 10)
    osm.add(board)
    const post = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.9, 0.12), SIGN_FACE)
    post.position.set(mid.x + 10, elevM + 0.45, mid.z + 10)
    osm.add(post)
    signCount++
  }

  // N9: gate numbers at the REAL stand positions (OSM parking_position
  // refs — stands without a mapped number get nothing; capped at 60).
  let gates = 0
  for (const st of data.st) {
    if (!st.r || gates >= 60 || !st.p.length) continue
    const p = toLocal(st.p[0]![0], st.p[0]![1])
    const canvas = document.createElement('canvas')
    canvas.width = 96
    canvas.height = 48
    const c = canvas.getContext('2d')!
    c.fillStyle = '#20242a'
    c.fillRect(0, 0, 96, 48)
    c.fillStyle = '#e8eaee'
    c.font = 'bold 30px sans-serif'
    c.textAlign = 'center'
    c.textBaseline = 'middle'
    c.fillText(st.r.slice(0, 5), 48, 26)
    const tex = new THREE.CanvasTexture(canvas)
    const board = new THREE.Mesh(new THREE.PlaneGeometry(1.8, 0.9), new THREE.MeshBasicMaterial({ map: tex, side: THREE.DoubleSide }))
    board.position.set(p.x, elevM + 2.4, p.z)
    osm.add(board)
    const post = new THREE.Mesh(new THREE.BoxGeometry(0.1, 2.0, 0.1), SIGN_FACE)
    post.position.set(p.x, elevM + 1.0, p.z)
    osm.add(post)
    gates++
  }

  // Real layout in — retire the procedural taxiway stand-in.
  const stale: THREE.Object3D[] = []
  group.traverse((o) => { if (o.name === 'proceduralTaxi') stale.push(o) })
  for (const o of stale) o.removeFromParent()
  group.add(osm)
}
