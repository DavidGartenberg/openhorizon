import * as THREE from 'three'
import { it, expect } from 'vitest'
import { ROSTER } from '../../src/sim/aircraft/roster'
import { deriveParams } from '../../src/sim/aircraft/derive'
import { buildPropAircraft } from '../../src/render/prop-aircraft'
import { buildDetailedCub } from '../../src/render/cub-mesh'
import type { AircraftMesh, SurfaceState } from '../../src/render/aircraft-mesh'
import { triangles, distanceToTriangles, indexedPoints, cylinderEnds } from './surface-geometry-assertions'
import type { LiveLinkage } from '../../src/render/procedural-surfaces'
import { PROP_PROFILES } from '../../src/render/prop-profiles'
const neutral:SurfaceState={flapFrac:0,gearPos:1,roll:0,pitch:0,yaw:0,spoilerFrac:0}
function build(id:string){const {spec,opts}=ROSTER.find(x=>x.spec.designator===id)!;return buildPropAircraft(spec,deriveParams(spec,opts))}
function points(m:THREE.Mesh){m.updateWorldMatrix(true,false);const p=m.geometry.getAttribute('position');return [...new Set(Array.from(m.geometry.index!.array))].map(i=>new THREE.Vector3().fromBufferAttribute(p,i).applyMatrix4(m.matrixWorld))}
function distance(m:THREE.Mesh,v:THREE.Vector3){const p=m.geometry.getAttribute('position'),ix=m.geometry.index!.array;let d=Infinity;const tri=new THREE.Triangle(),q=new THREE.Vector3();for(let i=0;i<ix.length;i+=3){tri.a.fromBufferAttribute(p,ix[i]!).applyMatrix4(m.matrixWorld);tri.b.fromBufferAttribute(p,ix[i+1]!).applyMatrix4(m.matrixWorld);tri.c.fromBufferAttribute(p,ix[i+2]!).applyMatrix4(m.matrixWorld);d=Math.min(d,tri.closestPointToPoint(v,q).distanceTo(v))}return d}
function center(m:THREE.Mesh){return points(m).reduce((a,p)=>a.add(p),new THREE.Vector3()).divideScalar(points(m).length)}
function skin(a:AircraftMesh,n:string){return a.group.getObjectByName(n) as THREE.Mesh}
function fixedName(m:THREE.Mesh){return m.name.startsWith('cubAileron')?'cubWing':m.name.startsWith('cubElevator')?'cubStabilizerFixed':m.name==='cubRudder'?'cubFinFixed':m.name==='rudder'?'verticalFin':m.name.startsWith('ruddervator')?'vTailFixed':m.name.startsWith('elevator')?'horizontalStabilizerFixed':m.name.startsWith('lower-flap')?'lowerBiplaneWingForward':'wingForward'}
it('neutral rudders retain vertical height and fit their fin planes',()=>{for(const [a,n] of [[build('C182'),'rudder'],[buildDetailedCub(),'cubRudder']] as const){const b=new THREE.Box3().setFromPoints(points(skin(a,n)));expect(b.max.x-b.min.x).toBeLessThan(.15);expect(b.max.y-b.min.y).toBeGreaterThan(1)}})
it('every flap moves down bilaterally throughout deployment',()=>{for(const {spec} of ROSTER.filter(x=>x.spec.powerplant.kind!=='jet')){const a=build(spec.designator);for(const side of ['left','right'])for(const prefix of ['flap','lower-flap']){const m=skin(a,`${prefix}-${side}`);if(!m)continue;a.surfaces!(neutral);const y=center(m).y;for(const f of [.25,.5,.75,1]){a.surfaces!({...neutral,flapFrac:f});expect(center(m).y,`${spec.designator} ${m.name} ${f}`).toBeLessThan(y-1e-4)}}}},60000)
it('differential travel follows up/down direction under both roll signs',()=>{const a=build('C182');for(const sign of [-1,1]){a.surfaces!({...neutral,roll:sign});const up=skin(a,`aileron-${sign>0?'right':'left'}`).userData.surfaceAngle;const down=skin(a,`aileron-${sign>0?'left':'right'}`).userData.surfaceAngle;expect(-up).toBeGreaterThan(down*1.8)}})
it('MU2 roll spoilers and sailplane airbrakes both rise',()=>{for(const id of ['MU2','AS21','DG80','LS8','DISC']){const a=build(id);for(const side of ['left','right']){const m=skin(a,`${id==='MU2'?'rollSpoiler':'airbrake'}-${side}`);a.surfaces!(neutral);const y=center(m).y;for(const f of [.25,.5,.75,1]){a.surfaces!({...neutral,spoilerFrac:id==='MU2'?0:f,roll:id==='MU2'?(side==='right'?f:-f):0});expect(center(m).y,`${id} ${side}`).toBeGreaterThan(y+.001)}}}})
it('Cub retains the original inboard and rounded tip trailing envelope',()=>{const a=buildDetailedCub();const wing=skin(a,'cubWing');for(const x of [0,1,5.30]){const ray=new THREE.Raycaster(new THREE.Vector3(x,2,x>5?.03:.55),new THREE.Vector3(0,-1,0));expect(ray.intersectObject(wing).length,`x=${x}`).toBeGreaterThan(0)}})
it('Cub stabilizer split is mirror symmetric',()=>{const a=buildDetailedCub();const fixed:THREE.Mesh[]=[];a.group.traverse(o=>{if(o instanceof THREE.Mesh&&o.name==='cubStabilizerFixed')fixed.push(o)});const p=fixed.flatMap(points);for(const v of p){const mirror=v.clone();mirror.x*=-1;expect(Math.min(...fixed.map(m=>distance(m,mirror)))).toBeLessThan(1e-6)}})

