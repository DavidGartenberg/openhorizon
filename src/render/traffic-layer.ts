/**
 * Live-traffic rendering (14d): each store target gets a 12b archetype
 * silhouette (geometry cached per ICAO designator, shared material —
 * 1 draw call) plus a 6-point 13c light cluster (1 more call): 40
 * targets ≈ 80 calls, the plan's budget. Attitude is COSMETIC and
 * recorded: heading from track, pitch from vs/gs, roll from track
 * rate — ADS-B carries none of it. Callsign/altitude labels draw on
 * ONE projected 2D canvas overlay (zero GL calls, no DOM churn).
 * Ground targets pin to the terrain; unknown-type ground targets
 * (ops vehicles) are skipped rather than shown as fake airplanes.
 */
import * as THREE from 'three'
import type { LiveTarget } from '../sim/traffic/live'
import { archetypeFor } from '../world/fleet-map'
import { typeInfo, aircraftTypesLoaded } from '../world/aircraft-types'
import { buildArchetype } from './fleet-mesh'
import { beaconOn, strobeOn } from '../sim/lights'
import { lightGlowTexture } from './light-glow'

const FT = 0.3048
const KT = 0.514444

/** Cosmetic attitude from ADS-B kinematics (pure; clamps recorded). */
const PITCH_CLAMP = (12 * Math.PI) / 180
const ROLL_CLAMP = (25 * Math.PI) / 180

export function cosmeticAttitude(gsKt: number, vsFpm: number, trkRateDps: number): { pitchRad: number; rollRad: number } {
  const gsMs = Math.max(gsKt * KT, 1)
  const vsMs = (vsFpm * FT) / 60
  const pitchRad = Math.max(Math.min(Math.atan2(vsMs, gsMs), PITCH_CLAMP), -PITCH_CLAMP)
  // Coordinated-turn roll for the observed turn rate, clamped ±25°.
  const rollRad = Math.max(Math.min(Math.atan(((trkRateDps * Math.PI) / 180) * gsMs / 9.81), ROLL_CLAMP), -ROLL_CLAMP)
  return { pitchRad, rollRad }
}

const NAV_L = new THREE.Color(1, 0.1, 0.08)
const NAV_R = new THREE.Color(0.08, 1, 0.22)
const NAV_TAIL = new THREE.Color(1, 1, 0.92)
const BEACON_RED = new THREE.Color(1, 0.08, 0.06)
const STROBE_WHITE = new THREE.Color(1, 1, 1)
const OFF = new THREE.Color(0, 0, 0)

interface PoolEntry {
  group: THREE.Group
  lights: THREE.BufferAttribute
  typeKey: string
  prevTrkDeg: number
  trkRateDps: number
  phase: number // per-target light phase so strobes don't sync
}

interface ProtoEntry {
  geometry: THREE.BufferGeometry
  material: THREE.Material
  anchors: { wingtipL: THREE.Vector3; wingtipR: THREE.Vector3; tail: THREE.Vector3 }
}

export class TrafficLayer {
  private readonly pool = new Map<string, PoolEntry>()
  private readonly protos = new Map<string, ProtoEntry>()
  private readonly canvas: HTMLCanvasElement
  private readonly ctx: CanvasRenderingContext2D
  private readonly v = new THREE.Vector3()

  constructor(private readonly scene: THREE.Scene) {
    this.canvas = document.createElement('canvas')
    this.canvas.style.cssText = 'position:fixed;inset:0;pointer-events:none;z-index:8'
    document.body.appendChild(this.canvas)
    this.ctx = this.canvas.getContext('2d')!
  }

  private proto(designator: string): ProtoEntry {
    const key = designator || '?'
    let p = this.protos.get(key)
    if (!p) {
      const info = typeInfo(designator)
      const mesh = buildArchetype(archetypeFor(designator, info.desc, info.wtc))
      p = {
        geometry: mesh.geometry,
        material: mesh.material as THREE.Material,
        anchors: mesh.userData.lightAnchors as ProtoEntry['anchors'],
      }
      this.protos.set(key, p)
    }
    return p
  }

