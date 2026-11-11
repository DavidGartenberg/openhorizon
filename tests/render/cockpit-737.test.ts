import * as THREE from 'three'
import { beforeAll, describe, expect, it } from 'vitest'
import { installCanvasStub } from './canvas-stub'
import { animate737, build737Deck, flapLeverFrac, leverLats, type Deck737, type Deck737Controls } from '../../src/render/cockpit-737'
import { MIP } from '../../src/render/cockpit-737-paint'
import { EYE_BY_LAYOUT } from '../../src/render/cockpit-camera'

const DETENTS = [0, 1, 2, 5, 10, 15, 25, 30, 40]
const tex = (): THREE.Texture => new THREE.Texture()
let deck: Deck737, group: THREE.Group
const rest: Deck737Controls = { pitch: 0, roll: 0, yaw: 0, throttle: 0, reverse: 0, flapsDeg: 0, speedbrake: 0, speedbrakeArmed: false, trim: 0, gearDown: true, parkingBrake: false, enginesRunning: [true, true] }
const world = (o: THREE.Object3D, local = new THREE.Vector3()): THREE.Vector3 => { group.updateMatrixWorld(true); return o.localToWorld(local.clone()) }

beforeAll(() => {
  installCanvasStub()
  group = new THREE.Group()
  deck = build737Deck(group, { pfd: tex(), nd: tex(), eicas: tex(), isfd: tex() }, DETENTS)
})

describe('737NG flight deck layout', () => {
  it('six DUs sit on the panel, PFDs outboard of NDs, no overlaps', () => {
    const lats = [MIP.captPfd, MIP.captNd, MIP.upperDu, MIP.foNd, MIP.foPfd]
    for (let i = 1; i < lats.length; i++) expect(lats[i]! - lats[i - 1]!).toBeGreaterThanOrEqual(MIP.du - 1e-9)
    expect(MIP.captPfd).toBeLessThan(MIP.captNd)
    expect(MIP.foPfd).toBeGreaterThan(MIP.foNd)
    expect(MIP.duUp - MIP.lowerDuUp).toBeGreaterThanOrEqual(MIP.du)
    for (const l of lats) { expect(l - MIP.du / 2).toBeGreaterThan(MIP.left); expect(l + MIP.du / 2).toBeLessThan(MIP.right) }
    // ISFD between the captain's ND and the upper DU; gear lever right of it.
    expect(MIP.isfd.lat - MIP.isfd.size / 2).toBeGreaterThan(MIP.captNd + MIP.du / 2)
    expect(MIP.isfd.lat + MIP.isfd.size / 2).toBeLessThan(MIP.upperDu - MIP.du / 2)
    expect(MIP.gear.lat).toBeGreaterThan(MIP.upperDu + MIP.du / 2)
    expect(MIP.gear.lat).toBeLessThan(MIP.foNd - MIP.du / 2)
  })
  it('everything stays inside the cabin', () => {
    const box = new THREE.Box3()
    group.updateMatrixWorld(true)
    group.traverse(o => {
      if (!(o instanceof THREE.Mesh) || !o.visible) return
      box.setFromObject(o)
      expect(Math.max(Math.abs(box.min.x), Math.abs(box.max.x)), o.name || o.type).toBeLessThan(0.96)
      expect(box.min.y).toBeGreaterThan(-0.3)
      expect(box.max.y).toBeLessThan(1.7)
    })
  })
  it('the captain sees out over the glareshield: clear sight lines from −4° to +20°', () => {
    const eye = EYE_BY_LAYOUT.boeing737
    const origin = new THREE.Vector3(eye.y, eye.up, -eye.x)
    const opaque: THREE.Object3D[] = []
    group.updateMatrixWorld(true)
    group.traverse(o => {
      if (!(o instanceof THREE.Mesh) || !o.visible) return
      const m = o.material as THREE.Material
      if (m.transparent || (m as THREE.MeshBasicMaterial).visible === false) return
      opaque.push(o)
    })
    const ray = new THREE.Raycaster()
    for (let el = -4; el <= 20; el += 2) for (const az of [-10, 0, 10]) {
      const e = (el * Math.PI) / 180, a = (az * Math.PI) / 180
      ray.set(origin, new THREE.Vector3(Math.sin(a) * Math.cos(e), Math.sin(e), -Math.cos(a) * Math.cos(e)))
      const hit = ray.intersectObjects(opaque, false)[0]
      expect(hit, `blocked at el ${el}° az ${az}° by ${hit?.object.name || hit?.object.type}`).toBeUndefined()
    }
  })
  it('exposes the clickable deck controls', () => {
    const ids = new Set(deck.interactive.map(o => o.userData.controlId as string))
    for (const id of ['throttleKnob', 'flapLever', 'trimWheel', 'fireTest', 'hornCutout', 'mcpDisengage', 'masterCaution', 'landingLights', 'atDisconnect', 'atReset', 'apReset', 'apBtn:ap', 'apBtn:hdg', 'apBtn:alt', 'apKnob:altitude:1', 'apKnob:heading:-1']) expect(ids.has(id), id).toBe(true)
  })
})