it('entire neutral cut boundaries meet the original fixed skin across the fleet',()=>{
 for(const a of [...ROSTER.filter(x=>x.spec.powerplant.kind!=='jet').map(x=>build(x.spec.designator)),buildDetailedCub()]){
  a.surfaces!(neutral);a.group.updateMatrixWorld(true)
  const skins:THREE.Mesh[]=[];a.group.traverse(o=>{if(o instanceof THREE.Mesh&&o.userData.hinge)skins.push(o)})
  for(const m of skins){
   if(/upper-tier|secondary-slot/.test(m.name))continue
   const hinge=m.userData.hinge as THREE.Object3D,axis=new THREE.Vector3(1,0,0).transformDirection(hinge.matrixWorld),origin=hinge.getWorldPosition(new THREE.Vector3())
   const side=m.name.includes('left')?-1:1,vertical=/udder/.test(m.name)&&!m.name.includes('ruddervator')
   const thickness=vertical?new THREE.Vector3(1,0,0):m.name.includes('ruddervator')?new THREE.Vector3(-side*Math.sin(.59),Math.cos(.59),0):new THREE.Vector3(0,1,0)
   const plane=new THREE.Plane().setFromNormalAndCoplanarPoint(new THREE.Vector3().crossVectors(axis,thickness).normalize(),origin)
   if(plane.distanceToPoint(center(m))<0)plane.negate()
   const name=fixedName(m)
   const fixed:THREE.Triangle[]=[];a.group.traverse(o=>{if(o instanceof THREE.Mesh&&o.name===name)fixed.push(...triangles(o))})
   const boundary=indexedPoints(m).filter(p=>Math.abs(plane.distanceToPoint(p))<2e-5)
   expect(boundary.length,`${a.group.name} ${m.name}`).toBeGreaterThan(3)
   for(const p of boundary)expect(distanceToTriangles(p,fixed),`${a.group.name} ${m.name}`).toBeLessThan(3e-5)
   // Check the actual fixed triangles over the entire moving span; a second
   // intact skin beneath a painted control must fail, even if boundaries meet.
   const end=hinge.localToWorld(new THREE.Vector3(hinge.userData.hingeLength,0,0)),coordinate=vertical?'y':'x',lo=Math.min(origin[coordinate],end[coordinate]),hi=Math.max(origin[coordinate],end[coordinate])
   for(const tri of /airbrake|rollSpoiler/.test(m.name)?[]:fixed){const p=tri.getMidpoint(new THREE.Vector3());if(p[coordinate]>lo+2e-5&&p[coordinate]<hi-2e-5)expect(plane.distanceToPoint(p),`${a.group.name} ${m.name}: fixed overlap`).toBeLessThan(3e-5)}
  }
 }
},60000)

