import { describe, expect, it } from 'vitest'
import { buildArchetype } from '../src/render/fleet-mesh'
import { archetypeFor, type Archetype } from '../src/world/fleet-map'

const ALL: Array<[string, string, string]> = [
  ['C172', 'L1P', 'L'], ['P28A', 'L1P', 'L'], ['J3', 'L1P', 'L'],
  ['BE58', 'L2P', 'L'], ['PC12', 'L1T', 'L'], ['DH8D', 'L2T', 'M'],
  ['C130', 'L4T', 'M'], ['GLF5', 'L2J', 'M'], ['B738', 'L2J', 'M'],
  ['B77W', 'L2J', 'H'], ['B744', 'L4J', 'H'], ['GLID', 'L0-', '-'],
  ['R44', 'H1P', 'L'], ['ZZZZ', '-0-', '-'],
]

describe('buildArchetype (12b — merged single-draw silhouettes)', () => {
  it('every archetype builds ONE merged geometry (1 draw call) at its real span', () => {
    for (const [des, desc, wtc] of ALL) {
      const spec = archetypeFor(des, desc, wtc)
      const mesh = buildArchetype(spec)
      expect(mesh.geometry.getAttribute('position').count, des).toBeGreaterThan(50)
      expect(mesh.geometry.getAttribute('color'), `${des} vertex colors`).toBeDefined()
      expect(mesh.geometry.groups.length, `${des} groups (draw calls)`).toBeLessThanOrEqual(1)
      // Span sanity: geometry x-extent within 25% of the spec span.
      mesh.geometry.computeBoundingBox()
      const bb = mesh.geometry.boundingBox!
      const xExtent = bb.max.x - bb.min.x
      expect(xExtent, `${des} span`).toBeGreaterThan(spec.spanM * 0.75)
      expect(xExtent, `${des} span`).toBeLessThan(spec.spanM * 1.3)
      // Slice 8: the anchor sits at the RENDERED tip (a swept half-wing
      // box genuinely ends inboard of the nominal S/2 — the old exact
      // −S/2 assertion floated the light off the geometry), and never
      // outside the mesh.
      const tipX = mesh.userData.lightAnchors.wingtipL.x as number
      expect(tipX, `${des} tip anchor`).toBeLessThan(-spec.spanM * 0.4)
      expect(tipX, `${des} tip anchor inside mesh`).toBeGreaterThanOrEqual(bb.min.x - 0.3)
      // Tail light rides the fin, above the centerline, aft of midship.
      expect(mesh.userData.lightAnchors.tail.y, `${des} tail anchor up`).toBeGreaterThan(0)
      expect(mesh.userData.lightAnchors.tail.z, `${des} tail anchor aft`).toBeGreaterThan(spec.lengthM * 0.3)
    }
  })

  it('all meshes share ONE material instance (one shader program)', () => {
    const specs: Archetype[] = ['ga-high-wing', 'narrowbody', 'rotorcraft']
    const meshes = specs.map((a) => buildArchetype({ archetype: a, spanM: 12, lengthM: 10, engines: 2 }))
    expect(meshes[0]!.material).toBe(meshes[1]!.material)
    expect(meshes[1]!.material).toBe(meshes[2]!.material)
  })
})
