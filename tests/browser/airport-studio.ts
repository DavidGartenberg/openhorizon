import * as THREE from 'three'
import {OrbitControls} from 'three/addons/controls/OrbitControls.js'
import {createScene} from '../../src/render/scene'
import {SkyDome} from '../../src/render/sky'
import {buildAirportFacilities,disposeAirportObject,planAirportFacilities,updateAirportServices,mappedTerminalFacade} from '../../src/world/airport-scenery'
import type {AirportData} from '../../src/world/airports'
const {scene,camera,renderer}=createScene(document.body),sky=new SkyDome(scene)
camera.fov=45;camera.near=.15;camera.updateProjectionMatrix()
const controls=new OrbitControls(camera,renderer.domElement);controls.enableDamping=true;controls.maxPolarAngle=Math.PI*.49
const ground=new THREE.Mesh(new THREE.PlaneGeometry(20000,20000),new THREE.MeshStandardMaterial({color:0x647750,roughness:1}));ground.rotation.x=-Math.PI/2;ground.receiveShadow=true;scene.add(ground)
const chooser=document.querySelector('select')!,stats=document.querySelector('output')!
let facilities:THREE.Group,scale=80,time=0,last=performance.now()
function pose(view:string){
 const vector=view==='vehicles'?new THREE.Vector3(-scale*.32,6,-scale*.12):view==='apron'?new THREE.Vector3(-scale*.7,scale*.10,-scale*.25):new THREE.Vector3(-scale*.75,scale*.65,-scale*.9)
 const target=view==='vehicles'?new THREE.Vector3(-scale*.25,1,0):new THREE.Vector3(0,5,0)
 controls.target.copy(target);camera.position.copy(vector);controls.update()
}
function select(){
 if(facilities)disposeAirportObject(facilities)
 const kind=chooser.value,ap:AirportData={i:'STUDIO',n:'Studio',la:0,lo:0,e:0,t:kind==='commercial'||kind==='mapped'?2:0,r:[{li:'18',hi:'36',la1:-.01,lo1:0,la2:.01,lo2:0,e1:0,e2:0,l:kind==='strip'?1800:kind==='ga'?5000:10000,w:100,s:kind==='strip'?1:0,lt:0}]}
 const plan=planAirportFacilities(ap)!;plan.route=plan.route.map(p=>({x:p.x-plan.center.x,z:p.z-plan.center.z}));plan.center={x:0,z:0};scale=plan.depth
 facilities=buildAirportFacilities(plan,kind!=='mapped');scene.add(facilities)
 if(kind==='mapped'){
   const points=[{x:12,z:-80},{x:55,z:-80},{x:55,z:80},{x:30,z:80},{x:30,z:30},{x:12,z:30}]
   const shape=new THREE.Shape(points.map(p=>new THREE.Vector2(p.x,p.z))),geo=new THREE.ExtrudeGeometry(shape,{depth:11,bevelEnabled:false});geo.rotateX(Math.PI/2);geo.translate(0,11,0)
   const material=new THREE.MeshStandardMaterial({color:0xa6b0b3,roughness:.7});material.userData.airportOwned=true
   const terminal=new THREE.Mesh(geo,material);terminal.castShadow=terminal.receiveShadow=true;facilities.add(terminal,mappedTerminalFacade(points,0))
 }
 sky.setShadowSize(scale);pose('approach')
}
chooser.value=new URLSearchParams(location.search).get('size')??'strip';chooser.onchange=select
for(const id of ['approach','apron','vehicles'])document.getElementById(id)!.onclick=()=>pose(id)
select()
function render(now:number){
 if(!(document.getElementById('pause') as HTMLInputElement).checked)time+=Math.min((now-last)/1000,.1);last=now
 updateAirportServices(facilities,time);controls.update();sky.update(new Date('2026-09-08T20:00:00Z'),37.5,-122.5);sky.setShadowTarget(new THREE.Vector3());sky.updateEnvironment(renderer,scene,camera.position);renderer.render(scene,camera)
 stats.textContent=`${renderer.info.render.calls} draws · ${renderer.info.render.triangles.toLocaleString()} triangles · ${facilities.getObjectByName('airportServices')?.children.length} vehicles`;requestAnimationFrame(render)
}
requestAnimationFrame(render)