function hornError(mount:THREE.Object3D):number{
 const bracket=mount.userData.bracket as THREE.Mesh,skin=mount.userData.skin as THREE.Mesh
 if(!bracket||!skin)return Infinity
 const ends=cylinderEnds(bracket),p=mount.getWorldPosition(new THREE.Vector3()),tris=triangles(skin)
 return Math.min(Math.max(ends[0].distanceTo(p),distanceToTriangles(ends[1],tris)),Math.max(ends[1].distanceTo(p),distanceToTriangles(ends[0],tris)))
}
it('physical horns meet skin triangles and live cylinder ends at signed travel, detecting a floating assembly',()=>{
 for(const id of [...ROSTER.filter(x=>x.spec.powerplant.kind!=='jet').map(x=>x.spec.designator),'CUB']){
  const a=id==='CUB'?buildDetailedCub():build(id),links=a.group.userData.surfaceLinkages as LiveLinkage[]
  for(const f of [0,.25,.5,.75,1])for(const sign of [-1,1]){
   a.surfaces!({...neutral,flapFrac:f,spoilerFrac:f,roll:sign*f,pitch:sign*f,yaw:sign*f,flaperonLeftRad:sign*f*.49,flaperonRightRad:-sign*f*.50});a.group.updateMatrixWorld(true)
   for(const l of links){
    const ends=cylinderEnds(l.rod),mounts=[l.fixedMount,l.movingMount].map(m=>m.getWorldPosition(new THREE.Vector3()))
    expect(Math.min(Math.max(ends[0].distanceTo(mounts[0]!),ends[1].distanceTo(mounts[1]!)),Math.max(ends[1].distanceTo(mounts[0]!),ends[0].distanceTo(mounts[1]!)))).toBeLessThan(2e-5)
    for(const m of [l.fixedMount,l.movingMount]){
     if(m.userData.rail){const ends=cylinderEnds(m.userData.rail);expect(Math.min(...ends.map(p=>p.distanceTo(m.getWorldPosition(new THREE.Vector3()))))).toBeLessThan(2e-5)}
     else if(m.userData.carriage){expect(m.getWorldPosition(new THREE.Vector3()).distanceTo(new THREE.Box3().setFromObject(m.userData.carriage).getCenter(new THREE.Vector3()))).toBeLessThan(2e-5)}
     else expect(hornError(m),`${id} ${m.name}`).toBeLessThan(2e-5)
    }
   }
  }
  const l=links.find(l=>l.movingMount.userData.bracket)!,mount=l.movingMount,bracket=mount.userData.bracket as THREE.Mesh
  mount.position.y+=.30;bracket.position.y+=.30;l.update()
  expect(hornError(mount),`${id}: moved mount, horn and live rod together`).toBeGreaterThan(.04)
 }
},60000)

it('spoiler wells expose lower skin instead of an intact upper wing',()=>{
 for(const id of ['MU2','DG80','AS21','LS8','DISC']){
  const a=build(id)
  for(const side of ['left','right']){
   const moving=skin(a,`${id==='MU2'?'rollSpoiler':'airbrake'}-${side}`),p=center(moving),fixed:THREE.Mesh[]=[]
   a.group.traverse(o=>{if(o instanceof THREE.Mesh&&o.name==='wingForward')fixed.push(o)})
   const ray=new THREE.Raycaster(new THREE.Vector3(p.x,p.y+1,p.z),new THREE.Vector3(0,-1,0),0,2)
   expect(ray.intersectObjects(fixed,false),`${id} ${side}: upper skin excluded`).toHaveLength(0)
   expect(ray.intersectObject(skin(a,`brake-well-${side}`)).length).toBeGreaterThan(0)
  }
 }
})

