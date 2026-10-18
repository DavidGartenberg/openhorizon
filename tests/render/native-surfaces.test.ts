import {existsSync,readFileSync,readdirSync} from 'node:fs'
import * as THREE from 'three'
import {describe,it,expect} from 'vitest'
import {localDatarefReader} from '../../src/render/local-aircraft'
import {XP_MODELS,XP_CONTROL_LIMITS,XP_SURFACE_CALIBRATION} from '../../src/render/xplane-manifest'
import {parseObj8,buildObj8,applyObj8Anim,applyObj8Visibility,type AnimSpec} from '../../src/render/xplane-obj8'
import type {SurfaceState} from '../../src/render/aircraft-mesh'
const base='/Users/davidgartenberg/X-Plane 12/Aircraft/Laminar Research/'
const neutral:SurfaceState={flapFrac:0,spoilerFrac:0,gearPos:1}
const refs={elevator:'sim/flightmodel2/wing/elevator1_deg[8]',rudder:'sim/flightmodel2/wing/rudder1_deg[10]'}
it('uses authored pitch/yaw endpoints and sanitizes nonfinite controls',()=>{
 const reader=(s:Partial<SurfaceState>)=>localDatarefReader({...neutral,...s},0,0,new Map(Object.entries(XP_CONTROL_LIMITS.C172!)),'C172')
 expect(reader({pitch:1})(refs.elevator)).toBe(-20)
 expect(reader({pitch:-1})(refs.elevator)).toBe(15)
 expect(reader({yaw:1})(refs.rudder)).toBe(20)
 expect(reader({yaw:-1})(refs.rudder)).toBe(-20)
 for(const ref of [refs.elevator,refs.rudder,'sim/flightmodel2/wing/aileron1_deg[2]'])expect(reader({pitch:NaN,yaw:Infinity,roll:-Infinity})(ref)).toBe(0)
 expect(reader({roll:10})('sim/flightmodel2/wing/aileron1_deg[2]')).toBe(15)
 expect(reader({roll:10})('sim/flightmodel2/wing/aileron1_deg[3]')).toBe(-20)
})
it('keeps actual elevator and stabilizer angles separate and failure refs healthy',()=>{
 const read=localDatarefReader({...neutral,pitch:.5,trim:.6,elevatorRad:-.1,stabilizerRad:-.05},0,0,new Map(),'A333')
 expect(read('laminar/A333/flight_controls/composite_elevL')).toBeCloseTo(-.1*180/Math.PI)
 expect(read('sim/flightmodel2/controls/stabilizer_deflection_degrees')).toBeCloseTo(-.05*180/Math.PI)
 expect(read('sim/operation/failures/rel_fcon_elev_1_lft_gone')).toBe(0)
})
/** Only indexed vertices belonging to each TRIS draw: OBJ buffers are shared. */
function points(meshes:THREE.Mesh[]){return meshes.flatMap(mesh=>{const g=mesh.geometry,idx=g.index!,pos=g.attributes.position!,pts:THREE.Vector3[]=[];for(let i=g.drawRange.start;i<g.drawRange.start+g.drawRange.count;i++)pts.push(new THREE.Vector3().fromBufferAttribute(pos,idx.getX(i)).applyMatrix4(mesh.matrixWorld));return pts})}
describe.skipIf(!existsSync(base))('installed indexed exterior geometry',()=>{
 for(const [key,entry] of Object.entries(XP_MODELS).filter(([k])=>k!=='MD82'))it(`${key}: real trailing edges move correctly; authored deployment and fixed geometry stay coherent`,()=>{
  const required=JSON.parse(readFileSync('docs/plans/sept13/native-surface-datarefs.json','utf8'))[key] as string[]
  const authoredRefs=new Set<string>()
  const root=new THREE.Group(),animated:THREE.Group[]=[],byRef=new Map<string,THREE.Mesh[]>(),fixed:THREE.Mesh[]=[]
  for(const path of entry.objs){const parsed=parseObj8(readFileSync(base+path,'utf8'));for(const node of parsed.anims)for(const spec of node.specs)authoredRefs.add(spec.dataref);const built=buildObj8(parsed,new THREE.MeshBasicMaterial());root.add(built.group);animated.push(...built.animated)}
  for(const ref of required)expect(authoredRefs.has(ref),`${key} required original ref ${ref}`).toBe(true)
  root.traverse(o=>{if(!(o instanceof THREE.Mesh))return;const refs=new Set<string>();let p=o.parent;while(p){for(const s of (p.userData.anim??[]) as AnimSpec[])if(/\/(?:aileron\d_deg|elevator\d_deg|rudder\d_deg|flap\d_deg|spoiler\d_deg|speedbrake\d_deg|slat\d_deploy_ratio)|\/composite_/.test(s.dataref))refs.add(s.dataref);p=p.parent}if(!refs.size)fixed.push(o);for(const r of refs){const list=byRef.get(r)??[];list.push(o);byRef.set(r,list)}})
  const pose=(state:SurfaceState)=>{const read=localDatarefReader(state,0,0,new Map(Object.entries(XP_CONTROL_LIMITS[key]!)),key);for(const n of animated){applyObj8Anim(n,read);applyObj8Visibility(n,read)};root.updateMatrixWorld(true)}
  pose(neutral)
  // Fixed vertices are sampled from the actual index ranges as well.
  const fixedMatrices=fixed.map(m=>m.matrixWorld.clone())
  const fixedSamples=fixed.slice(0,5).map(m=>points([m]).filter((_,i)=>i%100===0))
  for(const [ref,meshes] of byRef){
   pose(neutral);const before=points(meshes),zMax=Math.max(...before.map(v=>v.z)),zMin=Math.min(...before.map(v=>v.z));const trailing=before.map((v,i)=>v.z>zMax-(zMax-zMin)*.12?i:-1).filter(i=>i>=0)
   const centerX=before.reduce((n,v)=>n+v.x,0)/before.length
   const control=/aileron|_ail$/.test(ref)?'roll':/elevator|_elev[LR]$/.test(ref)?'pitch':/rudder/.test(ref)?'yaw':undefined
   if(control){for(const sign of [-1,-.5,.5,1]){pose({...neutral,[control]:sign});const after=points(meshes);const delta=trailing.reduce((v,i)=>v.add(after[i]!.clone().sub(before[i]!)),new THREE.Vector3()).divideScalar(trailing.length);const desired=control==='yaw'?delta.x*sign:control==='roll'?delta.y*Math.sign(centerX)*sign:delta.y*sign;expect(desired,`${key} ${ref} ${control} ${sign} trailing edge ${delta.toArray()}`).toBeGreaterThan(.00001)}}
   else {let previous=before;for(const fraction of [.25,.5,.75,1]){pose({...neutral,flapFrac:fraction,spoilerFrac:fraction});const after=points(meshes);expect(after.every(v=>v.toArray().every(Number.isFinite))).toBe(true);const motion=after.reduce((n,p,i)=>n+p.distanceToSquared(previous[i]!),0)/after.length;expect(motion,`${key} ${ref} travel ${fraction}`).toBeGreaterThan(1e-10);previous=after}}
  }
  for(const ref of ['sim/flightmodel2/controls/stabilizer_deflection_degrees','sim/flightmodel2/controls/elevator_trim','sim/flightmodel2/controls/rudder_trim']) {
   const meshes:THREE.Mesh[]=[]
   root.traverse(o=>{if(!(o instanceof THREE.Mesh))return;let p=o.parent;while(p){if(((p.userData.anim??[]) as AnimSpec[]).some(s=>s.dataref===ref)){meshes.push(o);break}p=p.parent}})
   if(!meshes.length)continue
   pose(neutral);const before=points(meshes)
   const aft=Math.max(...before.map(p=>p.z)),front=Math.min(...before.map(p=>p.z))
   const trailing=before.map((p,i)=>p.z>=aft-(aft-front)*.12?i:-1).filter(i=>i>=0)
   for(const sign of [-1,1]) {
    pose({...neutral,trim:sign,rudderTrim:sign});const after=points(meshes)
    const delta=trailing.reduce((sum,i)=>sum.add(after[i]!.clone().sub(before[i]!)),new THREE.Vector3()).divideScalar(trailing.length)
    const signedMotion=ref.endsWith('rudder_trim')?delta.x*sign:ref.endsWith('elevator_trim')?-delta.y*sign:delta.y*sign
    expect(signedMotion,`${key} ${ref} signed trim ${sign}, delta ${delta.toArray()}`).toBeGreaterThan(1e-6)
   }
  }
  pose({...neutral,pitch:1,yaw:1,roll:1,flapFrac:1,spoilerFrac:1})
  fixed.forEach((m,i)=>expect(m.matrixWorld.elements).toEqual(fixedMatrices[i]!.elements))
  fixed.slice(0,5).forEach((m,i)=>expect(points([m]).filter((_,j)=>j%100===0)).toEqual(fixedSamples[i]))
  if(process.env.NATIVE_SURFACE_DIAGNOSTICS==='1')console.log(`${key}: ${byRef.size} moving datarefs; indexed directions, deployment, signed trim and fixed geometry verified`)
  root.traverse(o=>{if(o instanceof THREE.Mesh){o.geometry.dispose();(o.material as THREE.Material).dispose()}})
 },120000)
})

