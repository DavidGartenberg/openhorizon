import * as THREE from 'three'
import { describe,it,expect } from 'vitest'
import { buildJetNose } from '../../src/render/jet-finish'
import { buildC172,buildB738 } from '../../src/render/aircraft-mesh'
import { buildArchetype,buildArchetypeShip } from '../../src/render/fleet-mesh'

describe('aircraft surface integration',()=>{
 it('keeps the jet radome exterior-facing and inside its original attachment envelope',()=>{
  const nose=buildJetNose(1.88,3.196,new THREE.MeshStandardMaterial())
  nose.updateMatrixWorld(true)
  const surface=nose.getObjectByName('radome')!
  const hits=new THREE.Raycaster(new THREE.Vector3(0,4,-1),new THREE.Vector3(0,-1,0)).intersectObject(surface)
  expect(hits.length).toBeGreaterThan(0)
  expect(hits[0]!.point.y).toBeGreaterThan(1)
  const bounds=new THREE.Box3().setFromObject(surface)
  expect(bounds.max.z).toBeCloseTo(0);expect(bounds.min.z).toBeCloseTo(-3.196)
  nose.traverse(o=>{if(o.name==='cockpitGlazing'){expect(o.userData.exteriorCabin).toBe(true);expect((o as THREE.Mesh<THREE.BufferGeometry,THREE.Material>).material.depthWrite).toBe(false)}})
 })
 it('keeps the Cessna lower body and new fittings below the forward pilot sightline',()=>{
  const ship=buildC172();ship.group.updateMatrixWorld(true)
  const visible:THREE.Object3D[]=[]
  ship.group.traverse(o=>{if(o instanceof THREE.Mesh&&!o.userData.exteriorCabin&&!(o.material as THREE.Material).transparent)visible.push(o)})
  const rays=[new THREE.Vector3(-.33,.75,-.45),new THREE.Vector3(0,.75,-.45)]
  for(const eye of rays)expect(new THREE.Raycaster(eye,new THREE.Vector3(0,0,-1),0,2).intersectObjects(visible,false)).toHaveLength(0)
 })
 it('keeps dedicated737 gear tire contacts and engine sleeve travel after component replacement',()=>{
  const ship=buildB738();ship.surfaces!({flapFrac:0,spoilerFrac:0,gearPos:1,reverseFrac:0});ship.group.updateMatrixWorld(true)
  const wheels:THREE.Mesh[]=[];const engines:THREE.Object3D[]=[]
  ship.group.traverse(o=>{if(o.name==='tire')wheels.push(o as THREE.Mesh);if(o.name==='turbofan')engines.push(o)})
  expect(wheels).toHaveLength(6);expect(engines).toHaveLength(2)
  for(const w of wheels){const b=new THREE.Box3().setFromObject(w);expect(b.min.y).toBeCloseTo(w.getWorldPosition(new THREE.Vector3()).z < -10?-2.84:-2.9,3)}
  ship.surfaces!({flapFrac:1,spoilerFrac:1,gearPos:0,reverseFrac:1})
  for(const e of engines)expect((e.userData.reverserSleeve as THREE.Mesh).position.z).toBeCloseTo(.85)
 })
})


it('upgrades player archetype surfaces without changing traffic geometry or wing envelope',()=>{
 const spec={archetype:'ga-low-wing' as const,spanM:10.8,lengthM:8.2,engines:1,quad:false}
 const traffic=buildArchetype(spec),player=buildArchetypeShip(spec).group.children[0] as THREE.Mesh
 expect(traffic.material).not.toBe(player.material)
 const a=new THREE.Box3().setFromObject(traffic),b=new THREE.Box3().setFromObject(player)
 expect(b.min.distanceTo(a.min)).toBeLessThan(.001);expect(b.max.distanceTo(a.max)).toBeLessThan(.001)
 expect(player.geometry.getAttribute('position').count).toBeGreaterThan(traffic.geometry.getAttribute('position').count)
 expect(player.geometry.getAttribute('position').count).toBeLessThan(40000)
})