  private spawn(t: LiveTarget, unknownGnd = false): PoolEntry {
    // Unknown-type ground targets render as a generic narrowbody
    // silhouette (A320 archetype) — visible parked iron; the datablock
    // stays honest (callsign/hex only, no invented type).
    const p = this.proto(unknownGnd ? 'A320' : t.t)
    const group = new THREE.Group()
    const body = new THREE.Mesh(p.geometry, p.material)
    body.castShadow = false
    group.add(body)
    const a = p.anchors
    const pts = [
      a.wingtipL, a.wingtipR,
      new THREE.Vector3(0, a.tail.y, a.tail.z),
      // Beacon just below the fin-tip anchor (the old tail.z*0.8 scaling
      // floated it off the airframe — same class as the player-ship bug).
      new THREE.Vector3(0, a.tail.y - 0.35, a.tail.z - 0.6),
      new THREE.Vector3(a.wingtipL.x, a.wingtipL.y + 0.15, a.wingtipL.z),
      new THREE.Vector3(a.wingtipR.x, a.wingtipR.y + 0.15, a.wingtipR.z),
    ]
    const pos = new Float32Array(pts.length * 3)
    pts.forEach((v, i) => pos.set([v.x, v.y, v.z], i * 3))
    const geo = new THREE.BufferGeometry()
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3))
    const colors = new THREE.BufferAttribute(new Float32Array(pts.length * 3), 3)
    geo.setAttribute('color', colors)
    const lights = new THREE.Points(geo, new THREE.PointsMaterial({
      map: lightGlowTexture(), size: 1.6, sizeAttenuation: true, vertexColors: true,
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
    }))
    lights.frustumCulled = false
    group.add(lights)
    this.scene.add(group)
    const entry: PoolEntry = {
      group, lights: colors, typeKey: t.t || '?',
      prevTrkDeg: t.trkDeg, trkRateDps: 0,
      phase: (parseInt(t.id, 16) % 997) / 997 * 3,
    }
    this.pool.set(t.id, entry)
    return entry
  }

  /** Per-frame: place/orient/light every target, draw the label overlay. */
  update(
    targets: Iterable<LiveTarget>,
    toLocal: (lat: number, lon: number) => { n: number; e: number },
    elevAtM: (lat: number, lon: number) => number,
    camera: THREE.Camera,
    tS: number,
    dtS: number,
  ): void {
    if (!aircraftTypesLoaded()) return
    const seen = new Set<string>()
    const labels: Array<{ x: number; y: number; z: number; text: string }> = []
    for (const t of targets) {
      // Ops vehicles: on the ground with a type the registry doesn't
      // know — skip rather than draw a fake airplane (recorded).
      // N6: unknown-type GROUND targets used to be skipped entirely —
      // airports looked empty of parked iron even with live data. Render
      // them as a generic narrowbody silhouette; the datablock stays
      // honest (callsign/hex only, no invented type).
      const unknownGnd = t.gnd && !typeInfo(t.t).desc
      const local = toLocal(t.lat, t.lon)
      // Beyond 25 km a silhouette is sub-pixel — skip the draw calls
      // (the store keeps the target; TCAS/MFD still see it).
      if (Math.hypot(local.n, local.e) > 25_000) continue
      seen.add(t.id)
      let e = this.pool.get(t.id)
      if (!e) e = this.spawn(t, unknownGnd)
      const terrainY = elevAtM(t.lat, t.lon)
      const y = t.gnd ? terrainY + 0.8 : Math.max(t.altFt * FT, terrainY + 2)
      e.group.position.set(local.e, y, -local.n)
      // Track rate (smoothed) → cosmetic roll; heading from track.
      if (dtS > 0) {
        let d = t.trkDeg - e.prevTrkDeg
        if (d > 180) d -= 360
        if (d < -180) d += 360
        const inst = d / dtS
        e.trkRateDps += (inst - e.trkRateDps) * Math.min(dtS / 1.5, 1)
        e.prevTrkDeg = t.trkDeg
      }
      const att = cosmeticAttitude(t.gsKt, t.vsFpm, t.gnd ? 0 : e.trkRateDps)
      e.group.rotation.set(0, 0, 0)
      e.group.rotateY(-(t.trkDeg * Math.PI) / 180)
      e.group.rotateX(t.gnd ? 0 : att.pitchRad)
      e.group.rotateZ(-att.rollRad)
      // 13c lights with a per-target phase.
      const tp = tS + e.phase
      const set = (i: number, c: THREE.Color, on: boolean): void => {
        const cc = on ? c : OFF
        e!.lights.setXYZ(i, cc.r, cc.g, cc.b)
      }
      set(0, NAV_L, true)
      set(1, NAV_R, true)
      set(2, NAV_TAIL, true)
      set(3, BEACON_RED, beaconOn(tp))
      const s = strobeOn(tp) && !t.gnd
      set(4, STROBE_WHITE, s)
      set(5, STROBE_WHITE, s)
      e.lights.needsUpdate = true
      labels.push({
        x: local.e, y: y + 6, z: -local.n,
        text: `${t.cs || t.id} ${t.gnd ? 'GND' : `${Math.round(t.altFt / 100)}${t.vsFpm > 300 ? '↑' : t.vsFpm < -300 ? '↓' : ''}`}`,
      })
    }
    // Despawn departed targets (shared proto geometry stays cached).
    for (const [id, e] of this.pool) {
      if (!seen.has(id)) {
        this.scene.remove(e.group)
        ;(e.group.children[1] as THREE.Points | undefined)?.geometry.dispose()
        this.pool.delete(id)
      }
    }
    this.drawLabels(labels, camera)
  }

  private drawLabels(labels: Array<{ x: number; y: number; z: number; text: string }>, camera: THREE.Camera): void {
    const w = window.innerWidth
    const h = window.innerHeight
    if (this.canvas.width !== w || this.canvas.height !== h) {
      this.canvas.width = w
      this.canvas.height = h
    }
    const ctx = this.ctx
    ctx.clearRect(0, 0, w, h)
    ctx.font = '11px ui-monospace, monospace'
    ctx.textBaseline = 'middle'
    const camPos = (camera as THREE.PerspectiveCamera).position
    for (const l of labels) {
      const dx = l.x - camPos.x
      const dy = l.y - camPos.y
      const dz = l.z - camPos.z
      if (dx * dx + dy * dy + dz * dz > 20_000 ** 2) continue // label range 20 km
      this.v.set(l.x, l.y, l.z).project(camera)
      if (this.v.z > 1 || this.v.z < -1) continue // behind/clipped
      const sx = ((this.v.x + 1) / 2) * w
      const sy = ((1 - this.v.y) / 2) * h
      if (sx < -80 || sx > w + 80 || sy < -20 || sy > h + 20) continue
      ctx.fillStyle = 'rgba(0,10,16,0.55)'
      const tw = ctx.measureText(l.text).width
      ctx.fillRect(sx + 6, sy - 8, tw + 8, 16)
      ctx.fillStyle = '#9fe8ff'
      ctx.fillText(l.text, sx + 10, sy)
    }
  }
}
