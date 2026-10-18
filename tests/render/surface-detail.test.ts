import * as THREE from 'three'
import { describe, expect, it } from 'vitest'
import { buildC172 } from '../../src/render/aircraft-mesh'

describe('C172 exterior surface refinement', () => {
  it('does not cut a depth hole in clouds with the translucent prop blur', () => {
    const a = buildC172()
    expect((a.propDisc.material as THREE.Material).depthWrite).toBe(false)
    expect(((a.propDisc.userData.blade as THREE.Mesh).material as THREE.Material).depthWrite).toBe(false)
  })
  it('rounds the cowl without changing its fit or forward visibility envelope', () => {
    const aircraft = buildC172()
    const cowl = aircraft.group.children.find(o => Math.abs(o.position.z + 1.75) < 1e-6) as THREE.Mesh
    cowl.geometry.computeBoundingBox()
    const bounds = cowl.geometry.boundingBox!
    expect(bounds.max.x - bounds.min.x).toBeCloseTo(0.95, 4)
    expect(bounds.max.y - bounds.min.y).toBeCloseTo(0.85, 4)
    expect(bounds.max.z - bounds.min.z).toBeCloseTo(0.85, 4)
    // Rounded corner normals have multiple nonzero components; a six-face
    // box has only axis normals and produces the old sharp-edged cowl.
    const n = cowl.geometry.getAttribute('normal')
    let curved = 0
    for (let i = 0; i < n.count; i++) if (Math.abs(n.getX(i)) > 0.1 && Math.abs(n.getY(i)) > 0.1) curved++
    expect(curved).toBeGreaterThan(20)
    // Prop axis and attach points remain unchanged.
    expect(aircraft.propDisc.position.toArray()).toEqual([0, 0.05, -2.32])
  })
})

describe('C172 profiled airframe', () => {
  it('keeps the pilot forward sightline open and the flap hinges at their original stations', () => {
    const a = buildC172()
    a.group.updateMatrixWorld(true)
    const ray = new THREE.Raycaster(new THREE.Vector3(0, 0.75, -0.35), new THREE.Vector3(0, 0, -1), 0, 1.8)
    // Test both faces: the old opaque cabin box only appeared open because
    // its inward-facing triangles were culled, despite no real windshield hole.
    const meshes: THREE.Mesh[] = []
    a.group.traverse(o => { if (o instanceof THREE.Mesh && !(o.material as THREE.Material).transparent) meshes.push(o) })
    const sides = meshes.map(m => (m.material as THREE.Material).side)
    meshes.forEach(m => { (m.material as THREE.Material).side = THREE.DoubleSide })
    const hits = ray.intersectObjects(meshes, false)
    meshes.forEach((m, i) => { (m.material as THREE.Material).side = sides[i]! })
    expect(hits).toHaveLength(0)
    const hinges = a.group.children.filter(o => o instanceof THREE.Group && Math.abs(o.position.z - 0.47) < 1e-6)
    expect(hinges.map(o => o.position.x)).toEqual([-1.68, 1.68])
  })
  it('has a swept fin and a rounded wing leading edge with the original span', () => {
    const a = buildC172()
    const fin = a.group.getObjectByName('c172Fin') as THREE.Mesh
    expect(fin).toBeDefined()
    const p = fin.geometry.getAttribute('position')
    const top: number[] = [], bottom: number[] = []
    for (let i = 0; i < p.count; i++) {
      if (p.getY(i) > 1.7) top.push(p.getZ(i))
      if (p.getY(i) < 0.45) bottom.push(p.getZ(i))
    }
    expect(Math.min(...top)).toBeGreaterThan(Math.min(...bottom) + 0.6)
    const wing = a.group.getObjectByName('c172Wing') as THREE.Mesh
    wing.geometry.computeBoundingBox()
    expect(wing.geometry.boundingBox!.max.x - wing.geometry.boundingBox!.min.x).toBeCloseTo(11, 3)
    const n = wing.geometry.getAttribute('normal')
    let curved = 0
    for (let i = 0; i < n.count; i++) if (Math.abs(n.getY(i)) > 0.2 && Math.abs(n.getZ(i)) > 0.2) curved++
    expect(curved).toBeGreaterThan(10)
  })
})
