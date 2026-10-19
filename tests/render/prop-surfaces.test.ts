import * as THREE from 'three'
import { describe, expect, it } from 'vitest'
import { ROSTER } from '../../src/sim/aircraft/roster'
import { deriveParams } from '../../src/sim/aircraft/derive'
import { buildPropAircraft } from '../../src/render/prop-aircraft'
import { buildDetailedCub } from '../../src/render/cub-mesh'
import type { AircraftMesh, SurfaceState } from '../../src/render/aircraft-mesh'
import { linkageError, type LiveLinkage } from '../../src/render/procedural-surfaces'

const neutral:SurfaceState={flapFrac:0,spoilerFrac:0,gearPos:1,roll:0,pitch:0,yaw:0}
function vertexWorld(o:THREE.Object3D,index:number):THREE.Vector3 {
  const m=o as THREE.Mesh, p=m.geometry.getAttribute('position')
  return new THREE.Vector3().fromBufferAttribute(p,index).applyMatrix4(m.matrixWorld)
}
function expectMoves(model:AircraftMesh,name:string,state:SurfaceState):void {
  const skin=model.group.getObjectByName(name) as THREE.Mesh
  expect(skin?.geometry.index,name).toBeTruthy()
  const indices=Array.from(skin.geometry.index!.array as ArrayLike<number>)
  model.surfaces!(neutral);model.group.updateMatrixWorld(true);const before=indices.map(i=>vertexWorld(skin,i))
  model.surfaces!(state);model.group.updateMatrixWorld(true);const after=indices.map(i=>vertexWorld(skin,i))
  expect(Math.max(...after.map((p,i)=>p.distanceTo(before[i]!))),name).toBeGreaterThan(1e-4)
  model.surfaces!(neutral);model.group.updateMatrixWorld(true)
  expect(Math.max(...indices.map((ix,i)=>vertexWorld(skin,ix).distanceTo(before[i]!))),name).toBeLessThan(1e-7)
}
function center(o:THREE.Object3D):THREE.Vector3 { return new THREE.Box3().setFromObject(o).getCenter(new THREE.Vector3()) }
function skinEndpointError(skin:THREE.Mesh):number {
  const hinge=skin.userData.hinge as THREE.Object3D, length=hinge.userData.hingeLength as number
  skin.updateWorldMatrix(true,false);hinge.updateWorldMatrix(true,false)
  const ends=[hinge.localToWorld(new THREE.Vector3()),hinge.localToWorld(new THREE.Vector3(length,0,0))]
  const p=skin.geometry.getAttribute('position'),v=new THREE.Vector3()
  return Math.max(...ends.map(end=>{
    let best=Infinity
    const ix=skin.geometry.index!.array,triangle=new THREE.Triangle();for(let i=0;i<ix.length;i+=3){triangle.a.fromBufferAttribute(p,ix[i]!).applyMatrix4(skin.matrixWorld);triangle.b.fromBufferAttribute(p,ix[i+1]!).applyMatrix4(skin.matrixWorld);triangle.c.fromBufferAttribute(p,ix[i+2]!).applyMatrix4(skin.matrixWorld);best=Math.min(best,triangle.closestPointToPoint(end,v).distanceTo(end))}
    return best
  }))
}

