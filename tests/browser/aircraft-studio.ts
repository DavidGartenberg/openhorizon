import * as THREE from 'three'
import { OrbitControls } from 'three/addons/controls/OrbitControls.js'
import { createScene } from '../../src/render/scene'
import { SkyDome } from '../../src/render/sky'
import { updateProp, type AircraftMesh, type SurfaceState } from '../../src/render/aircraft-mesh'
import { PLAYER_AIRCRAFT, buildPlayerAircraft, playerAircraftParams } from '../../src/render/player-aircraft'
import { upgradePlayerAircraft, disposeAircraftGeometry } from '../../src/render/local-aircraft'
import { XP_SURFACE_CALIBRATION } from '../../src/render/xplane-manifest'
import { pavementMaterial } from '../../src/render/surface-materials'
import type { AnimSpec } from '../../src/render/xplane-obj8'

const {scene,camera,renderer}=createScene(document.body)
camera.fov=42;camera.near=.08;camera.updateProjectionMatrix()
const sky=new SkyDome(scene)
const controls=new OrbitControls(camera,renderer.domElement)
controls.enableDamping=true;controls.dampingFactor=.12;controls.maxPolarAngle=Math.PI*.49
const ground=new THREE.Mesh(new THREE.PlaneGeometry(20000,20000),pavementMaterial(0x969a9b,'xy','concrete'))
ground.rotation.x=-Math.PI/2;ground.receiveShadow=true;scene.add(ground)
const chooser=document.querySelector('[aria-label="Aircraft"]') as HTMLSelectElement
const surfaceChooser=document.querySelector('[aria-label="Inspect surface"]') as HTMLSelectElement
chooser.replaceChildren(...PLAYER_AIRCRAFT.map(entry=>{
 const option=document.createElement('option');option.value=entry.key;option.textContent=`${entry.label} · ${entry.key}`;return option
}))
let ship:AircraftMesh,span=11,groundHeight=1.32
let inspectedModel=''
const models=new Map<string,AircraftMesh>()
function disposeModel(model:AircraftMesh){
 model.group.userData.dispose?.()
 disposeAircraftGeometry(model.group)
}
function select(){
 if(ship)scene.remove(ship.group)
 const key=chooser.value,entry=PLAYER_AIRCRAFT.find(e=>e.key===key)!
 const cached=models.get(key);models.delete(key)
 ship=cached??buildPlayerAircraft(key);models.set(key,ship)
 if(!cached)void upgradePlayerAircraft(ship,key)
 if(models.size>2){const oldest=models.keys().next().value!;disposeModel(models.get(oldest)!);models.delete(oldest)}
 span=Math.max(entry.spanM,entry.lengthM*.85)
 const gear=playerAircraftParams(key).gear
 const main=gear.mainL,fore=gear.tail??gear.nose
 // Rest the real gear plane on the apron. A level Cub/glider would otherwise
 // have its tailwheel floating high above the floor in this inspection view.
 ship.group.rotation.x=fore?Math.atan((main.z-fore.z)/(main.x-fore.x)):0
 groundHeight=Math.max(...Object.values(gear).map(leg=>-new THREE.Vector3(leg.y,-leg.z,-leg.x).applyEuler(ship.group.rotation).y))
 ship.group.position.y=groundHeight;scene.add(ship.group)
 ship.group.traverse(o=>{if(o instanceof THREE.Mesh){const m=Array.isArray(o.material)?o.material:[o.material];if(m.every(x=>!x.transparent)){o.castShadow=true;o.receiveShadow=true}}})
 sky.setShadowSize(span);controls.minDistance=span*.045;controls.maxDistance=span*8
 pose('front')
}
/** Inspect only vertices drawn by this animation, never the shared OBJ buffer's
 * bounding box (which also contains unrelated airframe parts). */
