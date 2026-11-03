import * as THREE from 'three'
import { beforeAll, describe, expect, it } from 'vitest'
import { installCanvasStub } from './canvas-stub'
import { buildCabin737, cabinWallLat, cabinWindows, CABIN, type Cabin737 } from '../../src/render/cabin-737'
import { setInteriorFill } from '../../src/render/cockpit-737'
import { buildB738 } from '../../src/render/aircraft-mesh'
import { cockpitProfile } from '../../src/render/cockpit-profile'
import { CockpitCamera, EYE_BY_LAYOUT } from '../../src/render/cockpit-camera'
import { B738 } from '../../src/sim/aircraft/b738'

/** Visit every world-space vertex, expanding instanced meshes. */
function forEachVertex(root: THREE.Object3D, fn: (v: THREE.Vector3, o: THREE.Mesh) => void): void {
  root.updateMatrixWorld(true)
  const v = new THREE.Vector3(), m = new THREE.Matrix4(), inst = new THREE.Matrix4()
  root.traverse((o) => {
    if (!(o instanceof THREE.Mesh)) return
    const pos = o.geometry.getAttribute('position') as THREE.BufferAttribute
    const mats = o instanceof THREE.InstancedMesh
      ? Array.from({ length: o.count }, (_, k) => { o.getMatrixAt(k, inst); return m.clone().multiplyMatrices(o.matrixWorld, inst) })
      : [o.matrixWorld]
    for (const mw of mats) for (let i = 0; i < pos.count; i++) fn(v.fromBufferAttribute(pos, i).applyMatrix4(mw), o)
  })
}

let cabin: Cabin737
let skin: { cy: number; r: number }

beforeAll(() => {
  installCanvasStub()
  cabin = buildCabin737()
  // Measure the real fuselage barrel the cabin must fit inside.
  const ship = buildB738()
  const shell = ship.group.getObjectByName('continuousJetSkin') as THREE.Mesh
  let minY = Infinity, maxY = -Infinity
  forEachVertex(shell, (v) => {
    if (v.z < -CABIN.frontFwd - 0.2 || v.z > -CABIN.aftFwd + 0.05) return
    minY = Math.min(minY, v.y); maxY = Math.max(maxY, v.y)
  })
  skin = { cy: (minY + maxY) / 2, r: (maxY - minY) / 2 }
})

