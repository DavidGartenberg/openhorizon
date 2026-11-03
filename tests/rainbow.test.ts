/** Rainbows need rain, sunshine on it, and a sun below 42°. */
import { describe, expect, it } from 'vitest'
import * as THREE from 'three'
import { rainbowStrength } from '../src/render/rainbow'
import { SkyDome } from '../src/render/sky'

describe('rainbow', () => {
  it('shows in a sunny shower with the sun low, not at night, at noon or under overcast', () => {
    expect(rainbowStrength(0.6, 20, 0.7)).toBeGreaterThan(0.9)
    expect(rainbowStrength(0, 20, 0.7)).toBe(0) // dry
    expect(rainbowStrength(0.6, -5, 0.7)).toBe(0) // sun down
    expect(rainbowStrength(0.6, 50, 0.9)).toBe(0) // bow below the horizon
    expect(rainbowStrength(0.6, 20, 0.07)).toBe(0) // overcast: no direct sun
  })

  it("the sky shader draws a primary bow and a reversed secondary with Alexander's band", () => {
    const dome = new SkyDome(new THREE.Scene())
    const frag = (dome as unknown as { material: THREE.ShaderMaterial }).material.fragmentShader
    expect(frag).toContain('(th - 40.6) / 1.8') // primary, red outside
    expect(frag).toContain('1.0 - (th - 50.3) / 3.2') // secondary, reversed
    expect(frag).toContain('alexander')
    dome.setRainbow(0.8)
    expect((dome as unknown as { material: THREE.ShaderMaterial }).material.uniforms.uRainbow!.value).toBe(0.8)
  })

  it('the night sky gets the real moon and the sidereal rotation from the date', () => {
    const dome = new SkyDome(new THREE.Scene())
    dome.update(new Date('2024-01-25T17:54:00Z'), 37.5, -122.4) // full moon at sunset
    expect(dome.moonDir.dot(dome.sunDir)).toBeLessThan(-0.97)
    expect(Math.abs(dome.equatorial.determinant() - 1)).toBeLessThan(1e-9)
  })
})