it('all signed controls move actual indexed skins in the correct world direction',()=>{
 for(const {spec} of ROSTER.filter(x=>x.spec.powerplant.kind!=='jet')){
  const a=build(spec.designator)
  for(const sign of [-1,1])for(const f of [.25,.5,.75,1]){
   const names=['aileron-left','aileron-right','flaperon-left','flaperon-right','elevator-left','elevator-right','ruddervator-left','ruddervator-right','rudder']
   for(const name of names){const m=skin(a,name);if(!m)continue
    a.surfaces!(neutral);const before=center(m),roll=/aileron|flaperon/.test(name),rudder=name==='rudder'
    a.surfaces!({...neutral,roll:roll?sign*f:0,pitch:!roll&&!rudder?sign*f:0,yaw:rudder?sign*f:0})
    const delta=center(m).sub(before),side=name.endsWith('left')?-1:1
    expect((rudder?delta.x:delta.y)*sign*(roll?side:1),`${spec.designator} ${name} ${sign} ${f}`).toBeGreaterThan(1e-4)
   }
  }
 }
},60000)

it('the complete stationary hinge line remains in both actual skins at signed travel',()=>{
 for(const a of [...ROSTER.filter(x=>x.spec.powerplant.kind!=='jet').map(x=>build(x.spec.designator)),buildDetailedCub()]){
  const list:THREE.Mesh[]=[];a.group.traverse(o=>{if(o instanceof THREE.Mesh&&o.userData.hinge&&!/airbrake|rollSpoiler|secondary-slot/.test(o.name)&&!(a.group.name==='player-MU2'&&o.name.startsWith('flap')))list.push(o)})
  const fixed=new Map<string,THREE.Triangle[]>();a.group.traverse(o=>{if(o instanceof THREE.Mesh&&list.some(m=>fixedName(m)===o.name))fixed.set(o.name,[...(fixed.get(o.name)??[]),...triangles(o)])})
  for(const f of [0,.25,.5,.75,1])for(const sign of [-1,1]){
   a.surfaces!({...neutral,roll:sign*f,pitch:sign*f,yaw:sign*f,flapFrac:f,flaperonLeftRad:sign*f*.49,flaperonRightRad:-sign*f*.50});a.group.updateMatrixWorld(true)
   for(const m of list){
    const h=m.userData.hinge as THREE.Object3D,t=triangles(m),len=h.userData.hingeLength as number
    for(const fraction of [0,.125,.25,.375,.5,.625,.75,.875,1]){
     const p=new THREE.Vector3(len*fraction,0,0).applyMatrix4(h.matrixWorld)
     expect(distanceToTriangles(p,t),`${a.group.name} ${m.name} ${fraction}`).toBeLessThan(3e-5)
     expect(distanceToTriangles(p,fixed.get(fixedName(m))!),`${a.group.name} ${m.name} fixed ${fraction}`).toBeLessThan(3e-5)
    }
   }
  }
 }
},60000)

it('honors effective elevator angles without adding pitch or trim twice',()=>{
 for(const [a,name] of [[build('C182'),'elevator-right'],[build('BE35'),'ruddervator-right'],[buildDetailedCub(),'cubElevator-right']] as const){
  const m=skin(a,name)
  a.surfaces!({...neutral,elevatorRad:-.17,pitch:1,trim:1});const p=points(m)
  a.surfaces!({...neutral,elevatorRad:-.17,pitch:-1,trim:-1});const q=points(m)
  expect(Math.max(...p.map((v,i)=>v.distanceTo(q[i]!)))).toBeLessThan(1e-7)
 }
})

