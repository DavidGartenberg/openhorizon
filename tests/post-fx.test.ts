import { describe, it, expect } from 'vitest'
import * as THREE from 'three'
import { sunScreenPosition } from '../src/render/post-fx'

function cam(): THREE.PerspectiveCamera {
  const c = new THREE.PerspectiveCamera(70, 1.6, 0.5, 2_000_000)
  c.position.set(100, 50, -30)
  return c // looks down −Z by default
}

describe('sunScreenPosition', () => {
  it('puts a sun straight ahead at screen centre, fully visible', () => {
    const r = sunScreenPosition(cam(), new THREE.Vector3(0, 0.05, -1).normalize(), 10)
    expect(r.screen.x).toBeCloseTo(0.5, 1)
    expect(r.visibility).toBe(1)
    expect(r.screen.y).toBeGreaterThan(0.5) // slightly above the horizon line
  })

  it('moves right/left with the sun azimuth', () => {
    const right = sunScreenPosition(cam(), new THREE.Vector3(0.4, 0.1, -1).normalize(), 10)
    const left = sunScreenPosition(cam(), new THREE.Vector3(-0.4, 0.1, -1).normalize(), 10)
    expect(right.screen.x).toBeGreaterThan(0.5)
    expect(left.screen.x).toBeLessThan(0.5)
  })

  it('has zero visibility when the sun is behind the camera', () => {
    const r = sunScreenPosition(cam(), new THREE.Vector3(0, 0.2, 1).normalize(), 20)
    expect(r.visibility).toBe(0)
  })

  it('fades out below the horizon', () => {
    const fwd = new THREE.Vector3(0, 0.01, -1).normalize()
    expect(sunScreenPosition(cam(), fwd, -6).visibility).toBe(0)
    const dusk = sunScreenPosition(cam(), fwd, -1).visibility
    expect(dusk).toBeGreaterThan(0)
    expect(dusk).toBeLessThan(1)
    expect(sunScreenPosition(cam(), fwd, 3).visibility).toBe(1)
  })

  it('tracks camera rotation (stale matrices are refreshed)', () => {
    const c = cam()
    const sun = new THREE.Vector3(-1, 0.1, 0).normalize() // due "left" of the default view
    expect(sunScreenPosition(c, sun, 10).visibility).toBe(0)
    c.rotateY(Math.PI / 2) // now faces −X
    const r = sunScreenPosition(c, sun, 10)
    expect(r.visibility).toBe(1)
    expect(r.screen.x).toBeCloseTo(0.5, 1)
  })
})
