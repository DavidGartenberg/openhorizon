import * as THREE from 'three'
import {expect,it,vi} from 'vitest'
import {exactLocalModel, upgradePlayerAircraft, localDatarefReader, type LocalAircraftVisual} from '../../src/render/local-aircraft'
import {updateProp, type AircraftMesh} from '../../src/render/aircraft-mesh'

function fallback():AircraftMesh {const group=new THREE.Group();group.add(new THREE.Mesh(new THREE.BoxGeometry(),new THREE.MeshStandardMaterial()));return {group,propDisc:new THREE.Mesh(),surfaces:vi.fn()}}
function visual():LocalAircraftVisual {const group=new THREE.Group(),propDisc=new THREE.Mesh();group.add(propDisc);return {group,propDisc,surfaces:vi.fn(),updateProp:vi.fn(),dispose:vi.fn()}}
it('matches exact variants only, never J3 Cub to PA18 or A332 to A333',()=>{
 expect(exactLocalModel('172')?.folder).toBe('Cessna 172 SP')
 expect(exactLocalModel('737')?.folder).toBe('Boeing 737-800')
 expect(exactLocalModel('PA18')?.folder).toBe('Piper PA-18 Super Cub')
 for(const key of ['CUB','A332','B739','SR20'])expect(exactLocalModel(key)).toBeUndefined()
})
it('keeps fallback and attachments until the entire local model is ready, then forwards current controls',async()=>{
 const ship=fallback(),original=ship.group.children[0]!,light=new THREE.Group()
 let resolve!:(v:LocalAircraftVisual|null)=>void
 const loading=upgradePlayerAircraft(ship,'172',()=>new Promise(r=>{resolve=r}))
 const exterior=ship.group.children[0]!
 ship.group.add(light)
 const state={flapFrac:.5,spoilerFrac:0,gearPos:1}
 ship.surfaces!(state);updateProp(ship,1200,.1)
 expect(original.parent).toBe(exterior)
 expect(exterior.userData.exteriorCabin).toBe(true)
 const loaded=visual();resolve(loaded);await loading
 expect(light.parent).toBe(ship.group)
 expect(original.parent).toBeNull()
 expect(loaded.group.parent).toBe(exterior)
 expect(ship.propDisc).toBe(loaded.propDisc)
 expect(ship.propDisc.parent).toBe(loaded.group)
 expect(loaded.surfaces).toHaveBeenCalledWith(state)
 updateProp(ship,1500,.1);expect(loaded.updateProp).toHaveBeenCalledWith(1500,.1)
})
it('retains visible fallback when loading fails and disposes a late completion after eviction',async()=>{
 const failed=fallback();await upgradePlayerAircraft(failed,'172',async()=>{throw new Error('missing')})
 expect(failed.group.userData.visualSource).toBe('procedural')
 expect(failed.group.children[0]!.children).toHaveLength(1)
 const ship=fallback();let resolve!:(v:LocalAircraftVisual|null)=>void
 const pending=upgradePlayerAircraft(ship,'172',()=>new Promise(r=>{resolve=r}))
 ship.group.userData.dispose();const late=visual();resolve(late);await pending
 expect(late.dispose).toHaveBeenCalledTimes(1)
 expect(late.group.parent).toBeNull()
})
it('maps actual standard and Airbus control datarefs while leaving doors and failures at zero',()=>{
 const read=localDatarefReader({flapFrac:.5,gearPos:1,spoilerFrac:.4,roll:.5,reverseFrac:.8},90,1000,new Map([['sim/flightmodel2/wing/flap1_deg[0]',40],['sim/flightmodel2/wing/speedbrake1_deg[0]',60]]))
 expect(read('sim/flightmodel2/wing/flap1_deg[0]')).toBe(20)
 expect(read('sim/flightmodel2/wing/speedbrake1_deg[0]')).toBe(24)
 expect(read('sim/flightmodel2/gear/deploy_ratio[1]')).toBe(1)
 expect(read('sim/flightmodel2/engines/prop_rotation_angle_deg[0]')).toBe(90)
 expect(read('sim/flightmodel2/engines/thrust_reverser_deploy_ratio[0]')).toBe(.8)
 expect(read('sim/flightmodel2/misc/door_open_ratio[0]')).toBe(0)
 expect(read('sim/operation/failures/rel_wing1L')).toBe(0)
})

