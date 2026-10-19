import { describe, expect, it } from 'vitest'
import * as THREE from 'three'
import { primaryRunway, planAirportFacilities, buildAirportFacilities, updateAirportServices, disposeAirportObject, mappedApronPlan, type SurfaceObstacle } from '../src/world/airport-scenery'
import type { AirportData } from '../src/world/airports'
const airport = (soft = false, type = 0): AirportData => ({ i:'TEST', n:'Test', la:0, lo:0, e:100, t:type, r:[{ li:'18', hi:'36', la1:-.003,lo1:0,la2:.003,lo2:0,e1:100,e2:110,l:2000,w:50,s:soft?1:0,lt:0 }] })
describe('populated airport planning', () => {
  it('covers short hard and soft runways with modest facilities', () => {
    for (const soft of [false,true]) {
      const p=planAirportFacilities(airport(soft))!
      expect(p).toBeTruthy(); expect(p.scale).toBe('strip'); expect(p.fleetCount).toBe(2)
      const g=buildAirportFacilities(p)
      expect(g.getObjectByName('FBO')).toBeTruthy(); expect(g.getObjectByName('hangar')).toBeTruthy()
      expect(g.getObjectByName('airportServices')).toBeTruthy()
    }
  })
  it('selects exactly one primary deterministically even with equal lengths', () => {
    const a=airport(); a.r.push({...a.r[0]!,li:'09',hi:'27'})
    expect(primaryRunway(a)?.li).toBe('09'); a.r.reverse(); expect(primaryRunway(a)?.li).toBe('09')
  })
  it('scales airline facilities by airport class and runway capability', () => {
    const a=airport(false,2); expect(planAirportFacilities(a)!.scale).toBe('strip')
    a.r[0]!.l=10000; const p=planAirportFacilities(a)!
    expect(p.scale).toBe('commercial'); expect(p.fleetCount).toBe(8)
    expect(buildAirportFacilities(p).getObjectByName('terminal')).toBeTruthy()
  })
  it('avoids crossing runways and known taxiways with the entire compound', () => {
    const a=airport(); a.r.push({...a.r[0]!,li:'09',hi:'27',la1:0,la2:0,lo1:-.01,lo2:.01})
    const obstacles: SurfaceObstacle[]=[{a:{x:60,z:-1000},b:{x:60,z:1000},radius:20}]
    const p=planAirportFacilities(a,obstacles)!
    expect(p).toBeTruthy()
    for(const q of p.route) { expect(Math.abs(q.x)).toBeGreaterThan(30); expect(Math.abs(q.z)).toBeGreaterThan(30); expect(Math.abs(q.x-60)).toBeGreaterThan(20) }
    expect(planAirportFacilities(a,obstacles)).toEqual(p)
  })
  it('leaves hangar door approach clear for aircraft wings', () => {
    const g=buildAirportFacilities(planAirportFacilities(airport(true))!)
    g.position.set(0,0,0);g.rotation.set(0,0,0);g.updateMatrixWorld(true)
    const hangar=g.getObjectByName('hangar')!
    const ray=new THREE.Raycaster(new THREE.Vector3(hangar.position.x-9.8,5,hangar.position.z),new THREE.Vector3(0,-1,0))
    const hit=ray.intersectObject(g,true)[0]!
    expect(hit.point.y).toBeLessThan(.5)
  })
  it('uses safe mapped aprons and rejects narrow or concave route envelopes', () => {
    const a=airport()
    const poly=[{x:200,z:-100},{x:400,z:-100},{x:400,z:100},{x:200,z:100}]
    const p=mappedApronPlan(a,[poly],[],32)!
    expect(p).toBeTruthy();expect(p.elevation).toBe(32)
    expect(p.route.every(q=>q.x>200&&q.x<400&&q.z>-100&&q.z<100)).toBe(true)
    expect(mappedApronPlan(a,[[{x:200,z:0},{x:210,z:0},{x:210,z:100},{x:200,z:100}]],[],0)).toBeNull()
    expect(mappedApronPlan(a,[poly],[{a:{x:300,z:-200},b:{x:300,z:200},radius:150}],0)).toBeNull()
  })
  it('bounds commercial geometry and shares material lifetime across airports', () => {
    const a=airport(false,2);a.r[0]!.l=10000
    const first=buildAirportFacilities(planAirportFacilities(a)!),second=buildAirportFacilities(planAirportFacilities(a)!)
    let meshes=0,materialDisposals=0
    second.traverse(o=>{if(o instanceof THREE.Mesh){meshes++;for(const m of Array.isArray(o.material)?o.material:[o.material])m.addEventListener('dispose',()=>materialDisposals++)}})
    expect(meshes).toBeLessThan(65);disposeAirportObject(first);expect(materialDisposals).toBe(0)
    expect(second.getObjectByName('airportServices')!.children).toHaveLength(8)
  })
  it('moves only with simulation time, keeps bounded resources, and disposes once', () => {
    const g=buildAirportFacilities(planAirportFacilities(airport())!)
    const services=g.getObjectByName('airportServices')!
    updateAirportServices(g,10); const before=services.children.map(o=>o.position.clone())
    updateAirportServices(g,10); expect(services.children.map(o=>o.position.clone())).toEqual(before)
    updateAirportServices(g,15); expect(services.children.map(o=>o.position.clone())).not.toEqual(before)
    let meshes=0, disposed=0; const geometries=new Set<THREE.BufferGeometry>()
    g.traverse(o=>{if(o instanceof THREE.Mesh){meshes++;geometries.add(o.geometry)}})
    expect(meshes).toBeLessThan(35)
    geometries.forEach(geo=>geo.addEventListener('dispose',()=>disposed++))
    disposeAirportObject(g);disposeAirportObject(g);expect(disposed).toBe(geometries.size)
  })
})
