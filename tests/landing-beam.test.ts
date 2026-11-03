/** Volumetric landing-light beam: when it shows, how far it reaches, where it points. */
import { describe, expect, it } from 'vitest'
import * as THREE from 'three'
import { LandingBeam, beamGroundCut, beamIntensity, BEAM_DOWN_RAD } from '../src/render/landing-beam'

describe('landing-light beam', () => {
  it('needs darkness, and something to scatter on: rain, snow or fog', () => {
    expect(beamIntensity(1, 0, 0)).toBe(0) // broad daylight
    expect(beamIntensity(0, 0, 1)).toBeGreaterThan(0) // a little haze at night
    expect(beamIntensity(0.8, 0, 1)).toBeGreaterThan(5 * beamIntensity(0, 0, 1))
    expect(beamIntensity(0, 1, 1)).toBeGreaterThan(beamIntensity(0, 0, 1))
  })

  it('ends where it meets the ground', () => {
    expect(beamGroundCut(1000, 0, 200)).toBe(200) // high: full length
    const low = beamGroundCut(10, 0, 200)
    expect(low).toBeCloseTo(10 / Math.sin(BEAM_DOWN_RAD), 6) // level, 10 m up
    expect(beamGroundCut(10, -0.05, 200)).toBeLessThan(low) // nose down: shorter
    expect(beamGroundCut(10, 0.2, 200)).toBe(200) // nose high: over the ground
  })

  it('points forward and a few degrees down from the nose', () => {
    const group = new THREE.Group()
    const beam = new LandingBeam(150, new THREE.Vector3(0, 0.5, -4))
    group.add(beam.mesh)
    beam.update(true, 1, 150)
    const mat = beam.mesh.material as THREE.ShaderMaterial
    const axis = mat.uniforms.uAxis!.value as THREE.Vector3
    expect(axis.z).toBeLessThan(-0.99) // −z is forward
    expect(axis.y).toBeCloseTo(-Math.sin(BEAM_DOWN_RAD), 6)
    expect((mat.uniforms.uApex!.value as THREE.Vector3).toArray()).toEqual([0, 0.5, -4])
    beam.update(false, 1, 150)
    expect(beam.mesh.visible).toBe(false)
  })
})