it('decomposes native stabilizer aircraft even when the shared aerodynamic model uses trim tabs',()=>{
 const read=localDatarefReader({...neutral,pitch:0,trim:.5,elevatorRad:-.1,elevatorCommandRad:0,trimRad:-.1,stabilizerRad:0},0,0,new Map(),'PA18')
 expect(read(refs.elevator)).toBe(0)
 expect(read('sim/flightmodel2/controls/stabilizer_deflection_degrees')).toBe(-4)
})


it.skipIf(!existsSync(base))('calibration preserves the installed ACF asymmetric physical limits',()=>{
 for(const [key,calibration] of Object.entries(XP_SURFACE_CALIBRATION)) {
  const folder=base+XP_MODELS[key]!.folder
  const acf=readdirSync(folder).find(name=>name.endsWith('.acf')&&!/seaplane|G1000|_AI/.test(name))!
  const values=new Map(readFileSync(folder+'/'+acf,'utf8').split('\n').map(line=>line.trim().split(/\s+/)).filter(parts=>parts[0]==='P').map(parts=>[parts[1],Number(parts[2])]))
  const check=(actual:number,field:string)=>expect(actual,`${key} ${field}`).toBeCloseTo(values.get('acf/_'+field)!,5)
  check(calibration.aileron[0],'ailn1_up');check(calibration.aileron[1],'ailn1_dn')
  check(calibration.elevator[0],'elev1_up');check(calibration.elevator[1],'elev1_dn')
  check(calibration.rudder[0],'rudd1_lf');check(calibration.rudder[1],'rudd1_rt')
  if(calibration.stabilizer){check(calibration.stabilizer[0],'stab_trim_up');check(calibration.stabilizer[1],'stab_trim_dn')}
 }
})
