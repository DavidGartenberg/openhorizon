import * as THREE from 'three'
import { describe, expect, it } from 'vitest'
import { MOUNT_KINDS, MountedCamera, mountFor, WING_ROOT_TE_AFT, WING_SEAT_FORWARD, type MountDims } from '../src/render/mounted-camera'
import type { Input } from '../src/input/input'

const b738: MountDims = { lengthM: 39.5, fuselageRadiusM: 1.9, jet: true }
const a333: MountDims = { lengthM: 63.7, fuselageRadiusM: 2.9, jet: true }
const c172: MountDims = { lengthM: 8.3, fuselageRadiusM: 0.55, jet: false }
const noInput = { consumeMouseDelta: () => ({ dx: 0, dy: 0 }) } as unknown as Input
const dragInput = (dx: number, dy: number) => ({ consumeMouseDelta: () => ({ dx, dy }) }) as unknown as Input

/** Where a camera looks, as a unit vector in the airplane's own frame (nose −z, right +x, up +y). */
function lookDir(cam: THREE.PerspectiveCamera): THREE.Vector3 {
  return new THREE.Vector3(0, 0, -1).applyQuaternion(cam.quaternion)
}

describe('wing window seats', () => {
  it('sit against the skin on their own side, a little ahead of the wing-root trailing edge, above the centreline', () => {
    for (const dims of [b738, a333]) {
      const l = mountFor('wingL', dims), r = mountFor('wingR', dims)
      expect(l.eye.y).toBeLessThan(-dims.fuselageRadiusM + 0.3); expect(l.eye.y).toBeGreaterThan(-dims.fuselageRadiusM)
      expect(r.eye.y).toBeCloseTo(-l.eye.y, 6)
      expect(l.eye.x).toBeCloseTo(WING_SEAT_FORWARD * dims.lengthM, 6)           // forward of the CG…
      expect(l.eye.x).toBeGreaterThan(-WING_ROOT_TE_AFT * dims.lengthM)           // …so ahead of the trailing edge, which is aft of it
      expect(l.eye.up).toBeGreaterThan(0.3); expect(l.eye.up).toBeLessThan(dims.fuselageRadiusM)
    }
  })

  it('look out and a little aft of the beam, down at the wing; the right seat mirrors the left', () => {
    const l = mountFor('wingL', b738), r = mountFor('wingR', b738)
    expect(l.yawDeg).toBeGreaterThan(90); expect(l.yawDeg).toBeLessThan(125)       // more than a beam view: aft of it
    expect(r.yawDeg).toBeCloseTo(-l.yawDeg, 6)
    expect(l.pitchDeg).toBeLessThan(0); expect(r.pitchDeg).toBe(l.pitchDeg)
  })

  it('point the camera to the correct side in the world: left window → −x and aft (+z), right → +x', () => {
    const cam = new THREE.PerspectiveCamera()
    const m = new MountedCamera(cam)
    m.set('wingL', b738); m.update(new THREE.Vector3(), 0, 0, 0, noInput, false)
    let d = lookDir(cam)
    expect(d.x).toBeLessThan(-0.8); expect(d.z).toBeGreaterThan(0); expect(d.y).toBeLessThan(0)
    m.set('wingR', b738); m.update(new THREE.Vector3(), 0, 0, 0, noInput, false)
    d = lookDir(cam)
    expect(d.x).toBeGreaterThan(0.8); expect(d.z).toBeGreaterThan(0); expect(d.y).toBeLessThan(0)
  })

  it('a light airplane\'s seat is inside a small cabin and looks level or up at a wing above it', () => {
    const m = mountFor('wingR', c172)
    expect(Math.abs(m.eye.y)).toBeLessThan(0.6); expect(m.pitchDeg).toBeGreaterThanOrEqual(0)
  })
})

describe('tail camera', () => {
  it('sits far aft and high on the centreline and looks forward and a little down', () => {
    const t = mountFor('tail', b738)
    expect(t.eye.x).toBeLessThan(-10); expect(t.eye.y).toBe(0); expect(t.eye.up).toBeGreaterThan(5)
    expect(t.yawDeg).toBe(0); expect(t.pitchDeg).toBeLessThan(0)
    const cam = new THREE.PerspectiveCamera()
    const m = new MountedCamera(cam); m.set('tail', b738); m.update(new THREE.Vector3(), 0, 0, 0, noInput, false)
    expect(lookDir(cam).z).toBeLessThan(-0.9)       // toward the nose
  })

  it('every mount kind has an eye and a range', () => {
    for (const kind of MOUNT_KINDS) for (const dims of [b738, a333, c172]) {
      const m = mountFor(kind, dims)
      expect([m.eye.x, m.eye.y, m.eye.up, m.yawDeg, m.pitchDeg].every(Number.isFinite)).toBe(true)
      expect(m.yawRangeDeg).toBeGreaterThan(0); expect(m.pitchRangeDeg).toBeGreaterThan(0)
    }
  })
})

describe('riding the airplane', () => {
  it('the camera moves and turns with the airplane: its offset is rotated by the attitude, and the position follows', () => {
    const cam = new THREE.PerspectiveCamera(), m = new MountedCamera(cam)
    m.set('wingL', b738)
    const at = new THREE.Vector3(100, 50, -200)
    m.update(at, 0, 0, 0, noInput, false)
    const level = cam.position.clone().sub(at)
    expect(level.x).toBeLessThan(0)                                    // left of the CG
    m.update(at, Math.PI / 2, 0, 0, noInput, false)                   // heading 90°: the left side now faces north (−z in the render frame)
    const turned = cam.position.clone().sub(at)
    expect(turned.length()).toBeCloseTo(level.length(), 5)
    expect(Math.abs(turned.z)).toBeGreaterThan(Math.abs(turned.x))
    expect(turned.z).toBeLessThan(0)
    m.update(at, 0, 0, 0, noInput, false)
    m.update(new THREE.Vector3(0, 0, 0), 0, 0, 0, noInput, false)
    expect(cam.position.clone().sub(level).length()).toBeLessThan(1e-9)
  })

  it('looking around is limited to the mount\'s range either way and starts again at each new mount', () => {
    const cam = new THREE.PerspectiveCamera(), m = new MountedCamera(cam)
    m.set('wingL', b738)
    for (let i = 0; i < 40; i++) m.update(new THREE.Vector3(), 0, 0, 0, dragInput(-400, 0), true)          // mouse far left: look aft and out
    const base = mountFor('wingL', b738)
    const yawNow = (a: THREE.PerspectiveCamera): number => THREE.MathUtils.radToDeg(Math.atan2(-lookDir(a).x, -lookDir(a).z))
    expect(yawNow(cam)).toBeCloseTo(base.yawDeg + base.yawRangeDeg, 0)
    for (let i = 0; i < 80; i++) m.update(new THREE.Vector3(), 0, 0, 0, dragInput(400, 0), true)
    expect(yawNow(cam)).toBeCloseTo(base.yawDeg - base.yawRangeDeg, 0)
    m.set('wingL', b738); m.update(new THREE.Vector3(), 0, 0, 0, noInput, false)
    expect(yawNow(cam)).toBeCloseTo(base.yawDeg, 0)
    m.setLook(500, 500)
    m.update(new THREE.Vector3(), 0, 0, 0, noInput, false)
    expect(yawNow(cam)).toBeCloseTo(base.yawDeg + base.yawRangeDeg, 0)
  })
})