it('split wings retain the complete original sampled airfoil cross-section',()=>{
 const foil=(u:number)=>Math.max(0,.2969*Math.sqrt(u)-.126*u-.3516*u*u+.2843*u**3-.1036*u**4)
 const us=Array.from({length:33},(_,i)=>(1-Math.cos(i*Math.PI/32))/2),peak=Math.max(...us.map(foil))
 for(const {spec} of ROSTER.filter(x=>x.spec.powerplant.kind!=='jet')){
  const a=build(spec.designator),profile=PROP_PROFILES[spec.designator]!,half=spec.spanM/2,start=profile.width*.32
  a.surfaces!(neutral);a.group.updateMatrixWorld(true)
  const tris:THREE.Triangle[]=[];a.group.traverse(o=>{if(o instanceof THREE.Mesh&&/^(wingForward|wingTrailingFixed|aileron-|flaperon-|flapTrimTab-|flap-(left|right|secondary-slot)|airbrake-(left|right)$|rollSpoiler-(left|right)$|brake-well)/.test(o.name))tris.push(...triangles(o))})
  const root=2*spec.wingAreaM2/(profile.biplane?1.78:1)/(spec.spanM*(1+profile.taper)),tip=root*profile.taper,thick=Math.max(.025,root*.075),rootLE=profile.pusher?-spec.lengthM*.10:root*.29,tipLE=rootLE-root*(1-profile.taper)*.29
  const y=(profile.wing==='high'?profile.height*.58:profile.wing==='low'?-profile.height*.31:profile.height*.04)+(a.group.userData.exteriorVerticalOffset??0),dihedral=profile.wing==='low'?.065:profile.glider?.045:.018
  for(const side of [-1,1])for(const f of [.25,.75])for(const i of [4,8,12,16,20,24,28,31])for(const sign of [-1,1]){
   const x=start+(half-start)*f,u=us[i]!,c=root+(tip-root)*x/half,le=rootLE+(tipLE-rootLE)*x/half
   const point=new THREE.Vector3(side*x,y+x*dihedral+thick*(.5+sign*foil(u)/peak*.5),-le+c*u)
   expect(distanceToTriangles(point,tris),`${spec.designator} ${side} ${f} ${u}`).toBeLessThan(5e-5)
  }
 }
},60000)

it('MU2 separate full-span Fowler elements ride physically connected rail carriages',()=>{
 const a=build('MU2'),profile=PROP_PROFILES.MU2!
 for(const side of ['left','right']){
  const flap=skin(a,`flap-${side}`),second=skin(a,`flap-secondary-slot-${side}`)
  a.surfaces!(neutral);const neutralPrimary=points(flap),neutralSecond=points(second)
  expect(Math.min(...neutralPrimary.map(p=>Math.abs(p.x)))).toBeLessThan(profile.width*.321)
  // Distinct neutral chord intervals: secondary replaces the aft region.
  expect(Math.min(...neutralSecond.map(p=>p.z))).toBeGreaterThan(Math.min(...neutralPrimary.map(p=>p.z)))
  const h=second.userData.hinge as THREE.Object3D,axis=new THREE.Vector3(1,0,0).transformDirection(h.matrixWorld),plane=new THREE.Plane().setFromNormalAndCoplanarPoint(new THREE.Vector3().crossVectors(axis,new THREE.Vector3(0,1,0)).normalize(),h.getWorldPosition(new THREE.Vector3()))
  if(plane.distanceToPoint(center(second))<0)plane.negate()
  for(const p of neutralPrimary)expect(plane.distanceToPoint(p),'primary element excludes secondary chord').toBeLessThan(2e-5)
  const rails=a.group.getObjectsByProperty('name',`fowler-rail-${side}`) as THREE.Mesh[],cars=a.group.getObjectsByProperty('name',`fowler-carriage-${side}`) as THREE.Mesh[]
  expect(cars).toHaveLength(2)
  for(const f of [0,.25,.5,.75,1]){
   a.surfaces!({...neutral,flapFrac:f});a.group.updateMatrixWorld(true)
   for(let i=0;i<cars.length;i++){
    const [p,q]=cylinderEnds(rails[i]!),line=new THREE.Line3(p,q),center=cars[i]!.getWorldPosition(new THREE.Vector3())
    expect(center.distanceTo(line.closestPointToPoint(center,true,new THREE.Vector3()))).toBeLessThan(2e-5)
   }
   if(f>0){const primaryMatrix=(flap.userData.hinge as THREE.Object3D).getWorldQuaternion(new THREE.Quaternion()),secondaryMatrix=(second.userData.hinge as THREE.Object3D).getWorldQuaternion(new THREE.Quaternion());expect(primaryMatrix.angleTo(secondaryMatrix)).toBeGreaterThan(.01)}
  }
 }
})

