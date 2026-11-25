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
  it('names the panel mesh that puts the displays and MCP windows in place, apart from the shell objects', () => {
    expect(XP_COCKPIT_B738.panelObj).toBe('objects/b738_cockpit.obj')
    expect(XP_COCKPIT_B738.objs).not.toContain(XP_COCKPIT_B738.panelObj)
  })
})