describe('procedural prop moving skins',()=>{
  it('covers every non-jet profile with bounded signed moving skins',()=>{
    for(const {spec,opts} of ROSTER.filter(x=>x.spec.powerplant.kind!=='jet')){
      const model=buildPropAircraft(spec,deriveParams(spec,opts))
      expect(model.surfaces,spec.designator).toBeTypeOf('function')
      if(spec.designator!=='MU2') expectMoves(model,spec.designator==='DG80'?'flaperon-right':'aileron-right',{...neutral,roll:1})
      expectMoves(model, spec.designator==='BE35'?'ruddervator-right':'elevator-right',{...neutral,pitch:1})
      expectMoves(model, spec.designator==='BE35'?'ruddervator-right':'rudder',{...neutral,yaw:1})
      for(const f of [0,.25,.5,.75,1]) {
        model.surfaces!({...neutral,flapFrac:f,spoilerFrac:f,roll:2*f-1,pitch:1-2*f,yaw:2*f-1});model.group.updateMatrixWorld(true)
        for(const linkage of model.group.userData.surfaceLinkages as LiveLinkage[])expect(linkageError(linkage),`${spec.designator}@${f}`).toBeLessThan(1e-5)
      }
      model.surfaces!({...neutral,flapFrac:Number.NaN,roll:Infinity,pitch:Number.NaN,yaw:-Infinity})
      model.group.updateMatrixWorld(true)
      model.group.traverse(o=>expect(o.matrixWorld.elements.every(Number.isFinite),spec.designator).toBe(true))
      expect(model.group.getObjectByName('wingTrailingFixed-outboard-right')).toBeUndefined()
      const rollSkin=model.group.getObjectByName(spec.designator==='DG80'?'flaperon-right':spec.designator==='MU2'?'rollSpoiler-right':'aileron-right') as THREE.Mesh
      expect(skinEndpointError(rollSkin),spec.designator).toBeLessThan(spec.designator==='MU2'?.02:1e-4)
      if(spec.designator==='MU2') {
        expect(model.group.getObjectByName('aileron-right')).toBeUndefined()
        expect(model.group.getObjectByName('rollSpoiler-right')).toBeTruthy()
        expect(model.group.getObjectByName('flap-secondary-slot-right')).toBeTruthy()
        const flapBounds=new THREE.Box3().setFromObject(model.group.getObjectByName('flap-right')!)
        expect(flapBounds.max.x,spec.designator).toBeGreaterThan(spec.spanM*.45)
      }
      if(spec.designator==='AN2') expect(model.group.getObjectByName('lower-aileron-right')).toBeUndefined()
      if(['AS21','LS8','DISC','DG80'].includes(spec.designator)) expect(model.group.getObjectByName('airbrake-right')).toBeTruthy()
      if(['AS21','LS8','DISC'].includes(spec.designator)) expect(model.group.getObjectByName('wingTrailingFixed-mid-right')).toBeTruthy()
      if(spec.designator==='AN2') expect(model.group.getObjectByName('lower-flap-right')).toBeTruthy()
    }
  },60000)

  it('honors explicit DG80 flaperon angles without adding roll',()=>{
    const entry=ROSTER.find(x=>x.spec.designator==='DG80')!
    const model=buildPropAircraft(entry.spec,deriveParams(entry.spec,entry.opts))
    const right=model.group.getObjectByName('flaperon-right')!
    model.surfaces!({...neutral,roll:1,flaperonLeftRad:.12,flaperonRightRad:-.2,flapsDeg:-9})
    expect(right.userData.surfaceAngle).toBeCloseTo(-.2)
    expect(model.group.getObjectsByProperty('name','flaperon-drive-right')).toHaveLength(2)
  })

  it('uses aerodynamic sign conventions for right roll, pull and right yaw',()=>{
    const entry=ROSTER.find(x=>x.spec.designator==='C182')!, model=buildPropAircraft(entry.spec,deriveParams(entry.spec,entry.opts))
    const right=model.group.getObjectByName('aileron-right')!,left=model.group.getObjectByName('aileron-left')!,elevator=model.group.getObjectByName('elevator-right')!,rudder=model.group.getObjectByName('rudder')!
    model.surfaces!(neutral);model.group.updateMatrixWorld(true)
    const ar=center(right),al=center(left),ep=center(elevator),rp=center(rudder)
    model.surfaces!({...neutral,roll:1,pitch:1,yaw:1});model.group.updateMatrixWorld(true)
    expect(center(right).y).toBeGreaterThan(ar.y)
    expect(center(left).y).toBeLessThan(al.y)
    expect(center(elevator).y).toBeGreaterThan(ep.y)
    expect(center(rudder).x).toBeGreaterThan(rp.x)
  })

  it('gives the flapless Cub actual aileron, elevator and rudder skins',()=>{
    const model=buildDetailedCub()
    expect(model.group.getObjectByName('cubFlap')).toBeUndefined()
    expect(skinEndpointError(model.group.getObjectByName('cubAileron-right') as THREE.Mesh)).toBeLessThan(1e-5)
    expect(skinEndpointError(model.group.getObjectByName('cubElevator-right') as THREE.Mesh)).toBeLessThan(1e-5)
    expectMoves(model,'cubAileron-right',{...neutral,roll:1})
    expectMoves(model,'cubElevator-right',{...neutral,pitch:1})
    expectMoves(model,'cubRudder',{...neutral,yaw:1})
  })
})
