import * as THREE from 'three'
import { FT } from '../sim/atmosphere'
import { distanceM, bearingDeg, flattenForRunway, type LatLon } from '../math/geo'
import type { WorldFrame, RunwayFlatten } from './tiles'
import { buildRunwayMarkings, buildDistanceSigns, buildTaxiwayComplex, type RunwayLocal } from './airport-detail'
import { airportBeacon } from '../sim/lights'
import { lightGlowTexture } from '../render/light-glow'

export interface RunwayData {
  li: string
  hi: string
  la1: number
  lo1: number
  la2: number
  lo2: number
  e1: number // ft
  e2: number
  l: number // ft
  w: number
  s: number // 0 hard, 1 soft
  lt: number
}

export interface AirportData {
  i: string
  n: string
  la: number
  lo: number
  e: number
  t: number // 0 small, 1 medium, 2 large
  r: RunwayData[]
}

const ASPHALT = new THREE.MeshStandardMaterial({ color: 0x35383c, roughness: 0.95 })
const TURF = new THREE.MeshStandardMaterial({ color: 0x3c5233, roughness: 1 })
const STRIPE = new THREE.MeshBasicMaterial({ color: 0xd8d8d0 })
const EDGE_LIGHT = new THREE.MeshBasicMaterial({ color: 0xffffff })
const SOCK_ORANGE = new THREE.MeshStandardMaterial({ color: 0xe8641b, roughness: 0.8 })
const MAST = new THREE.MeshStandardMaterial({ color: 0x2a2d31, roughness: 0.9 })

/** 13c: one additive Points cloud per airport (edge white, threshold
 *  green / end red, floodlit windsock) faded in by night, plus the
 *  white/green rotating beacon flashed by sim/lights cadence. */
interface NightLights {
  pts: THREE.Points | null
  beacon: THREE.Points | null
}

export class Airports {
  private all: AirportData[] = []
  private readonly cells = new Map<string, AirportData[]>()
  private readonly rendered = new Map<string, THREE.Group>()
  loaded = false

  constructor(private readonly scene: THREE.Scene, private readonly frame: WorldFrame) {}

  async load(): Promise<void> {
    const res = await fetch('/api/airports.json')
    if (!res.ok) throw new Error(`airports: HTTP ${res.status}`)
    this.all = (await res.json()) as AirportData[]
    for (const ap of this.all) {
      const key = `${Math.floor(ap.la * 2)},${Math.floor(ap.lo * 2)}`
      let arr = this.cells.get(key)
      if (!arr) this.cells.set(key, (arr = []))
      arr.push(ap)
    }
    this.loaded = true
  }

  near(lat: number, lon: number, radiusM: number): AirportData[] {
    const dCell = radiusM / 55_000 + 1
    const out: AirportData[] = []
    for (let a = Math.floor((lat - dCell / 2) * 2); a <= Math.floor((lat + dCell / 2) * 2); a++) {
      for (let b = Math.floor((lon - dCell) * 2); b <= Math.floor((lon + dCell) * 2); b++) {
        for (const ap of this.cells.get(`${a},${b}`) ?? []) {
          if (distanceM({ lat, lon }, { lat: ap.la, lon: ap.lo }) <= radiusM) out.push(ap)
        }
      }
    }
    return out
  }

  find(query: string): AirportData | undefined {
    const q = query.trim().toUpperCase()
    return (
      this.all.find((a) => a.i === q) ??
      this.all.find((a) => a.i === `K${q}`) ??
      this.all.find((a) => a.n.toUpperCase().includes(q))
    )
  }

  runwaysInBounds(latS: number, latN: number, lonW: number, lonE: number): RunwayFlatten[] {
    const out: RunwayFlatten[] = []
    const cLat = (latS + latN) / 2
    const cLon = (lonW + lonE) / 2
    for (const ap of this.near(cLat, cLon, distanceM({ lat: latS, lon: lonW }, { lat: latN, lon: lonE }) / 2 + 4000)) {
      for (const r of ap.r) {
        out.push({
          la1: r.la1, lo1: r.lo1, la2: r.la2, lo2: r.lo2,
          e1M: r.e1 * FT, e2M: r.e2 * FT,
          halfWidthM: Math.max((r.w * FT) / 2, 12),
        })
      }
    }
    return out
  }

  /** Physics-side flattening — must match the worker's mesh flattening. */
  flattenElevation(terrainM: number, lat: number, lon: number): number {
    let h = terrainM
    for (const ap of this.near(lat, lon, 6000)) {
      for (const r of ap.r) {
        // Work in a small local meter frame around the sample.
        const mLat = 111_319.5
        const mLon = mLat * Math.cos((lat * Math.PI) / 180)
        h = flattenForRunway(
          h, 0, 0,
          (r.lo1 - lon) * mLon, (r.la1 - lat) * mLat,
          (r.lo2 - lon) * mLon, (r.la2 - lat) * mLat,
          r.e1 * FT, r.e2 * FT,
          Math.max((r.w * FT) / 2, 12),
        )
      }
    }
    return h
  }