it('evidenced DG80 and LS8 upper-wing airbrakes have two attached rising tiers',()=>{
 for(const id of ['DG80','LS8'])for(const side of ['left','right']){
  const a=build(id),lower=skin(a,`airbrake-${side}`),upper=skin(a,`airbrake-${side}-upper-tier`)
  expect(upper?.geometry.index).toBeTruthy()
  a.surfaces!(neutral);const initial=center(upper)
  for(const f of [.25,.5,.75,1]){a.surfaces!({...neutral,spoilerFrac:f});expect(center(upper).y).toBeGreaterThan(initial.y);expect(center(upper).y).toBeGreaterThan(center(lower).y)}
 }
})

it('MU2 flap-mounted trim tabs remain separate from pilot roll control',()=>{
 const a=build('MU2')
 for(const side of ['left','right']){
  const tab=skin(a,`flapTrimTab-${side}`);expect(tab?.geometry.index).toBeTruthy()
  a.surfaces!({...neutral,flapFrac:.5,roll:1});const p=points(tab)
  a.surfaces!({...neutral,flapFrac:.5,roll:-1});const q=points(tab)
  expect(Math.max(...p.map((v,i)=>v.distanceTo(q[i]!)))).toBeLessThan(1e-7)
 }
})

// Intersect a vertical line with actual rendered triangles, including cut caps.
// Projected barycentrics avoid face-culling and handle shared-edge vertices.
function envelopeY(p:THREE.Vector3,tris:THREE.Triangle[]):number[]{
 const ys:number[]=[]
 for(const {a,b,c} of tris){
  const bx=b.x-a.x,bz=b.z-a.z,cx=c.x-a.x,cz=c.z-a.z,det=bx*cz-bz*cx
  if(Math.abs(det)<1e-12)continue
  const x=p.x-a.x,z=p.z-a.z,u=(x*cz-z*cx)/det,v=(bx*z-bz*x)/det
  if(u>=-2e-5&&v>=-2e-5&&u+v<=1+2e-5)ys.push(a.y+u*(b.y-a.y)+v*(c.y-a.y))
 }
 return ys
}
it('all stowed double-tier vertices fit the drawn wing envelope and detect bottom escape',()=>{
 for(const id of ['DG80','LS8'])for(const side of ['left','right']){
  const a=build(id);a.surfaces!(neutral);a.group.updateMatrixWorld(true)
  const tier=skin(a,`airbrake-${side}-upper-tier`),bottom=triangles(skin(a,`brake-well-${side}`)),top=triangles(skin(a,`airbrake-${side}`))
  const escape=()=>points(tier).map(p=>{
   const lows=envelopeY(p,bottom),highs=envelopeY(p,top)
   expect(lows.length,`${id} ${side}: vertex above actual well footprint`).toBeGreaterThan(0)
   expect(highs.length,`${id} ${side}: vertex below actual lid footprint`).toBeGreaterThan(0)
   return Math.max(Math.min(...lows)-p.y,p.y-Math.max(...highs))
  })
  expect(Math.max(...escape()),`${id} ${side}: indexed tier outside original silhouette`).toBeLessThan(2e-5)
  // Move the same visible, reachable mesh: the probe must catch bottom escape.
  const hinge=tier.userData.hinge as THREE.Object3D
  hinge.position.y-=.1;tier.updateWorldMatrix(true,false)
  expect(Math.max(...escape()),`${id} ${side}: displaced board below well`).toBeGreaterThan(.04)
 }
})

