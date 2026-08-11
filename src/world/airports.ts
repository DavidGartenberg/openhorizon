import * as THREE from 'three'
import { FT } from '../sim/atmosphere'
import { distanceM, bearingDeg, flattenForRunway, type LatLon } from '../math/geo'
import type { WorldFrame, RunwayFlatten } from './tiles'
import { buildRunwayMarkings, buildDistanceSigns, buildTaxiwayComplex, dimPaintForNight, type RunwayLocal } from './airport-detail'
import { airportBeacon, rabbitOn } from '../sim/lights'
import { lightGlowTexture } from '../render/light-glow'
import { PAPI_ANGLES_DEG, papiAngleDeg, papiWhiteCount } from './papi'

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
const STRIPE_BASE = 0xd8d8d0
const EDGE_SPHERE_BASE = 0xffffff
const SOCK_ORANGE = new THREE.MeshStandardMaterial({ color: 0xe8641b, roughness: 0.8 })
const MAST = new THREE.MeshStandardMaterial({ color: 0x2a2d31, roughness: 0.9 })
/** 13d PAPI boxes: constant-pixel additive glow points, on day and night. */
const PAPI_MAT = new THREE.PointsMaterial({
  map: lightGlowTexture(), size: 5, sizeAttenuation: false, vertexColors: true,
  transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
})

/** 13c: one additive Points cloud per airport (edge white, threshold
 *  green / end red, floodlit windsock) faded in by night, plus the
 *  white/green rotating beacon flashed by sim/lights cadence. */
interface NightLights {
  pts: THREE.Points | null
  beacon: THREE.Points | null
  /** 16c sequenced approach flashers: per-point station index. */
  rabbit: THREE.Points | null
  rabbitStations: number[]
}

/** 13d: one 4-box PAPI array per qualifying runway end. Colors are
 *  recomputed each frame from the CAMERA's elevation angle to the
 *  array (what the lens sees is what a pilot's eye would see). */
