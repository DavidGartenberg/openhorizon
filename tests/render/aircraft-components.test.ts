import * as THREE from 'three'
import { describe, expect, it } from 'vitest'
import { buildAirliner, airlinerCfgFor } from '../../src/render/airliner-mesh'
import { profiledPanelGeometry, buildTurbofan, buildAircraftWheel } from '../../src/render/aircraft-components'

describe('shared aircraft components', () => {
  it('preserves swept planform stations and thickness while rounding both surfaces', () => {
    for (const side of [-1, 1]) {
      const geo = profiledPanelGeometry(4, 3, 1, 1, side, side * 8, 0.3)
      geo.computeBoundingBox()
      expect(geo.boundingBox!.min.y).toBeCloseTo(0)
      expect(geo.boundingBox!.max.y).toBeCloseTo(0.3)
      expect(geo.boundingBox!.min.z).toBeCloseTo(-4)
      expect(geo.boundingBox!.max.z).toBeCloseTo(0)
      const normals = geo.getAttribute('normal')
      let curved = 0
      for (let i = 0; i < normals.count; i++) if (Math.abs(normals.getY(i)) > .2 && Math.abs(normals.getZ(i)) > .2) curved++
      expect(curved).toBeGreaterThan(20)
      const panel = new THREE.Mesh(geo, new THREE.MeshBasicMaterial())
      panel.updateMatrixWorld(true)
      const capHits = new THREE.Raycaster(new THREE.Vector3(side * 9, .15, -.5), new THREE.Vector3(-side, 0, 0)).intersectObject(panel)
      expect(capHits.length).toBeGreaterThan(0)
      expect(capHits[0]!.point.x).toBeCloseTo(side * 8)
      for (const above of [-1, 1]) {
        const hits = new THREE.Raycaster(new THREE.Vector3(side * 4.5, above * 2, -1), new THREE.Vector3(0, -above, 0)).intersectObject(panel)
        expect(hits.length).toBeGreaterThan(0)
        expect(hits[0]!.face!.normal.y * above).toBeGreaterThan(0)
      }
    }
  })
  it('has an open intake with the fan behind the lip, and bounded blade draw calls', () => {
    const engine = buildTurbofan(1, 3)
    engine.updateMatrixWorld(true)
    const hits = new THREE.Raycaster(new THREE.Vector3(.5, 0, -3), new THREE.Vector3(0, 0, 1)).intersectObject(engine)
    expect(hits.length).toBeGreaterThan(0)
    expect(hits[0]!.point.z).toBeGreaterThan(-1.2)
    expect(engine.getObjectByName('fanBlades')).toBeInstanceOf(THREE.InstancedMesh)
    expect(engine.userData.reverserSleeve).toBeInstanceOf(THREE.Mesh)
    let meshes = 0
    engine.traverse(o => { if (o instanceof THREE.Mesh) meshes++ })
    expect(meshes).toBeLessThanOrEqual(10)
  })
  it('keeps tire contact radius and axle width', () => {
    const wheel = buildAircraftWheel(.6, .25)
    const bounds = new THREE.Box3().setFromObject(wheel)
    expect(bounds.min.y).toBeCloseTo(-.6)
    expect(bounds.max.y).toBeCloseTo(.6)
    expect(bounds.max.x - bounds.min.x).toBeCloseTo(.25)
    expect(wheel.getObjectByName('wheelHub')).toBeDefined()
  })
})


describe('fleet detail animation attachment', () => {
  it('keeps tire bottoms at gear contacts and sleeves on their engines through travel', () => {
    const cfg = airlinerCfgFor({ designator: 'A320', lengthM: 37.57, spanM: 35.8, powerplant: { kind: 'jet', count: 2 } })
    // Unpainted keeps this geometry check independent of browser canvas textures.
    cfg.designator = undefined
    const airliner = buildAirliner(cfg)
    const wheels: THREE.Object3D[] = [], sleeves: THREE.Object3D[] = []
    airliner.group.traverse(o => { if (o.name === 'aircraftWheel') wheels.push(o); if (o.name === 'reverserSleeve') sleeves.push(o) })
    airliner.surfaces!({ flapFrac: 0, spoilerFrac: 0, gearPos: 1, reverseFrac: 0 })
    airliner.group.updateMatrixWorld(true)
    expect(wheels).toHaveLength(6)
    for (const wheel of wheels) expect(new THREE.Box3().setFromObject(wheel).min.y).toBeCloseTo(-wheel.parent!.userData.contact.z, 5)
    expect(sleeves).toHaveLength(2)
    for (const sleeve of sleeves) expect(sleeve.parent!.name).toBe('turbofan')
    airliner.surfaces!({ flapFrac: 1, spoilerFrac: 1, gearPos: 0, reverseFrac: 1 })
    for (const wheel of wheels) expect(wheel.parent!.visible).toBe(false)
    for (const sleeve of sleeves) expect(sleeve.position.z).toBeCloseTo(.85)
  })
})