  /** Build/refresh runway visuals near the aircraft. */
  updateVisuals(lat: number, lon: number): void {
    if (!this.loaded) return
    const nearby = this.near(lat, lon, 60_000)
    const wanted = new Set(nearby.map((a) => a.i))
    for (const [icao, group] of this.rendered) {
      if (!wanted.has(icao)) {
        this.scene.remove(group)
        group.traverse((o) => {
          if (o instanceof THREE.Mesh) o.geometry.dispose()
        })
        this.rendered.delete(icao)
      }
    }
    for (const ap of nearby) {
      if (!this.rendered.has(ap.i)) this.rendered.set(ap.i, this.buildAirport(ap))
    }
    this.positionAll()
  }

  private buildAirport(ap: AirportData): THREE.Group {
    const group = new THREE.Group()
    group.userData.latLon = { lat: ap.la, lon: ap.lo }
    // 13c night-light accumulator: [x,y,z] + [r,g,b] per point.
    const nPos: number[] = []
    const nCol: number[] = []
    const addLight = (x: number, y: number, z: number, r: number, g: number, b: number): void => {
      nPos.push(x, y, z)
      nCol.push(r, g, b)
    }
    let anyLighted = false
    for (const r of ap.r) {
      const lenM = r.l * FT
      const widM = Math.max(r.w * FT, 8)
      const hdg = (bearingDeg({ lat: r.la1, lon: r.lo1 }, { lat: r.la2, lon: r.lo2 }) * Math.PI) / 180
      // Runway strip in the group's local frame (group origin = airport ref).
      const mLat = 111_319.5
      const mLon = mLat * Math.cos((ap.la * Math.PI) / 180)
      const cx = (((r.lo1 + r.lo2) / 2 - ap.lo) * mLon)
      const cy = (((r.la1 + r.la2) / 2 - ap.la) * mLat)
      const e1M = r.e1 * FT
      const e2M = r.e2 * FT
      const elevM = (e1M + e2M) / 2
      const elevAt = (t: number) => e1M + (t + 0.5) * (e2M - e1M) // t ∈ [-0.5, 0.5]
      // Slope the strip to match the physics flatten plane (real runways
      // have grade — KHAF is 23 ft end to end; a flat slab buries the plane).
      const stripGeo = new THREE.PlaneGeometry(widM, lenM, 1, 1)
      const pos = stripGeo.attributes.position!
      for (let v = 0; v < pos.count; v++) {
        const t = pos.getY(v) / lenM // ±0.5 along length
        pos.setZ(v, elevAt(t) - elevM)
      }
      stripGeo.computeVertexNormals()
      const strip = new THREE.Mesh(stripGeo, r.s === 0 ? ASPHALT : TURF)
      strip.receiveShadow = true // 13a: pavement catches the sun shadow
      strip.rotation.x = -Math.PI / 2
      strip.rotation.z = -hdg
      strip.position.set(cx, elevM + 0.06, -cy)
      strip.renderOrder = 20
      group.add(strip)
      if (r.s === 0) {
        // Centerline dashes.
        const nDash = Math.max(Math.floor(lenM / 60), 2)
        const dashes = new THREE.InstancedMesh(new THREE.PlaneGeometry(0.9, 25), STRIPE, nDash)
        const m4 = new THREE.Matrix4()
        const rotM = new THREE.Matrix4().makeRotationX(-Math.PI / 2).premultiply(new THREE.Matrix4().makeRotationY(-hdg))
        for (let k = 0; k < nDash; k++) {
          const t = (k + 0.5) / nDash - 0.5
          m4.copy(rotM).setPosition(
            cx + Math.sin(hdg) * t * lenM,
            elevAt(t) + 0.14,
            -(cy + Math.cos(hdg) * t * lenM),
          )
          dashes.setMatrixAt(k, m4)
        }
        dashes.renderOrder = 21
        group.add(dashes)
      }
      if (r.s === 0 && lenM >= 900) {
        // 13a′: FAA markings + distance boards + (longest paved runway
        // only) the procedural taxiway/apron/terminal complex.
        const rl: RunwayLocal = {
          lenM, widM,
          liIdent: r.li, hiIdent: r.hi,
          elevAt: (t) => elevAt(Math.max(-0.5, Math.min(0.5, t))) - elevM,
        }
        const detail = new THREE.Group()
        detail.add(buildRunwayMarkings(rl))
        detail.add(buildDistanceSigns(rl))
        const isLongest = ap.r.every((o) => o.l <= r.l)
        if (isLongest && lenM >= 1100) {
          detail.add(buildTaxiwayComplex(rl, lenM >= 2130))
        }
        detail.rotation.y = -hdg
        detail.position.set(cx, elevM + 0.02, -cy)
        group.add(detail)
      }
      if (r.lt === 1) {
        anyLighted = true
        // Edge lights every ~60 m both sides.
        const nL = Math.max(Math.floor(lenM / 60) * 2, 4)
        const lights = new THREE.InstancedMesh(new THREE.SphereGeometry(0.35, 6, 6), EDGE_LIGHT, nL)
        const m4 = new THREE.Matrix4()
        let k = 0
        for (let s = 0; k < nL && s < nL / 2; s++) {
          const t = (s + 0.5) / (nL / 2) - 0.5
          for (const side of [-1, 1]) {
            const ex = cx + Math.sin(hdg) * t * lenM + Math.cos(hdg) * side * (widM / 2 + 1.5)
            const ey = elevAt(t) + 0.55
            const ez = -(cy + Math.cos(hdg) * t * lenM) + Math.sin(hdg) * side * (widM / 2 + 1.5)
            m4.makeTranslation(ex, ey, ez)
            lights.setMatrixAt(k++, m4)
            addLight(ex, ey + 0.15, ez, 1, 0.97, 0.88) // MIRL white glow at night
          }
        }
        group.add(lights)
        // Threshold bars (13c): green row facing the arrival just outside
        // each end, red end row just inside — approximating bidirectional
        // threshold/end lenses with two colocated rows (recorded).
        for (const end of [-0.5, 0.5]) {
          const dirOut = Math.sign(end)
          const tGreen = end + dirOut * (3 / lenM)
          const tRed = end - dirOut * (3 / lenM)
          for (let i = 0; i < 6; i++) {
            const w = ((i + 0.5) / 6 - 0.5) * widM
            for (const [t, col] of [[tGreen, [0.1, 1, 0.3]], [tRed, [1, 0.12, 0.1]]] as const) {
              addLight(
                cx + Math.sin(hdg) * t * lenM + Math.cos(hdg) * w,
                elevAt(Math.max(-0.5, Math.min(0.5, t))) + 0.5,
                -(cy + Math.cos(hdg) * t * lenM) + Math.sin(hdg) * w,
                col[0], col[1], col[2],
              )
            }
          }
        }
      }
    }
    // Windsock at the airport reference point.
    const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, 5, 6), EDGE_LIGHT)
    pole.position.set(30, ap.e * FT + 2.5, 30)
    group.add(pole)
    const sock = new THREE.Mesh(new THREE.ConeGeometry(0.32, 1.8, 8), SOCK_ORANGE)
    sock.position.set(30, ap.e * FT + 5, 30)
    sock.rotation.z = Math.PI / 2
    group.add(sock)
    if (anyLighted) addLight(30, ap.e * FT + 5.7, 30, 1, 0.85, 0.58) // floodlit sock

    // 13c: assemble the night layer.
    const night: NightLights = { pts: null, beacon: null }
    if (nPos.length > 0) {
      const geo = new THREE.BufferGeometry()
      geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(nPos), 3))
      geo.setAttribute('color', new THREE.BufferAttribute(new Float32Array(nCol), 3))
      // Constant pixel size: real airport lights read as bright points for
      // miles — perspective attenuation would sink them below a pixel.
      night.pts = new THREE.Points(geo, new THREE.PointsMaterial({
        map: lightGlowTexture(), size: 3.5, sizeAttenuation: false, vertexColors: true,
        transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending,
      }))
      night.pts.renderOrder = 30
      group.add(night.pts)
    }
    if (anyLighted) {
      // Rotating beacon on a midfield mast by the windsock (real beacon
      // sites aren't in the free data — recorded).
      const mast = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.16, 11, 6), MAST)
      mast.position.set(24, ap.e * FT + 5.5, 30)
      group.add(mast)
      const bGeo = new THREE.BufferGeometry()
      bGeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array([24, ap.e * FT + 11.4, 30]), 3))
      night.beacon = new THREE.Points(bGeo, new THREE.PointsMaterial({
        map: lightGlowTexture(), size: 10, sizeAttenuation: false, color: 0xffffff,
        transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending,
      }))
      night.beacon.frustumCulled = false // single point, flashes across miles
      night.beacon.renderOrder = 30
      group.add(night.beacon)
    }
    group.userData.night = night
    this.scene.add(group)
    return group
  }

  /** Per-frame 13c: fade the steady lights with darkness, flash the
   *  beacon white/green on the AIM cadence (sim-time driven). */
  updateNight(tS: number, night: number): void {
    for (const group of this.rendered.values()) {
      const nl = group.userData.night as NightLights | undefined
      if (!nl) continue
      if (nl.pts) (nl.pts.material as THREE.PointsMaterial).opacity = night
      if (nl.beacon) {
        const mat = nl.beacon.material as THREE.PointsMaterial
        const phase = airportBeacon(tS)
        mat.opacity = phase && night > 0.05 ? Math.min(night * 1.6, 1) : 0
        if (phase === 'green') mat.color.setRGB(0.15, 1, 0.3)
        else mat.color.setRGB(1, 1, 0.92)
      }
    }
  }

  /** Reposition all rendered airports (call every frame — cheap — and after rebase). */
  positionAll(): void {
    for (const group of this.rendered.values()) {
      const ll = group.userData.latLon as LatLon
      const p = this.frame.toLocal(ll.lat, ll.lon)
      group.position.set(p.e, 0, -p.n)
    }
  }
}