function focusSurface(underside=false){
 const ref=surfaceChooser.value,box=new THREE.Box3(),point=new THREE.Vector3()
 const meshId=ref.startsWith('mesh:')?ref.slice(5):null
 ship.group.updateMatrixWorld(true)
 ship.group.traverse(object=>{
  if(!(object instanceof THREE.Mesh))return
  let parent:THREE.Object3D|null=object,matched=false,visible=true
  while(parent){
   visible&&=parent.visible
   matched||=meshId?parent.uuid===meshId:((parent.userData.anim??[]) as AnimSpec[]).some(a=>a.dataref===ref)
   parent=parent.parent
  }
  if(!matched||!visible)return
  const geometry=object.geometry,index=geometry.index,position=geometry.attributes.position
  if(!position)return
  const end=Math.min(index?.count??position.count,geometry.drawRange.start+geometry.drawRange.count)
  for(let i=geometry.drawRange.start;i<end;i++){
   point.fromBufferAttribute(position,index?index.getX(i):i).applyMatrix4(object.matrixWorld);box.expandByPoint(point)
  }
 })
 if(box.isEmpty())return
 const center=box.getCenter(new THREE.Vector3()),size=box.getSize(new THREE.Vector3())
 const extent=Math.max(size.x,size.y,size.z,.25)
 ground.visible=!underside
 controls.maxPolarAngle=Math.PI*(underside?.9:.49)
 controls.target.copy(center)
 camera.position.copy(center).add(new THREE.Vector3(center.x<0?-.32:.32,underside?-.48:.48,1).normalize().multiplyScalar(extent*1.8))
 controls.minDistance=.05;controls.update()
}
document.getElementById('focus-surface')!.onclick=()=>focusSurface()
document.getElementById('underside-surface')!.onclick=()=>focusSurface(true)
function pose(view:string){
 ground.visible=true;controls.maxPolarAngle=Math.PI*.49
 if(view==='engine'){
  const engine=ship.group.getObjectByName('turbofan')??ship.group.getObjectByName('engineNacelle')??ship.propDisc
  ship.group.updateMatrixWorld(true)
  const box=new THREE.Box3().setFromObject(engine),size=box.getSize(new THREE.Vector3())
  const focus=box.isEmpty()?ship.group.position.clone():box.getCenter(new THREE.Vector3())
  const scale=Math.max(1,size.x,size.y,size.z)
  controls.target.copy(focus);camera.position.copy(focus).add(new THREE.Vector3(scale*.85,scale*.35,-scale*1.8));controls.update();return
 }
 const target=new THREE.Vector3(0,groundHeight+span*.04,0)
 const vector=view==='rear'?new THREE.Vector3(1,.48,1.2):view==='side'?new THREE.Vector3(1,.12,0):view==='opposite'?new THREE.Vector3(-1,.20,-.15):view==='detail'?new THREE.Vector3(.24,.15,-.26):new THREE.Vector3(1,.38,-1.15)
 camera.position.copy(target).addScaledVector(vector,span*(view==='side'||view==='opposite'?1.7:1.12))
 controls.target.copy(target);controls.update()
}
for(const id of ['front','rear','side','opposite','detail','engine'])document.getElementById(id)!.onclick=()=>pose(id)
const surfaceInputs = ['pitch','roll','yaw','trim','rudderTrim','flaps','spoilers'] as const
const slider = (id:string) => document.getElementById(id) as HTMLInputElement
const value = (id:string) => Number(slider(id).value)
function setSurfaces(values:Partial<Record<typeof surfaceInputs[number],number>>) {
 for(const id of surfaceInputs)if(values[id]!==undefined)slider(id).value=String(values[id])
}
document.getElementById('neutral-surfaces')!.onclick=()=>setSurfaces({pitch:0,roll:0,yaw:0,trim:0,rudderTrim:0,flaps:0,spoilers:0})
document.getElementById('full-surfaces')!.onclick=()=>setSurfaces({flaps:1,spoilers:1})
document.getElementById('positive-controls')!.onclick=()=>setSurfaces({pitch:1,roll:1,yaw:1})
document.getElementById('negative-controls')!.onclick=()=>setSurfaces({pitch:-1,roll:-1,yaw:-1})
function surfaceState():SurfaceState {
 const trim=value('trim'),pitch=value('pitch'),params=playerAircraftParams(chooser.value)
 // Match flight's effective controls, including trim and its separate native
 // stabilizer path; never add rudder trim again in the visual adapter.
 const calibration=XP_SURFACE_CALIBRATION[chooser.value==='172'?'C172':chooser.value==='737'?'B738':chooser.value]
 const travel=calibration?.elevator.map(v=>v*THREE.MathUtils.DEG2RAD)??[params.elevatorMaxRad,params.elevatorMaxRad]
 const command=-pitch*travel[pitch>=0?0:1]!
 const trimRad=-trim*(calibration?.stabilizer ? calibration.stabilizer[trim>=0?0:1]*THREE.MathUtils.DEG2RAD : params.trimMaxRad)
 return {flapFrac:slider('flaps').disabled?0:value('flaps'),spoilerFrac:slider('spoilers').disabled?0:value('spoilers'),gearPos:slider('gear').checked?1:0,
  pitch,roll:value('roll'),yaw:THREE.MathUtils.clamp(value('yaw')+value('rudderTrim'),-1,1),trim,rudderTrim:value('rudderTrim'),
  elevatorRad:THREE.MathUtils.clamp(command+trimRad,-travel[0]!,travel[1]!),elevatorCommandRad:command,trimRad}
}
chooser.onchange=select
select()
let frames=0,lastStats=performance.now(),lastFrame=performance.now()
function render(now:number){
 controls.update()
 sky.update(new Date((document.getElementById('sunset') as HTMLInputElement).checked?'2026-09-08T01:55:00Z':'2026-09-08T20:00:00Z'),37.5,-122.5)
 sky.setShadowTarget(ship.group.position)
 sky.updateEnvironment(renderer,scene,camera.position)
 const native=ship.group.getObjectByName(`local-aircraft:${chooser.value==='172'?'C172':chooser.value==='737'?'B738':chooser.value}`)
 const refs=(ship.group.userData.assetEvidence?.surfaceRefs??[]) as string[]
 const inspectionKey=`${ship.group.uuid}|${native?.uuid??'procedural'}`
 if(inspectedModel!==inspectionKey){
  inspectedModel=inspectionKey
  const choices:Array<{value:string;label:string}>=native
   ?refs.filter(ref=>/\/(?:aileron\d_deg|elevator\d_deg|rudder\d_deg|flap\d_deg|spoiler\d_deg|speedbrake\d_deg|slat\d_deploy_ratio)|\/composite_|\/stabilizer_deflection_degrees/.test(ref)).sort().map(ref=>({value:ref,label:ref.split('/').at(-1)!}))
   :[]
  if(!native)ship.group.traverse(object=>{
   if(object instanceof THREE.Mesh && /aileron|elevator|rudder|flap|spoiler|speedbrake|airbrake/i.test(object.name))choices.push({value:`mesh:${object.uuid}`,label:object.name})
  })
  surfaceChooser.replaceChildren(...choices.map(choice=>{const option=document.createElement('option');option.value=choice.value;option.textContent=choice.label;return option}))
  surfaceChooser.disabled=!choices.length
  ;(document.getElementById('focus-surface') as HTMLButtonElement).disabled=!choices.length
  ;(document.getElementById('underside-surface') as HTMLButtonElement).disabled=!choices.length
 }
 if(native){slider('flaps').disabled=!refs.some(r=>/flap[12]_deg|slat[12]_deploy/.test(r));slider('spoilers').disabled=!refs.some(r=>/(spoiler|speedbrake)[12]_deg/.test(r))}
 else{slider('flaps').disabled=playerAircraftParams(chooser.value).flapDetentsDeg.length<2;slider('spoilers').disabled=false}
 // Disabled inspection controls must also display their effective zero value.
 // Otherwise switching from deployed flaps to a flapless glider leaves a false full slider.
 for(const id of ['flaps','spoilers'])if(slider(id).disabled)slider(id).value='0'
 const state=surfaceState();ship.surfaces?.(state)
 const evidenceText=JSON.stringify({aircraft:chooser.value,source:ship.group.userData.visualSource??'procedural',controls:state,authored:native?.userData.surfaceValues??{}},null,2)
 const evidenceOutput=document.getElementById('surface-state')!
 if(evidenceOutput.textContent!==evidenceText)evidenceOutput.textContent=evidenceText
 updateProp(ship,(document.getElementById('props') as HTMLInputElement).checked?1200:0,Math.min((now-lastFrame)/1000,.05));lastFrame=now
 renderer.render(scene,camera);frames++
 if(now-lastStats>1000){document.getElementById('stats')!.textContent=`${Math.round(frames*1000/(now-lastStats))} fps · ${renderer.info.render.calls} draws · ${renderer.info.render.triangles.toLocaleString()} triangles · ${ship.group.userData.visualSource ?? "procedural"}${ship.group.userData.localAssetError ? " (local asset unavailable)" : ""}`;frames=0;lastStats=now}
 requestAnimationFrame(render)
}
requestAnimationFrame(render)
