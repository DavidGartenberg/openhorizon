import { describe, expect, it } from 'vitest'
import { XP_COCKPIT_B738, eyeFromObj } from '../src/render/xplane-cockpit'

describe('X-Plane 737 cockpit placement', () => {
  it('maps an eye in OBJ metres to the cockpit camera\'s forward/lateral/up from the CG', () => {
    // The VR seat preset in the install is relative to the CG: (-0.536, 1.32, -15.55).
    const e = eyeFromObj(XP_COCKPIT_B738)
    expect(e.x).toBeCloseTo(15.55, 1)   // forward of the CG
    expect(e.y).toBeCloseTo(-0.536, 3)  // left of the centreline (captain)
    expect(e.up).toBeCloseTo(1.32, 1)   // above the CG
  })
  it('follows the exterior placement rule: the eye moves 1:1 with the object frame', () => {
    const a = eyeFromObj(XP_COCKPIT_B738, [0, 0, 3]), b = eyeFromObj(XP_COCKPIT_B738, [0.5, 0.25, 2])
    expect(b.y - a.y).toBeCloseTo(0.5, 6)      // +x object = right
    expect(b.up - a.up).toBeCloseTo(0.25, 6)   // +y object = up
    expect(b.x - a.x).toBeCloseTo(1, 6)        // −z object = forward
  })
  it('lists the cockpit objects with transparent layers last', () => {
    const objs = XP_COCKPIT_B738.objs
    expect(objs.length).toBe(14)
    expect(objs.some((o) => /FMS_screens/.test(o))).toBe(true) // the two CDU screens
    expect(objs.at(-1)).toMatch(/glass/); expect(objs.at(-2)).toMatch(/fuzz/)
    expect(new Set(objs).size).toBe(objs.length)
    for (const o of objs) expect(o).toMatch(/^objects\/(738_cockpit_[A-Za-z0-9]+|FMS_screens)\.obj$/)
  })
})

import { XP_B738_SCREENS, screenPlacement } from '../src/render/xplane-cockpit'
import * as THREE from 'three'
describe('X-Plane display openings', () => {
  it('has the five glass displays, each about 178 × 175 mm, mirrored about the centreline', () => {
    expect(XP_B738_SCREENS.map((s) => s.id)).toEqual(['capt-pfd', 'capt-nd', 'center-eicas', 'fo-nd', 'fo-pfd'])
    for (const s of XP_B738_SCREENS) {
      const p = screenPlacement(s)
      expect(p.width * 1000).toBeGreaterThan(172); expect(p.width * 1000).toBeLessThan(184)
      expect(p.height * 1000).toBeGreaterThan(170); expect(p.height * 1000).toBeLessThan(182)
    }
    const centre = (id: string) => screenPlacement(XP_B738_SCREENS.find((s) => s.id === id)!).center
    expect(centre('capt-pfd').x + centre('fo-pfd').x).toBeCloseTo(0, 1)
    expect(centre('capt-nd').x + centre('fo-nd').x).toBeCloseTo(0, 1)
  })
  it('faces the pilot (toward +z, aft) and tilts back like the panel', () => {
    for (const s of XP_B738_SCREENS) {
      const n = new THREE.Vector3(0, 0, 1).applyQuaternion(screenPlacement(s).quaternion)
      expect(n.z).toBeGreaterThan(0.94)            // faces aft toward the eyes
      expect(n.y).toBeGreaterThan(0.25)            // tilted upward ~17° like the recess plane
      expect(n.y).toBeLessThan(0.33)
      const up = new THREE.Vector3(0, 1, 0).applyQuaternion(screenPlacement(s).quaternion)
      expect(up.y).toBeGreaterThan(0.95)           // image is upright
      const right = new THREE.Vector3(1, 0, 0).applyQuaternion(screenPlacement(s).quaternion)
      expect(right.x).toBeGreaterThan(0.99)        // not mirrored
    }
  })
  it('sits a hair in front of the recess, not through it', () => {
    const a = screenPlacement(XP_B738_SCREENS[0]!, 0), b = screenPlacement(XP_B738_SCREENS[0]!, 0.001)
    expect(b.center.distanceTo(a.center)).toBeCloseTo(0.001, 6)
  })
})
