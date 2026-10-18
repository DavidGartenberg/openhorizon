import * as THREE from 'three'
import { describe, expect, it } from 'vitest'
import { createHingeFrame, createLiveLinkage, linkageError } from '../../src/render/procedural-surfaces'

describe('procedural surface mechanisms', () => {
  it('rotates around the complete swept and dihedral hinge line', () => {
    const root = new THREE.Group()
    const a = new THREE.Vector3(-2, .4, 1)
    const b = new THREE.Vector3(3, .9, 1.8)
    const hinge = createHingeFrame(root, 'test-hinge', a, b)
    hinge.setAngle(.42)
    root.updateMatrixWorld(true)
    expect(hinge.worldEndpoints()[0].distanceTo(a)).toBeLessThan(1e-6)
    expect(hinge.worldEndpoints()[1].distanceTo(b)).toBeLessThan(1e-6)
    expect(hinge.root.quaternion.length()).toBeCloseTo(1, 6)
  })

  it('keeps a fixed-to-moving actuator attached and detects a disconnected endpoint', () => {
    const root = new THREE.Group()
    const hinge = createHingeFrame(root, 'test-hinge', new THREE.Vector3(-1,0,0), new THREE.Vector3(1,.2,.4))
    const fixed = new THREE.Object3D(), moving = new THREE.Object3D()
    fixed.position.set(-.4,-.1,.25); moving.position.set(-.4,.18,.42)
    root.add(fixed); hinge.root.add(moving)
    const linkage = createLiveLinkage(root, 'test-linkage', fixed, moving, .025)
    for (const angle of [-.5,-.25,0,.25,.5]) {
      hinge.setAngle(angle); linkage.update(); root.updateMatrixWorld(true)
      expect(linkageError(linkage)).toBeLessThan(1e-6)
      const rodEnds=[new THREE.Vector3(0,-.5,0),new THREE.Vector3(0,.5,0)].map(p=>linkage.rod.localToWorld(p))
      const mounts=[fixed,moving].map(m=>m.getWorldPosition(new THREE.Vector3()))
      expect(Math.min(rodEnds[0]!.distanceTo(mounts[0]!),rodEnds[0]!.distanceTo(mounts[1]!))).toBeLessThan(1e-6)
      expect(Math.min(rodEnds[1]!.distanceTo(mounts[0]!),rodEnds[1]!.distanceTo(mounts[1]!))).toBeLessThan(1e-6)
    }
    moving.position.x += .2 // required disconnected-endpoint mutation
    root.updateMatrixWorld(true)
    expect(linkageError(linkage)).toBeGreaterThan(.1)
  })
})