describe('737NG control rig senses', () => {
  const knob = (): THREE.Vector3 => world(deck.rig.thrust[0]!, new THREE.Vector3(0, 0.315, 0.1))
  it('thrust levers go forward with thrust', () => {
    animate737(deck, { ...rest, throttle: 0 }); const idle = knob()
    animate737(deck, { ...rest, throttle: 1 }); const full = knob()
    expect(full.z).toBeLessThan(idle.z - 0.08) // render −z = forward
  })
  it('pulling moves both wheels aft; right roll lowers the right horn', () => {
    animate737(deck, rest); const n = world(deck.rig.capt.wheel), foN = world(deck.rig.fo.wheel)
    animate737(deck, { ...rest, pitch: 1 })
    expect(world(deck.rig.capt.wheel).z).toBeGreaterThan(n.z + 0.05)
    expect(world(deck.rig.fo.wheel).z).toBeGreaterThan(foN.z + 0.05)
    animate737(deck, { ...rest, roll: 1 })
    const right = world(deck.rig.capt.wheel, new THREE.Vector3(0.18, 0.1, 0)), left = world(deck.rig.capt.wheel, new THREE.Vector3(-0.18, 0.1, 0))
    expect(right.y).toBeLessThan(left.y)
  })
  it('flap lever travels aft from UP to 40; gear handle drops for DOWN', () => {
    const handle = (): THREE.Vector3 => world(deck.rig.flap, new THREE.Vector3(0, 0.12, 0))
    animate737(deck, { ...rest, flapsDeg: 0 }); const up = handle()
    animate737(deck, { ...rest, flapsDeg: 40 }); const full = handle()
    expect(full.z).toBeGreaterThan(up.z + 0.05)
    animate737(deck, { ...rest, gearDown: false }); const gUp = world(deck.rig.gearHandle)
    animate737(deck, { ...rest, gearDown: true }); const gDn = world(deck.rig.gearHandle)
    expect(gDn.y).toBeLessThan(gUp.y - 0.05)
  })
  it('right rudder pushes the right pedals forward', () => {
    const rightPedal = deck.rig.pedals.find(p => p.side === 1)!.mesh
    animate737(deck, rest); const n = world(rightPedal)
    animate737(deck, { ...rest, yaw: 1 })
    expect(world(rightPedal).z).toBeLessThan(n.z - 0.03)
  })
})

describe('flapLeverFrac', () => {
  it('maps detents onto equal gate steps and clamps', () => {
    expect(flapLeverFrac(0, DETENTS)).toBe(0)
    expect(flapLeverFrac(40, DETENTS)).toBe(1)
    expect(flapLeverFrac(5, DETENTS)).toBeCloseTo(3 / 8)
    expect(flapLeverFrac(7.5, DETENTS)).toBeCloseTo(3.5 / 8)
    expect(flapLeverFrac(99, DETENTS)).toBe(1)
    expect(flapLeverFrac(-3, DETENTS)).toBe(0)
  })
})


describe('737 deck for 2-, 3- and 4-engine jets', () => {
  it.each([2, 3, 4])('%i engines: one thrust lever, reverser and start lever each, spaced apart, all moving with thrust', n => {
    const g = new THREE.Group()
    const d = build737Deck(g, { pfd: tex(), nd: tex(), eicas: tex(), isfd: tex() }, DETENTS, n)
    expect(d.rig.thrust).toHaveLength(n); expect(d.rig.reversers).toHaveLength(n); expect(d.rig.startLevers).toHaveLength(n)
    const lats = leverLats(n)
    for (let i = 1; i < lats.length; i++) expect(lats[i]! - lats[i - 1]!).toBeGreaterThanOrEqual(0.06 - 1e-9)
    expect(Math.max(...lats.map(Math.abs))).toBeLessThanOrEqual(0.1)
    animate737(d, { ...rest, throttle: 0 }); g.updateMatrixWorld(true)
    const idle = d.rig.thrust.map(t => t.localToWorld(new THREE.Vector3(0, 0.315, 0.1)).z)
    animate737(d, { ...rest, throttle: 1, enginesRunning: Array(n).fill(true) }); g.updateMatrixWorld(true)
    d.rig.thrust.forEach((t, i) => expect(t.localToWorld(new THREE.Vector3(0, 0.315, 0.1)).z).toBeLessThan(idle[i]! - 0.08))
    // engines out on one side: only those start levers drop to CUTOFF
    animate737(d, { ...rest, enginesRunning: Array.from({ length: n }, (_, i) => i < n / 2) })
    expect(d.rig.startLevers[0]!.rotation.x).toBe(0)
    expect(d.rig.startLevers[n - 1]!.rotation.x).toBeGreaterThan(0)
  })
})