it('cancels an evicted load so it cannot keep downloading the remaining aircraft parts',async()=>{
 const ship=fallback();let signal:AbortSignal|undefined
 const pending=upgradePlayerAircraft(ship,'172',async(s)=>{signal=s;return null})
 ship.group.userData.dispose();await pending
 expect(signal?.aborted).toBe(true)
})

it('bounds simultaneous local aircraft loads to two while queued selections wait',async()=>{
 const {loadLocalAircraft}=await import('../../src/render/local-aircraft')
 const releases:Array<()=>void>=[]
 const fetcher=vi.fn(()=>new Promise(resolve=>releases.push(()=>resolve({ok:true,json:async()=>({available:false})}))))
 vi.stubGlobal('fetch',fetcher)
 const loads=[loadLocalAircraft('172'),loadLocalAircraft('737'),loadLocalAircraft('SR22')]
 try{
  await new Promise(r=>setTimeout(r,0))
  expect(fetcher).toHaveBeenCalledTimes(2)
 }finally{
  // Drain all queued jobs even on a failing assertion.
  for(let i=0;i<4;i++){releases.splice(0).forEach(r=>r());await new Promise(r=>setTimeout(r,0))}
  await Promise.all(loads);vi.unstubAllGlobals()
 }
})

it('owns atlas textures per aircraft, shares them across parts and releases each once',async()=>{
 const {loadLocalAircraft}=await import('../../src/render/local-aircraft')
 const textures:THREE.Texture[]=[];const disposals=vi.fn()
 const textureStub=vi.spyOn(THREE.TextureLoader.prototype,'loadAsync').mockImplementation(async()=>{
  const texture=new THREE.Texture();texture.addEventListener('dispose',disposals);textures.push(texture);return texture
 })
 const obj='I\n800\nOBJ\nTEXTURE body.png\nTEXTURE_NORMAL normal.png\nGLOBAL_specular 1\nNORMAL_METALNESS\nVT 0 0 0 0 1 0 0 0\nVT 1 0 0 0 1 0 1 0\nVT 0 0 1 0 1 0 0 1\nIDX 0\nIDX 1\nIDX 2\nTRIS 0 3'
 vi.stubGlobal('fetch',async(url:string)=>url==='/xp/manifest.json'?{ok:true,json:async()=>({available:true})}:{ok:true,text:async()=>obj})
 try{
  const visual=(await loadLocalAircraft('172'))!
  expect(textures).toHaveLength(2)
  expect(visual.group.children).toHaveLength(exactLocalModel('172')!.objs.length)
  visual.dispose();visual.dispose()
  await new Promise(r=>setTimeout(r,0))
  expect(disposals).toHaveBeenCalledTimes(2)
  expect(visual.group.children).toHaveLength(0)
 }finally{textureStub.mockRestore();vi.unstubAllGlobals()}
})

it('includes the authored 737 cockpit glazing and Cessna cabin behind transparent windows',()=>{
 expect(exactLocalModel('737')!.objs).toContain('Boeing 737-800/objects/738_cockpit_glass.obj')
 expect(exactLocalModel('172')!.objs).toContain('Cessna 172 SP/objects/cockpit_1.obj')
 expect(exactLocalModel('172')!.objs).toContain('Cessna 172 SP/objects/cockpit_seats_front.obj')
})

it('preserves a value snapshot across asynchronous swaps even when the caller reuses its input object',async()=>{
 const ship=fallback();let resolve!:(v:LocalAircraftVisual|null)=>void
 const pending=upgradePlayerAircraft(ship,'172',()=>new Promise(r=>{resolve=r}))
 const input={flapFrac:.25,gearPos:1,spoilerFrac:.5,pitch:.6,yaw:-.3,roll:.2,trim:.1}
 ship.surfaces!(input);input.pitch=-1;input.yaw=1
 const loaded=visual();resolve(loaded);await pending
 expect(loaded.surfaces).toHaveBeenCalledWith({...input,pitch:.6,yaw:-.3})
})