interface PapiArray {
  colors: THREE.BufferAttribute
  /** Array center in airport-group-local coords. */
  baseX: number
  baseY: number
  baseZ: number
  /** Unit vector (x,z) pointing from the array out along the approach. */
  outX: number
  outZ: number
  /** Per-box setting angle, box order matching the vertex order. */
  boxAngles: number[]
  rwyIdent: string
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
        // 17a: wrap longitude cells across the dateline.
        const bw = b >= 360 ? b - 720 : b < -360 ? b + 720 : b
        for (const ap of this.cells.get(`${a},${bw}`) ?? []) {
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
    const papis: PapiArray[] = []
    const rabbitPos: number[] = []
    const rabbitStations: number[] = []
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
          // 16c: collect taxiway blue-edge lights (detail-local frame)
          // and transform them into the airport group's frame.
          const blues: THREE.Vector3[] = []
          detail.add(buildTaxiwayComplex(rl, lenM >= 2130, r.lt === 1 ? blues : undefined))
          const yAxis = new THREE.Vector3(0, 1, 0)
          for (const v of blues) {
            v.applyAxisAngle(yAxis, -hdg)
            addLight(cx + v.x, elevM + 0.02 + v.y, -cy + v.z, 0.2, 0.35, 1)
          }
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
        // PAPI (13d): 4-box array on the left of each approach, 300 m in
        // from the threshold. Placement heuristic: lighted paved ≥4,000 ft
        // (no lighting-inventory field in the free data — recorded).
        if (r.s === 0 && r.l >= 4000) {
          const along = { x: Math.sin(hdg), z: -Math.cos(hdg) }
          for (const end of [-1, 1] as const) {
            const t = end === -1 ? -0.5 + 300 / lenM : 0.5 - 300 / lenM
            const y = elevAt(t) + 0.6
            const pos = new Float32Array(12)
            const boxAngles: number[] = []
            for (let i = 0; i < 4; i++) {
              // Innermost box carries the steepest angle: on-slope shows
              // the white pair outboard, red pair inboard (AIM 2-1-2).
              const w = end * (widM / 2 + 15 + i * 9)
              pos[i * 3] = cx + Math.sin(hdg) * t * lenM + Math.cos(hdg) * w
              pos[i * 3 + 1] = y
              pos[i * 3 + 2] = -(cy + Math.cos(hdg) * t * lenM) + Math.sin(hdg) * w
              boxAngles.push(PAPI_ANGLES_DEG[3 - i]!)
            }
            const geo = new THREE.BufferGeometry()
            geo.setAttribute('position', new THREE.BufferAttribute(pos, 3))
            const colors = new THREE.BufferAttribute(new Float32Array(12), 3)
            geo.setAttribute('color', colors)
            const pts = new THREE.Points(geo, PAPI_MAT)
            pts.frustumCulled = false // four points, colored per frame
            pts.renderOrder = 30
            group.add(pts)
            papis.push({
              colors,
              baseX: (pos[0]! + pos[9]!) / 2, baseY: y, baseZ: (pos[2]! + pos[11]!) / 2,
              // Toward this array's own approach: the HE-end array (end=+1)
              // serves pilots BEYOND the HE threshold, i.e. further along
              // +`along` (LE→HE) — so out = +end·along. The previous
              // `-end` baffled every array toward the runway interior:
              // approaching pilots saw their own PAPI dark while the
              // reciprocal end's (constant-pixel, so distance-invisible)
              // shone at them — caught at RJTT 34R when the azimuth-gated
              // hook returned 16L/23/05, never 34R.
              outX: end * along.x, outZ: end * along.z,
              boxAngles,
              rwyIdent: end === -1 ? r.li : r.hi,
            })
          }
        }
        // Approach light bars (16c): MALSR-style — seven 5-light bars at
        // 200 ft (61 m) stations on the extended centerline of each end
        // of long lighted runways (>=6,000 ft), with sequenced flashers
        // ("the rabbit") on the outer five stations. Heuristic placement
        // (no ALS inventory in the free data — recorded); elevation
        // extrapolates the runway plane (frangible masts).
        if (r.l >= 6000) {
          for (const end of [-1, 1] as const) {
            for (let k = 1; k <= 7; k++) {
              const t = end * (0.5 + (61 * k) / lenM)
              const ey = e1M + (t + 0.5) * (e2M - e1M) + 1
              for (let b = -2; b <= 2; b++) {
                addLight(
                  cx + Math.sin(hdg) * t * lenM + Math.cos(hdg) * b * 2.25,
                  ey,
                  -(cy + Math.cos(hdg) * t * lenM) + Math.sin(hdg) * b * 2.25,
                  1, 0.97, 0.9,
                )
              }
              if (k >= 3) {
                rabbitPos.push(
                  cx + Math.sin(hdg) * t * lenM,
                  ey + 0.3,
                  -(cy + Math.cos(hdg) * t * lenM),
                )
                rabbitStations.push(7 - k) // station 0 = outermost
              }
            }
          }
        }
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
    const night: NightLights = { pts: null, beacon: null, rabbit: null, rabbitStations: [] }
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
    if (rabbitPos.length > 0) {
      const rGeo = new THREE.BufferGeometry()
      rGeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(rabbitPos), 3))
      const rCol = new THREE.BufferAttribute(new Float32Array(rabbitPos.length), 3)
      rGeo.setAttribute('color', rCol)
      night.rabbit = new THREE.Points(rGeo, new THREE.PointsMaterial({
        map: lightGlowTexture(), size: 6, sizeAttenuation: false, vertexColors: true,
        transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending,
      }))
      night.rabbit.frustumCulled = false
      night.rabbit.renderOrder = 30
      night.rabbitStations = rabbitStations
      group.add(night.rabbit)
    }
    group.userData.night = night
    group.userData.papis = papis
    this.scene.add(group)
    return group
  }

  /** Per-frame 13d: color every PAPI box from the camera's elevation
   *  angle to its array — white above the box angle, red below; dark
   *  outside the ±35° approach-azimuth window (real units are baffled). */
  updatePapi(camX: number, camY: number, camZ: number): void {
    for (const group of this.rendered.values()) {
      const papis = group.userData.papis as PapiArray[] | undefined
      if (!papis) continue
      for (const p of papis) {
        const dx = camX - (group.position.x + p.baseX)
        const dy = camY - (group.position.y + p.baseY)
        const dz = camZ - (group.position.z + p.baseZ)
        const horiz = Math.hypot(dx, dz)
        const inBeam = horiz > 1 && (dx / horiz) * p.outX + (dz / horiz) * p.outZ > 0.819
        const angle = papiAngleDeg(horiz, dy)
        for (let i = 0; i < 4; i++) {
          if (!inBeam) p.colors.setXYZ(i, 0, 0, 0)
          else if (angle > p.boxAngles[i]!) p.colors.setXYZ(i, 1, 1, 0.95)
          else p.colors.setXYZ(i, 1, 0.1, 0.08)
        }
        p.colors.needsUpdate = true
      }
    }
  }

  /** Nearest PAPI to a world position (13d acceptance hook): the
   *  navigation-truth readout from the AIRCRAFT, independent of the
   *  camera-facing render colors. */
  nearestPapi(x: number, y: number, z: number): { icao: string; rwy: string; angleDeg: number; whites: number; distM: number } | null {
    let best: { icao: string; rwy: string; angleDeg: number; whites: number; distM: number } | null = null
    for (const [icao, group] of this.rendered) {
      const papis = group.userData.papis as PapiArray[] | undefined
      if (!papis) continue
      for (const p of papis) {
        const dx = x - (group.position.x + p.baseX)
        const dy = y - (group.position.y + p.baseY)
        const dz = z - (group.position.z + p.baseZ)
        const horiz = Math.hypot(dx, dz)
        // Same ±35° approach-azimuth baffle as `updatePapi`: a pilot can
        // only read an array that is showing them light. Without this, an
        // RJTT 34R acceptance flight "read" runway 05's array (78°
        // off-axis, rendered dark) as it became the geometrically nearest
        // — the display was honest, the telemetry hook was not.
        const inBeam = horiz > 1 && (dx / horiz) * p.outX + (dz / horiz) * p.outZ > 0.819
        if (!inBeam) continue
        const dist = Math.hypot(horiz, dy)
        if (best && dist >= best.distM) continue
        const angle = papiAngleDeg(horiz, dy)
        best = { icao, rwy: p.rwyIdent, angleDeg: +angle.toFixed(3), whites: papiWhiteCount(angle), distM: Math.round(dist) }
      }
    }
    return best
  }

  /** Per-frame 13c: fade the steady lights with darkness, flash the
   *  beacon white/green on the AIM cadence (sim-time driven). */
  updateNight(tS: number, night: number): void {
    // 16c: dim the unlit painted markings with darkness (signs stay
    // bright — real ones are illuminated).
    dimPaintForNight(night)
    const paintF = 1 - 0.78 * night
    STRIPE.color.setHex(STRIPE_BASE).multiplyScalar(paintF)
    EDGE_LIGHT.color.setHex(EDGE_SPHERE_BASE).multiplyScalar(1 - 0.55 * night)
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
      if (nl.rabbit) {
        const mat = nl.rabbit.material as THREE.PointsMaterial
        mat.opacity = night
        const col = nl.rabbit.geometry.getAttribute('color') as THREE.BufferAttribute
        for (let i = 0; i < nl.rabbitStations.length; i++) {
          const on = rabbitOn(tS, nl.rabbitStations[i]!, 5)
          col.setXYZ(i, on ? 1 : 0, on ? 1 : 0, on ? 0.95 : 0)
        }
        col.needsUpdate = true
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