for(const id of ['DG80','LS8','AS21','DISC'])it(`${id} stows every indexed airbrake rod and horn inside the original wing`,()=>{
 const a=build(id);a.surfaces!(neutral);a.group.updateMatrixWorld(true)
 const envelope:THREE.Triangle[]=[]
 a.group.traverse(o=>{if(o instanceof THREE.Mesh&&/^(wingForward$|brake-well-|airbrake-(left|right)$)/.test(o.name))envelope.push(...triangles(o))})
 const hardware:THREE.Mesh[]=[]
 a.group.traverse(o=>{if(o instanceof THREE.Mesh&&/^airbrake-.*(actuator|tier-support)/.test(o.name))hardware.push(o)})
 expect(hardware.length).toBe(id==='DG80'||id==='LS8'?18:6)
 const escape=(m:THREE.Mesh)=>Math.max(...indexedPoints(m).map(p=>{
  const ys=envelopeY(p,envelope)
  expect(ys.length,`${id} ${m.name}: original wing footprint`).toBeGreaterThan(1)
  return Math.max(Math.min(...ys)-p.y,p.y-Math.max(...ys))
 }))
 const outside=hardware.map(m=>{expect(m.visible,`${m.name}: visible geometry`).toBe(true);return {name:m.name,escape:escape(m)}}).filter(m=>m.escape>=2e-5)
 expect(outside,`${id}: indexed hardware outside wing`).toEqual([])
 // Move the rendered rod, not an endpoint marker; containment must reject it.
 const rod=hardware.find(m=>m.name==='airbrake-left-actuator')!
 rod.position.y-=.1
 expect(escape(rod),'actual rod displaced below lower skin').toBeGreaterThan(.04)
})

it('airbrake rods and horns remain finite and physically attached through extension and reset',()=>{
 for(const id of ['DG80','LS8','AS21','DISC']){
  const a=build(id),links=(a.group.userData.surfaceLinkages as LiveLinkage[]).filter(l=>l.rod.name.startsWith('airbrake-'))
  a.surfaces!(neutral);const initial=links.map(l=>indexedPoints(l.rod))
  for(const f of [0,.01,.25,.5,.75,1,.5,0,NaN,Infinity,-1,2]){
   a.surfaces!({...neutral,spoilerFrac:f});a.group.updateMatrixWorld(true)
   for(const l of links){
    for(const m of [l.fixedMount,l.movingMount])expect(hornError(m),`${id} ${f} ${m.name}`).toBeLessThan(2e-5)
    const [start,end]=cylinderEnds(l.rod)
    expect(start.distanceTo(l.fixedMount.getWorldPosition(new THREE.Vector3()))).toBeLessThan(2e-5)
    expect(end.distanceTo(l.movingMount.getWorldPosition(new THREE.Vector3()))).toBeLessThan(2e-5)
    for(const mesh of [l.rod,l.fixedMount.userData.bracket,l.movingMount.userData.bracket] as THREE.Mesh[]){
     expect(mesh.visible).toBe(true)
     expect(indexedPoints(mesh).every(p=>p.toArray().every(Number.isFinite))).toBe(true)
    }
   }
  }
  a.surfaces!(neutral)
  links.forEach((l,i)=>indexedPoints(l.rod).forEach((p,j)=>expect(p.distanceTo(initial[i]![j]!)).toBeLessThan(1e-7)))
 }
})

it('airbrake wells keep the exterior wing paint and shade only the inside',()=>{
 for(const id of ['DG80','LS8','AS21','DISC'])for(const side of ['left','right']){
  const a=build(id),well=skin(a,`brake-well-${side}`),paint=skin(a,'wingForward').material
  const materials=Array.isArray(well.material)?well.material:[well.material],ix=well.geometry.index!,p=well.geometry.getAttribute('position')
  let exterior=0,interior=0
  for(let i=0;i<ix.count;i+=3){
   const tri=new THREE.Triangle(...[0,1,2].map(j=>new THREE.Vector3().fromBufferAttribute(p,ix.getX(i+j))) as [THREE.Vector3,THREE.Vector3,THREE.Vector3])
   const normal=tri.getNormal(new THREE.Vector3()),group=well.geometry.groups.find(g=>i>=g.start&&i<g.start+g.count),material=materials[group?.materialIndex??0]
   if(normal.y<-.5){expect(material,`${id} ${side}: lower exterior`).toBe(paint);exterior++}
   if(normal.y>.5){expect(material,`${id} ${side}: interior floor`).not.toBe(paint);interior++}
  }
  expect(exterior).toBeGreaterThan(0);expect(interior).toBeGreaterThan(0)
 }
})
