import { describe, expect, it } from 'vitest'
import * as THREE from 'three'
import { Clouds } from '../../src/render/clouds'

const slab = { cover: 'OVC' as const, baseMslFt: 2000, topMslFt: 5000 }
function field(scene: THREE.Scene) {
  return (scene.children[0] as THREE.Mesh).geometry as THREE.InstancedBufferGeometry
}
describe('volumetric cloud field', () => {
  it('bounds every volume exactly within its reported slab', () => {
    const scene = new THREE.Scene()
    new Clouds(scene).update([slab], new THREE.Vector3(), 0, 0, 1)
    const geo = field(scene)
    const radii = geo.getAttribute('radii')
    expect(radii).toBeDefined()
    const centers = geo.getAttribute('offset')
    for (let i = 0; i < geo.instanceCount; i++) {
      expect(centers.getY(i) - radii.getY(i)).toBeCloseTo(609.6, 3)
      expect(centers.getY(i) + radii.getY(i)).toBeCloseTo(1524, 3)
    }
  })
  it('keeps world density anchors stable through a rebase', () => {
    const scene = new THREE.Scene()
    const clouds = new Clouds(scene)
    clouds.update([slab], new THREE.Vector3(120, 100, -230), 0, 0, 1)
    const before = Array.from(field(scene).getAttribute('offset').array)
    const seeds = Array.from(field(scene).getAttribute('seed').array)
    clouds.onRebase()
    clouds.update([slab], new THREE.Vector3(-9880, 100, 19770), 10000, 20000, 1)
    const after = field(scene).getAttribute('offset')
    expect(Array.from(field(scene).getAttribute('seed').array)).toEqual(seeds)
    for (let i = 0; i < field(scene).instanceCount; i++) {
      expect(after.getX(i) + 10000).toBeCloseTo(before[i * 3]!, 2)
      expect(after.getZ(i) - 20000).toBeCloseTo(before[i * 3 + 2]!, 2)
    }
  })
  it('gives shallow scattered layers compact billow proportions', () => {
    const scene = new THREE.Scene()
    new Clouds(scene).update([{cover: 'SCT', baseMslFt: 2000, topMslFt: 3000}], new THREE.Vector3(), 0, 0, 1)
    const geo = field(scene)
    const radii = geo.getAttribute('radii')
    expect(geo.instanceCount).toBeGreaterThan(0)
    for (let i = 0; i < geo.instanceCount; i++) expect(radii.getX(i) / radii.getY(i)).toBeLessThan(4.2)
  })
  it('rebuilds bounds when the reported cloud top changes', () => {
    const scene = new THREE.Scene()
    const clouds = new Clouds(scene)
    clouds.update([slab], new THREE.Vector3(), 0, 0, 1)
    clouds.update([{ ...slab, topMslFt: 6000 }], new THREE.Vector3(), 0, 0, 1)
    const geo = field(scene)
    expect(geo.getAttribute('radii')).toBeDefined()
    expect(geo.getAttribute('offset').getY(0) + geo.getAttribute('radii').getY(0)).toBeCloseTo(1828.8, 3)
  })
})

describe('local cloud immersion', () => {
  it('has no extinction in a gap at the height of a scattered layer', () => {
    const scene = new THREE.Scene()
    const clouds = new Clouds(scene)
    clouds.update([{cover: 'SCT', baseMslFt: 2000, topMslFt: 3000}], new THREE.Vector3(), 0, 0, 1)
    const geo = field(scene), offsets = geo.getAttribute('offset'), radii = geo.getAttribute('radii')
    let gap: THREE.Vector3 | undefined
    for (let x = -2000; x <= 2000 && !gap; x += 100) {
      const point = new THREE.Vector3(x, 762, 0)
      let occupied = false
      for (let i = 0; i < geo.instanceCount; i++) {
        if (((x - offsets.getX(i)) / radii.getX(i)) ** 2 + (offsets.getZ(i) / radii.getZ(i)) ** 2 < 1) occupied = true
      }
      if (!occupied) gap = point
    }
    expect(gap).toBeDefined()
    expect(clouds.extinctionAt(gap!)).toBe(0)
  })
  it('has positive extinction in occupied cloud, zero above/below, and stable rebase density', () => {
    const scene = new THREE.Scene()
    const clouds = new Clouds(scene)
    clouds.update([slab], new THREE.Vector3(), 0, 0, 1)
    const centers = field(scene).getAttribute('offset')
    const last = field(scene).instanceCount - 1
    const point = new THREE.Vector3(centers.getX(last), centers.getY(last), centers.getZ(last))
    const before = clouds.extinctionAt(point)
    expect(before).toBeGreaterThan(0.001)
    expect(clouds.extinctionAt(new THREE.Vector3(point.x, 600, point.z))).toBe(0)
    expect(clouds.extinctionAt(new THREE.Vector3(point.x, 1600, point.z))).toBe(0)
    clouds.onRebase()
    const rebased = point.clone().add(new THREE.Vector3(-10000, 0, 20000))
    clouds.update([slab], rebased, 10000, 20000, 1)
    expect(clouds.extinctionAt(rebased)).toBeCloseTo(before, 6)
  })
})
