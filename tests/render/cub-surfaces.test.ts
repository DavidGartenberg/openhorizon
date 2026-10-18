import * as THREE from 'three'
import { describe, it, expect } from 'vitest'
import { buildDetailedCub } from '../../src/render/cub-mesh'

describe('detailed Cub airframe', () => {
  it('has the documented continuous wing span and original tire contacts / prop rig', () => {
    const a = buildDetailedCub()
    const wing = a.group.getObjectByName('cubWing') as THREE.Mesh
    const bounds = new THREE.Box3().setFromObject(wing)
    expect(bounds.max.x - bounds.min.x).toBeCloseTo(10.74, 4)
    a.group.updateMatrixWorld(true)
    const topHit = new THREE.Raycaster(new THREE.Vector3(2,2,-.15),new THREE.Vector3(0,-1,0)).intersectObject(wing)
    expect(topHit.length).toBeGreaterThan(0)
    expect(topHit[0]!.face!.normal.y).toBeGreaterThan(0)
    let draws = 0
    a.group.traverse(o => { if (o instanceof THREE.Mesh) draws++ })
    // Split original skins plus ten physical horns and five actuator cylinders.
    expect(draws).toBeLessThan(56)
    const wheels: THREE.Object3D[] = []
    a.group.traverse(o => { if (o.name === 'aircraftWheel') wheels.push(o) })
    expect(wheels).toHaveLength(3)
    expect(new THREE.Box3().setFromObject(wheels[0]!).min.y).toBeCloseTo(-1.25)
    expect(new THREE.Box3().setFromObject(wheels[2]!).min.y).toBeCloseTo(-.60)
    expect(a.propDisc.position.toArray()).toEqual([0, .1, -2.02])
    expect((a.propDisc.material as THREE.Material).depthWrite).toBe(false)
    expect((a.propDisc.userData.blade.material as THREE.Material).depthWrite).toBe(false)
  })
  it('leaves the GA pilot forward sightline open through transparent glazing', () => {
    const a = buildDetailedCub(); a.group.updateMatrixWorld(true)
    const meshes: THREE.Mesh[] = []
    a.group.traverse(o => { if (o instanceof THREE.Mesh && !(o.material as THREE.Material).transparent) meshes.push(o) })
    const sides = meshes.map(o => (o.material as THREE.Material).side)
    meshes.forEach(o => { (o.material as THREE.Material).side = THREE.DoubleSide })
    const hits = new THREE.Raycaster(new THREE.Vector3(0,.75,-.35), new THREE.Vector3(0,0,-1),0,1.6).intersectObjects(meshes, false)
    meshes.forEach((o,i) => { (o.material as THREE.Material).side = sides[i]! })
    expect(hits).toHaveLength(0)
  })
})
