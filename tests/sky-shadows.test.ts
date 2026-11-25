import { describe, expect, it } from 'vitest'
import * as THREE from 'three'
import { COCKPIT_SHADOW_HALF_M, SkyDome } from '../src/render/sky'

const light = (sky: SkyDome): THREE.DirectionalLight => {
  const l = (sky as unknown as { sunLight: THREE.DirectionalLight }).sunLight
  return l
}

describe('cockpit shadow mode', () => {
  it('spends the shadow map on the flight deck and restores the exterior box exactly', () => {
    const sky = new SkyDome(new THREE.Scene())
    sky.setShadowSize(35.8) // a 737-sized airframe
    const sh = light(sky).shadow, c = sh.camera as THREE.OrthographicCamera
    const exterior = { left: c.left, right: c.right, near: c.near, far: c.far, bias: sh.bias, normalBias: sh.normalBias }
    expect(exterior.right).toBeCloseTo(35.8 * 1.4, 5)

    sky.setCockpitShadows(true)
    expect(sky.inCockpitShadowMode).toBe(true)
    expect(c.right).toBe(COCKPIT_SHADOW_HALF_M); expect(c.left).toBe(-COCKPIT_SHADOW_HALF_M)
    expect(c.top).toBe(COCKPIT_SHADOW_HALF_M); expect(c.bottom).toBe(-COCKPIT_SHADOW_HALF_M)
    // the light sits 700 m from its target: the depth range must bracket that, tightly
    expect(c.near).toBeLessThan(700); expect(c.far).toBeGreaterThan(700); expect(c.far - c.near).toBeLessThan(60)
    expect(sh.normalBias).toBeLessThan(exterior.normalBias)
    // 2048 texels across a 6.4 m box: a few millimetres each
    expect((2 * COCKPIT_SHADOW_HALF_M) / 2048).toBeLessThan(0.004)

    sky.setCockpitShadows(false)
    expect(sky.inCockpitShadowMode).toBe(false)
    expect({ left: c.left, right: c.right, near: c.near, far: c.far, bias: sh.bias, normalBias: sh.normalBias }).toEqual(exterior)
  })
  it('a type change while in the cockpit takes effect on exit, not mid-cockpit', () => {
    const sky = new SkyDome(new THREE.Scene())
    sky.setCockpitShadows(true)
    sky.setShadowSize(11) // e.g. a Cessna selected while looking out of the cockpit
    const c = light(sky).shadow.camera as THREE.OrthographicCamera
    expect(c.right).toBe(COCKPIT_SHADOW_HALF_M)
    sky.setCockpitShadows(false)
    expect(c.right).toBeCloseTo(Math.max(24, 11 * 1.4), 5)
  })
  it('is idempotent', () => {
    const sky = new SkyDome(new THREE.Scene())
    sky.setCockpitShadows(true); sky.setCockpitShadows(true)
    sky.setCockpitShadows(false); sky.setCockpitShadows(false)
    expect(sky.inCockpitShadowMode).toBe(false)
  })
})