describe('737-800 passenger cabin', () => {
  it('sits entirely inside the B738 fuselage barrel, behind the flight deck', () => {
    expect(skin.r).toBeGreaterThan(1.85)
    expect(Math.abs(skin.cy - CABIN.axisY)).toBeLessThan(0.02)
    let worst = 0, n = 0, minZ = Infinity, maxZ = -Infinity
    forEachVertex(cabin.group, (v) => {
      expect(Number.isFinite(v.x + v.y + v.z)).toBe(true)
      worst = Math.max(worst, Math.hypot(v.x, v.y - skin.cy))
      minZ = Math.min(minZ, v.z); maxZ = Math.max(maxZ, v.z)
      n++
    })
    expect(n).toBeGreaterThan(1000)
    expect(worst).toBeLessThan(skin.r - 0.004)
    // Nothing reaches forward into the deck, nothing aft into the tail taper.
    expect(minZ).toBeGreaterThan(-CABIN.frontFwd - 0.13)
    expect(maxZ).toBeLessThan(-CABIN.aftFwd + 0.02)
  }, 30_000) // walks ~600k instanced vertices; generous under CPU load

  it('seats a 3-3 layout with real knee room between rows', () => {
    expect(cabin.seats).toBe(CABIN.rows * 6)
    const fabric = cabin.group.children.find((o) => o instanceof THREE.InstancedMesh && (o.material as THREE.Material).name === 'seatFabric') as THREE.InstancedMesh
    expect(fabric.count).toBe(cabin.seats)
    fabric.geometry.computeBoundingBox()
    const seat = fabric.geometry.boundingBox!
    const depth = seat.max.z - seat.min.z
    expect(CABIN.rowPitch - depth).toBeGreaterThan(0.2)
    // Aisle stays clear between the aisle seats.
    expect(CABIN.seatLats[3] - (seat.max.x - seat.min.x) / 2).toBeGreaterThan(0.25)
  })

  it('cuts real window openings, none through the entry doors', () => {
    const wins = cabinWindows()
    expect(cabin.windows).toBe(wins.length * 2)
    expect(wins.length).toBeGreaterThanOrEqual(12)
    for (const f0 of wins) {
      const overlapsDoor = f0 > CABIN.doorFwd[1] && f0 - CABIN.windowW < CABIN.doorFwd[0]
      expect(overlapsDoor).toBe(false)
    }
    const ray = new THREE.Raycaster()
    const yc = CABIN.windowBottom + 0.06 // below any lowered shade
    for (const side of [-1, 1]) {
      for (const f0 of wins) {
        const fc = f0 - CABIN.windowW / 2
        const start = new THREE.Vector3(side * (cabinWallLat(yc) - 0.03), yc, -fc)
        const out = new THREE.Vector3(side * cabinWallLat(yc), yc - CABIN.axisY, 0).normalize()
        ray.set(start, out)
        expect(ray.intersectObject(cabin.group, true)).toEqual([])
      }
      // Control: halfway between two windows the wall is solid.
      const pillar = wins[0]! - CABIN.windowW - (CABIN.windowPitch - CABIN.windowW) / 2
      ray.set(new THREE.Vector3(side * (cabinWallLat(yc) - 0.03), yc, -pillar), new THREE.Vector3(side, 0.05, 0).normalize())
      expect(ray.intersectObject(cabin.group, true).length).toBeGreaterThan(0)
    }
  })

  it('leaves a clear sight line from the flight deck down the aisle', () => {
    const ray = new THREE.Raycaster(new THREE.Vector3(0, 1.1, -(CABIN.frontFwd + 0.2)), new THREE.Vector3(0, 0, 1))
    const hit = ray.intersectObject(cabin.group, true)[0]
    expect(hit).toBeDefined()
    // First thing in the way is the aft curtain/bulkhead.
    expect(hit!.point.z).toBeGreaterThan(-CABIN.aftFwd - 0.2)
  })

  it('is built only for the 737-800 deck', () => {
    const jet = { label: 'x', powerplant: { kind: 'jet', count: 2 } }
    expect(cockpitProfile('737', B738, jet).deck?.cabin).toBe(true)
    expect(cockpitProfile('B739', B738, jet).deck?.cabin).toBe(false)
    expect(cockpitProfile('A320', B738, jet).deck?.cabin).toBe(false)
  })

  it('stays within a sane draw-call budget (static parts merged per material)', () => {
    expect(cabin.group.children.length).toBeLessThanOrEqual(40)
  })

  it('dims with the deck interior fill', () => {
    setInteriorFill(1)
    const lit = cabin.materials.map((m) => m.emissive.r + m.emissive.g + m.emissive.b)
    setInteriorFill(0)
    const dim = cabin.materials.map((m) => m.emissive.r + m.emissive.g + m.emissive.b)
    setInteriorFill(1)
    dim.forEach((d, i) => expect(d).toBeLessThan(lit[i]!))
  })
})

describe('turn-around cockpit camera', () => {
  const e = EYE_BY_LAYOUT.boeing737
  const aftEye = { x: -0.5, y: 0, up: 1.2 }
  const cam = new CockpitCamera(new THREE.PerspectiveCamera())
  cam.setEyePoint(e)
  cam.setAftEye(aftEye)
  cam.setYawLimit(Math.PI)

  it('keeps the design eye looking forward and reaches the cabin when turned', () => {
    expect(cam.eyeForYaw(0)).toEqual(e)
    expect(cam.eyeForYaw(1.0)).toEqual(e)
    expect(cam.eyeForYaw(Math.PI)).toEqual(aftEye)
    expect(cam.eyeForYaw(-Math.PI)).toEqual(aftEye)
  })

  it('only passes the bulkhead through the doorway', () => {
    for (let yaw = 0; yaw <= Math.PI; yaw += 0.01) {
      const p = cam.eyeForYaw(yaw)
      if (p.x < CABIN.frontFwd + 0.15) {
        expect(Math.abs(p.y)).toBeLessThan(CABIN.doorwayHalfWidth - 0.1)
        expect(p.up).toBeLessThan(CABIN.doorwayTop - 0.1)
      }
    }
  })

  it('clamps look yaw to the configured limit', () => {
    const c = new CockpitCamera(new THREE.PerspectiveCamera())
    c.setLook(3, 0)
    expect(c.eyeForYaw(0)).toEqual(EYE_BY_LAYOUT.ga)
    // Default ±1.4 rad; widened decks reach π.
    const pos = new THREE.Vector3()
    const input = { consumeMouseDelta: () => ({ dx: -10_000, dy: 0 }) } as unknown as Parameters<CockpitCamera['update']>[4]
    c.update(pos, 0, 0, 0, input, true)
    const q1 = c['lookYaw' as keyof CockpitCamera] as unknown as number
    expect(q1).toBeCloseTo(1.4, 5)
    c.setYawLimit(Math.PI)
    c.update(pos, 0, 0, 0, input, true)
    expect(c['lookYaw' as keyof CockpitCamera] as unknown as number).toBeCloseTo(Math.PI, 5)
  })
})
