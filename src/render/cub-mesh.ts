import * as THREE from 'three'
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js'
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js'
import { aircraftFabric, aircraftMetal, aircraftPaint } from './aircraft-materials'
import { buildAircraftWheel } from './aircraft-components'
import type { AircraftMesh, SurfaceState } from './aircraft-mesh'
import { bounded, createHingeFrame, cutSkin, attachSkin, skinDrive, type LiveLinkage } from './procedural-surfaces'

const yellow = aircraftFabric(0xf2bc14)
const cowlPaint = aircraftPaint(0xf1bc16)
const black = aircraftPaint(0x202329, { roughness: .62, clearcoat: .08 })
const steel = aircraftMetal(0x818b92,.42)
const glass = new THREE.MeshPhysicalMaterial({ color: 0xa5c9d2, transparent: true, opacity: .17, roughness: .1, metalness: .08, clearcoat: 1, side: THREE.DoubleSide, depthWrite: false })

function mesh(geometry: THREE.BufferGeometry, material: THREE.Material): THREE.Mesh {
  const m=new THREE.Mesh(geometry,material); m.castShadow=m.receiveShadow=true; return m
}
function polygon(points: number[][]): THREE.BufferGeometry {
  const geometry=new THREE.BufferGeometry()
  geometry.setAttribute('position',new THREE.Float32BufferAttribute(points.flat(),3))
  const idx:number[]=[]
  for(let i=1;i<points.length-1;i++)idx.push(0,i,i+1)
  geometry.setIndex(idx); geometry.computeVertexNormals(); return geometry
}
function rod(a: THREE.Vector3,b: THREE.Vector3,r:number): THREE.BufferGeometry {
  const d=b.clone().sub(a)
  const geometry=new THREE.CylinderGeometry(r,r,d.length(),8)
  geometry.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0,1,0),d.normalize()))
  geometry.translate(...a.clone().add(b).multiplyScalar(.5).toArray())
  return geometry
}
// Each station is fore-aft Z, half-width, bottom and top Y. The lower cabin
// shell ends below the eyepoint; windows are actual openings above this shell.
const bodyStations=[[-1.76,.28,-.19,.40],[-1.42,.35,-.30,.43],[-.9,.375,-.325,.43],[.65,.375,-.325,.43],[1.1,.34,-.25,.54],[1.7,.28,-.13,.55],[2.72,.18,.09,.49],[3.66,.095,.22,.43],[4.35,.03,.31,.37]]
function bodyGeometry():THREE.BufferGeometry {
  const p:number[]=[],idx:number[]=[];const n=32
  for(const [z,w,b,t] of bodyStations)for(let j=0;j<n;j++){
    const a=j/n*Math.PI*2,c=Math.cos(a),s=Math.sin(a)
    p.push(w!*Math.sign(c)*Math.pow(Math.abs(c),.5),(b!+t!)/2+(t!-b!)/2*Math.sign(s)*Math.pow(Math.abs(s),.5),z!)
  }
  for(let i=0;i<bodyStations.length-1;i++)for(let j=0;j<n;j++){
    const a=i*n+j,b=i*n+(j+1)%n;idx.push(a,b,a+n,b,b+n,a+n)
  }
  const geo=new THREE.BufferGeometry();geo.setAttribute('position',new THREE.Float32BufferAttribute(p,3));geo.setIndex(idx);geo.computeVertexNormals();return geo
}
function wingGeometry():THREE.BufferGeometry {
  const p:number[]=[],idx:number[]=[];const section:[number,number][]=[];const n=40
  const profile=(u:number)=>Math.max(0,.2969*Math.sqrt(u)-.126*u-.3516*u*u+.2843*u**3-.1036*u**4)
  for(const side of [1,-1])for(let j=0;j<n;j++){
    const u=(1-Math.cos((side===1?j:n-j)*Math.PI/n))/2
    section.push([u,side*profile(u)/.060*.065])
  }
  const stations=[-5.37,-5.35,-5.30,-5.20,-5.05,-4.8,-4.5,-3,-1.5,0,1.5,3,4.5,4.8,5.05,5.2,5.3,5.35,5.37]
  for(const x of stations){
    const tip=Math.max(0,(Math.abs(x)-4.57)/.8)
    const chord=1.6*Math.max(.015,Math.sqrt(Math.max(0,1-tip*tip)))
    for(const [u,h]of section)p.push(x,1+h*Math.sqrt(chord/1.6),-.15+(u-.5)*chord)
  }
  const ring=section.length
  for(let i=0;i<stations.length-1;i++)for(let j=0;j<ring;j++){
    const a=i*ring+j,b=i*ring+(j+1)%ring;idx.push(a,b,a+ring,b,b+ring,a+ring)
  }
  for(let j=1;j<ring-1;j++){idx.push(0,j+1,j);const b=(stations.length-1)*ring;idx.push(b,b+j,b+j+1)}
  const geo=new THREE.BufferGeometry();geo.setAttribute('position',new THREE.Float32BufferAttribute(p,3));geo.setIndex(idx);geo.computeVertexNormals();return geo
}
function ovalTail(horizontal:boolean):THREE.BufferGeometry {
  const shape=new THREE.Shape()
  if(horizontal){shape.moveTo(-1.45,0);shape.bezierCurveTo(-1.48,-.42,-.8,-.56,0,-.46);shape.bezierCurveTo(.8,-.56,1.48,-.42,1.45,0);shape.bezierCurveTo(1.3,.45,.6,.55,0,.47);shape.bezierCurveTo(-.6,.55,-1.3,.45,-1.45,0)}
  else {shape.moveTo(-.40,.30);shape.bezierCurveTo(-.42,.83,-.17,1.58,.24,1.63);shape.bezierCurveTo(.69,1.66,.74,1.15,.70,.77);shape.bezierCurveTo(.65,.39,.25,.27,-.40,.30)}
  const geo=new THREE.ExtrudeGeometry(shape,{depth:.04,bevelEnabled:true,bevelSize:.023,bevelThickness:.023,bevelSegments:3,curveSegments:24})
  if(horizontal){geo.rotateX(Math.PI/2);geo.translate(0,.42,4.02)}
  else {geo.rotateY(-Math.PI/2);geo.translate(.02,0,3.97)}
  return geo
}

