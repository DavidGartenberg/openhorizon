import {existsSync, readFileSync} from 'node:fs'
import {describe, expect, it} from 'vitest'
import * as THREE from 'three'
import type {SurfaceState} from '../../src/render/aircraft-mesh'
import {parseObj8, buildObj8, applyObj8Anim, applyObj8Visibility} from '../../src/render/xplane-obj8'
import {localDatarefReader} from '../../src/render/local-aircraft'
import {XP_CONTROL_LIMITS} from '../../src/render/xplane-manifest'
import {drawComponents, interfacePosition, socketClearance, type DrawComponent} from './native-interface-geometry'
import {nativeBase} from './native-interface-scenes'

interface Patch {
  source: string
  partner: string
  triangles: number[][]
  vertices: Array<{vertex: number; clearance: number[][]}>
  bases: Array<{vertex: number; partner: string; triangle: number[]; positions: number[][]}>
}
const fixture = JSON.parse(readFileSync('tests/fixtures/native-a333-slat-patches.json', 'utf8')) as {
  toleranceM: number; states: SurfaceState[]; patches: Patch[]
}
const sourcePath = 'Airbus A330-300/objects/A330_wings.obj'

function scene() {
  const root = new THREE.Group()
  const parsed = parseObj8(readFileSync(nativeBase + sourcePath, 'utf8'))
  const built = buildObj8(parsed, new THREE.MeshBasicMaterial(), {name: sourcePath})
  root.add(built.group)
  root.updateMatrixWorld(true)
  const components = new Map(drawComponents(root).map(c => [c.id, c]))
  return {
    components,
    pose(state: SurfaceState) {
      const read = localDatarefReader(state, 0, 0, new Map(Object.entries(XP_CONTROL_LIMITS.A333!)), 'A333')
      for (const node of built.animated) { applyObj8Anim(node, read); applyObj8Visibility(node, read) }
      root.updateMatrixWorld(true)
    },
    dispose() {
      root.traverse(o => {
        if (o instanceof THREE.Mesh) { o.geometry.dispose(); (o.material as THREE.Material).dispose() }
      })
    },
  }
}

function errors(patch: Patch, components: Map<string, DrawComponent>, pose: number): number[] {
  const source = components.get(patch.source)!, partner = components.get(patch.partner)!
  expect(source, patch.source).toBeDefined()
  expect(partner, patch.partner).toBeDefined()
  for (const triangle of patch.triangles) expect(source.triangles).toContainEqual(triangle)
  const result: number[] = []
  for (const tip of patch.vertices) {
    expect(source.vertices).toContain(tip.vertex)
    const clearance = socketClearance(source, tip.vertex, partner)
    // Use the exact identified wing island, not a fleet or wing bounding box.
    // A missing upper/lower intersection is failure, not a tolerated gap.
    result.push(...clearance.map((value, side) =>
      Number.isFinite(value) && value >= 0 ? Math.abs(value - tip.clearance[pose]![side]!) : Infinity))
  }
  for (const base of patch.bases) {
    const movingPartner = components.get(base.partner)!
    expect(movingPartner, base.partner).toBeDefined()
    expect(source.vertices).toContain(base.vertex)
    expect(movingPartner.triangles).toContainEqual(base.triangle)
    const position = interfacePosition(source, base.vertex, movingPartner, base.triangle)
    result.push(...position.map((value, axis) => Math.abs(value - base.positions[pose]![axis]!)))
  }
  return result
}

describe.skipIf(!existsSync(nativeBase + sourcePath))('original A330 identified slat track patches', () => {
  it('keeps all eleven terminal patches embedded and their slat bases registered through deployment', () => {
    const loaded = scene()
    try {
      expect(fixture.patches).toHaveLength(11)
      expect(fixture.patches.reduce((n, p) => n + p.vertices.length * fixture.states.length, 0)).toBe(215)
      expect(fixture.patches.reduce((n, p) => n + p.bases.length, 0)).toBe(12)
      fixture.states.forEach((state, pose) => {
        loaded.pose(state)
        for (const patch of fixture.patches) {
          expect(Math.max(...errors(patch, loaded.components, pose)), `${patch.source}, pose ${pose}`)
            .toBeLessThanOrEqual(fixture.toleranceM)
        }
      })
    } finally { loaded.dispose() }
  }, 120000)

  it('rejects one detached actual rail island while its sibling under the same draw and animation stays attached', () => {
    const loaded = scene()
    const patch = fixture.patches.find(p => p.source.endsWith('|19407|6449'))!
    const sibling = fixture.patches.find(p => p.source.endsWith('|19407|6457'))!
    const rail = loaded.components.get(patch.source)!
    const original = rail.mesh.geometry
    let mutated: THREE.BufferGeometry | undefined
    try {
      loaded.pose(fixture.states[2]!)
      expect(Math.max(...errors(patch, loaded.components, 2))).toBeLessThanOrEqual(fixture.toleranceM)
      expect(Math.max(...errors(sibling, loaded.components, 2))).toBeLessThanOrEqual(fixture.toleranceM)
      mutated = original.clone()
      const positions = original.attributes.position!.clone()
      mutated.setAttribute('position', positions)
      rail.mesh.geometry = mutated
      for (const vertex of rail.vertices) positions.setY(vertex, positions.getY(vertex) + 2)
      positions.needsUpdate = true
      expect(Math.max(...errors(patch, loaded.components, 2))).toBeGreaterThan(.1)
      expect(Math.max(...errors(sibling, loaded.components, 2))).toBeLessThanOrEqual(fixture.toleranceM)
    } finally {
      rail.mesh.geometry = original
      mutated?.dispose()
      loaded.dispose()
    }
  }, 120000)
})