/** Detailed procedural exterior; model frame nose -Z, +Y up. Original ground
 * contacts and prop interface are retained independently of the visual skin. */
export function buildDetailedCub():AircraftMesh {
  const g=new THREE.Group();g.name='detailedCub'
  const linkages:LiveLinkage[]=[]
  const add=(o:THREE.Object3D,x=0,y=0,z=0):void=>{o.position.set(x,y,z);g.add(o)}
  const body=mesh(bodyGeometry(),yellow);body.name='cubFabricBody';add(body)
  const clip=(geo:THREE.BufferGeometry,x:number,y:number,z:number,c:number)=>cutSkin(geo,new THREE.Plane(new THREE.Vector3(x,y,z),c))
  const drive=(hinge:ReturnType<typeof createHingeFrame>,skin:THREE.Mesh,fixed:THREE.Mesh):void=>{
    const a=hinge.root.userData.hingeStart as THREE.Vector3,b=hinge.root.userData.hingeEnd as THREE.Vector3,target=a.clone().lerp(b,.55)
    linkages.push(skinDrive(g,`${skin.name}-actuator`,fixed,skin,target.clone().add(new THREE.Vector3(0,0,-.09)),target.clone().add(new THREE.Vector3(0,0,.09)),.05,.009,steel))
  }
  const make=(name:string,geo:THREE.BufferGeometry,a:THREE.Vector3,b:THREE.Vector3)=>{
    const skin=mesh(geo,yellow);skin.name=name;g.add(skin);const hinge=createHingeFrame(g,`${name}-hinge`,a,b);attachSkin(hinge,skin);return {skin,hinge}
  }
  const fullWing=wingGeometry(),fixedParts:THREE.BufferGeometry[]=[clip(clip(fullWing,1,0,0,2),-1,0,0,2)]
  const ailerons:{hinge:ReturnType<typeof createHingeFrame>;side:number}[]=[]
  const pending:{skin:THREE.Mesh;hinge:ReturnType<typeof createHingeFrame>}[]=[]
  for(const side of [-1,1]){
    fixedParts.push(clip(fullWing,side,0,0,-5.18))
    const region=clip(clip(fullWing,side,0,0,-2),-side,0,0,5.18)
    fixedParts.push(clip(region,0,0,-1,.20))
    const moving=make(`cubAileron-${side<0?'left':'right'}`,clip(region,0,0,1,-.20),new THREE.Vector3(side*2,1,.20),new THREE.Vector3(side*5.18,1,.20));pending.push(moving);ailerons.push({hinge:moving.hinge,side})
  }
  const wing=mesh(mergeGeometries(fixedParts),yellow);wing.name='cubWing';g.add(wing)
  for(const p of pending)drive(p.hinge,p.skin,wing)
  const fullTail=ovalTail(true),fixedTail=mesh(clip(fullTail,0,0,-1,4.05),yellow);fixedTail.name='cubStabilizerFixed';g.add(fixedTail)
  const elevators:ReturnType<typeof createHingeFrame>[]=[]
  for(const side of [-1,1]){
    const geo=clip(clip(fullTail,side,0,0,0),0,0,1,-4.05)
    const pos=geo.getAttribute('position');let tip=0
    for(let i=0;i<pos.count;i++)if(Math.abs(pos.getZ(i)-4.05)<1e-5)tip=Math.max(tip,Math.abs(pos.getX(i)))
    const moving=make(`cubElevator-${side<0?'left':'right'}`,geo,new THREE.Vector3(0,.40,4.05),new THREE.Vector3(side*tip,.40,4.05));elevators.push(moving.hinge);drive(moving.hinge,moving.skin,fixedTail)
  }
  const fullFin=ovalTail(false),fixedFin=mesh(clip(fullFin,0,0,-1,4.24),yellow);fixedFin.name='cubFinFixed';g.add(fixedFin)
  const rudderGeo=clip(fullFin,0,0,1,-4.24),rp=rudderGeo.getAttribute('position');let ymin=Infinity,ymax=-Infinity
  for(let i=0;i<rp.count;i++)if(Math.abs(rp.getZ(i)-4.24)<1e-5){ymin=Math.min(ymin,rp.getY(i));ymax=Math.max(ymax,rp.getY(i))}
  const movingRudder=make('cubRudder',rudderGeo,new THREE.Vector3(0,ymin,4.24),new THREE.Vector3(0,ymax,4.24)),rudder=movingRudder.hinge;drive(rudder,movingRudder.skin,fixedFin)
  const cowl=mesh(new RoundedBoxGeometry(.66,.57,.54,5,.12),cowlPaint);add(cowl,0,.1,-1.52)
  const nose=mesh(new THREE.SphereGeometry(1,28,16),cowlPaint);nose.scale.set(.28,.25,.16);add(nose,0,.10,-1.8)

  // Framed clear cabin panes, following the high wing and low fuselage sill.
  const frames:THREE.BufferGeometry[]=[],brace:THREE.BufferGeometry[]=[]
  const frontLow=[-.35,.43,-1.05],frontHigh=[-.32,.94,-.72],rearLow=[-.34,.43,.82],rearHigh=[-.31,.94,.68]
  for(const side of [-1,1]){
    const flip=(a:number[])=>[Math.abs(a[0]!)*side,a[1]!,a[2]!]
    const corners=[flip(frontLow),flip(frontHigh),flip(rearHigh),flip(rearLow)]
    const pane=mesh(polygon(corners),glass);pane.castShadow=false;pane.userData.exteriorCabin=true;add(pane)
    for(let i=0;i<4;i++)frames.push(rod(new THREE.Vector3(...corners[i]!),new THREE.Vector3(...corners[(i+1)%4]!),.018))
    frames.push(rod(new THREE.Vector3(side*.345,.43,.1),new THREE.Vector3(side*.315,.94,.1),.015))
    // Correctly connected lift struts: belly attachment to both wing spars.
    for(const z of [-.55,.37])brace.push(rod(new THREE.Vector3(side*.31,-.20,.25),new THREE.Vector3(side*3.1,.94,z),.026))
    // Lightning flash lies on the fabric sides, with width following the loft.
    const flash=[[ -.75,.19],[.75,.19],[.48,.09],[2.98,.29],[1.17,.19],[1.44,.31],[-.75,.29]]
    const points=flash.map(([z,y])=>{
      let k=0;while(k<bodyStations.length-2 && bodyStations[k+1]![0]!<z!)k++
      const a=bodyStations[k]!,b=bodyStations[k+1]!,f=(z!-a[0]!)/(b[0]!-a[0]!)
      const w=THREE.MathUtils.lerp(a[1]!,b[1]!,f),lo=THREE.MathUtils.lerp(a[2]!,b[2]!,f),hi=THREE.MathUtils.lerp(a[3]!,b[3]!,f)
      const q=(y!-(lo+hi)/2)/((hi-lo)/2)
      return [side*(w*Math.pow(Math.max(0,1-q**4),.25)+.004),y!,z!]
    })
    // Concave bolt is triangulated in the side-view plane.
    const shape=points.map(p=>new THREE.Vector2(p[2],p[1]));const geo=polygon(points)
    geo.setIndex(THREE.ShapeUtils.triangulateShape(shape,[]).flat());geo.computeVertexNormals()
    const stripe=mesh(geo,black);(stripe.material as THREE.Material).side=THREE.DoubleSide;add(stripe)
  }
  const windshield=mesh(polygon([frontLow,[.35,.43,-1.05],[.32,.94,-.72],frontHigh]),glass);windshield.castShadow=false;windshield.userData.exteriorCabin=true;add(windshield)
  frames.push(rod(new THREE.Vector3(...frontHigh),new THREE.Vector3(.32,.94,-.72),.019))
  const cabinFrame=mesh(mergeGeometries(frames),cowlPaint);cabinFrame.userData.exteriorCabin=true;add(cabinFrame)
  add(mesh(mergeGeometries(brace),cowlPaint))

  // Exposed horizontally opposed cylinder banks, one instanced draw for fins.
  const fins=new THREE.InstancedMesh(new THREE.CylinderGeometry(.115,.115,.015,20),steel,24)
  const matrix=new THREE.Object3D();let i=0
  for(const side of [-1,1])for(const z of [-1.65,-1.39]){
    const cylinder=mesh(new THREE.CylinderGeometry(.085,.085,.22,20),black);cylinder.rotation.z=Math.PI/2;add(cylinder,side*.365,.28,z)
    for(let f=0;f<6;f++){matrix.rotation.z=Math.PI/2;matrix.position.set(side*(.295+f*.031),.28,z);matrix.updateMatrix();fins.setMatrixAt(i++,matrix.matrix)}
  }
  fins.name='cubCoolingFins';add(fins)
  const gear:THREE.BufferGeometry[]=[]
  for(const side of [-1,1]){
    const axle=new THREE.Vector3(side*.9,-1.05,-.25)
    for(const z of [-.65,.48])gear.push(rod(new THREE.Vector3(side*.29,-.26,z),axle,.028))
    const wheel=buildAircraftWheel(.2,.12);add(wheel,side*.9,-1.05,-.25)
  }
  gear.push(rod(new THREE.Vector3(-.9,-1.05,-.25),new THREE.Vector3(.9,-1.05,-.25),.027))
  gear.push(rod(new THREE.Vector3(0,.31,4.10),new THREE.Vector3(0,-.52,4.11),.021))
  add(mesh(mergeGeometries(gear),steel));add(buildAircraftWheel(.08,.06),0,-.52,4.11)
  const spinner=mesh(new THREE.ConeGeometry(.10,.25,24),steel);spinner.rotation.x=-Math.PI/2;add(spinner,0,.1,-2)
  const propDisc=new THREE.Mesh(new THREE.CircleGeometry(.915,48),new THREE.MeshBasicMaterial({color:0x242222,transparent:true,depthWrite:false,opacity:.18,side:THREE.DoubleSide}))
  add(propDisc,0,.1,-2.02)
  const blade=mesh(new RoundedBoxGeometry(.095,1.8,.035,3,.014),new THREE.MeshStandardMaterial({color:0x34302a,roughness:.6,transparent:true,depthWrite:false}))
  add(blade,0,.1,-2.01);propDisc.userData.blade=blade
  const surfaces=(s:SurfaceState):void=>{
    const roll=bounded(s.roll),pitch=bounded(s.pitch),yaw=bounded(s.yaw)
    for(const a of ailerons)a.hinge.setAngle(-roll*.31)
    for(let i=0;i<elevators.length;i++)elevators[i]!.setAngle((i===0?-1:1)*(Number.isFinite(s.elevatorRad)?bounded(s.elevatorRad,-1,1):-pitch*.48))
    rudder.setAngle(yaw*.52)
    for(const l of linkages)l.update()
  }
  g.userData.surfaceLinkages=linkages
  return {group:g,propDisc,surfaces}
}
