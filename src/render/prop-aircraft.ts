import * as THREE from 'three'
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js'
import type { RosterSpec } from '../sim/aircraft/derive'
import type { AircraftParams } from '../sim/aircraft/params'
import type { AircraftMesh, SurfaceState } from './aircraft-mesh'
import { aircraftPaint, aircraftMetal, aircraftRubber } from './aircraft-materials'
import { profiledPanel, profiledPanelGeometry, buildAircraftWheel } from './aircraft-components'
import { PROP_PROFILES } from './prop-profiles'
import { bounded, createHingeFrame, cutSkin, attachSkin, skinDrive, createLiveLinkage, type HingeFrame, type LiveLinkage } from './procedural-surfaces'
import { fowlerPose } from './fowler'
const trim = aircraftPaint(0x213d62,{roughness:.36})
const metal = aircraftMetal(0xb5bdc6,.31)
const dark = aircraftRubber()
const glass = new THREE.MeshPhysicalMaterial({color:0x29434f,metalness:.3,roughness:.13,clearcoat:1,transparent:true,opacity:.81,depthWrite:false,side:THREE.DoubleSide})
/** Continuous elliptical loft with smooth spline stations. Cross section shape is
 * type-specific visual reconstruction, never a replacement for flight parameters. */
type Section = [number,number,number,number] // fraction, half-width, center up, half-height
function sampler(stations:Section[],length:number):(t:number,a:number,offset?:number)=>THREE.Vector3 {
 const curve = new THREE.CatmullRomCurve3(stations.map(s=>new THREE.Vector3(s[1],s[2],s[3])),false,'catmullrom',.15)
 return (t,a,offset=0) => {
  let k=0;while(k<stations.length-2 && t>stations[k+1]![0])k++
  const local=(t-stations[k]![0])/(stations[k+1]![0]-stations[k]![0])
  const c=curve.getPoint((k+THREE.MathUtils.clamp(local,0,1))/(stations.length-1))
  return new THREE.Vector3(Math.cos(a)*(Math.max(.001,c.x)+offset),c.y+Math.sin(a)*(Math.max(.001,c.z)+offset),(t-.40)*length)
 }
}
function skin(sample:ReturnType<typeof sampler>,t0=0,t1=1,a0=0,a1=Math.PI*2,ns=72,na=40,offset=0):THREE.BufferGeometry {
 const p:number[]=[],ix:number[]=[],uv:number[]=[]
 for(let s=0;s<=ns;s++)for(let j=0;j<=na;j++){
  const v=sample(t0+(t1-t0)*s/ns,a0+(a1-a0)*j/na,offset);p.push(v.x,v.y,v.z);uv.push(j/na,s/ns)
 }
 for(let s=0;s<ns;s++)for(let j=0;j<na;j++){
  const a=s*(na+1)+j,b=a+1,c=a+na+1;ix.push(a,b,c,b,c+1,c)
 }
 const g=new THREE.BufferGeometry();g.setAttribute('position',new THREE.Float32BufferAttribute(p,3));g.setAttribute('uv',new THREE.Float32BufferAttribute(uv,2));g.setIndex(ix);g.computeVertexNormals();return g
}
function finGeometry(points:[number,number][],thickness:number):THREE.BufferGeometry {
 const shape=new THREE.Shape();points.forEach(([z,y],i)=>i?shape.lineTo(z,y):shape.moveTo(z,y));shape.closePath()
 const geo=new THREE.ExtrudeGeometry(shape,{depth:thickness,bevelEnabled:true,bevelSize:thickness*.18,bevelThickness:thickness*.18,bevelSegments:2,steps:1});geo.translate(0,0,-thickness/2);geo.rotateY(-Math.PI/2)
 if(!geo.index)geo.setIndex(Array.from({length:geo.getAttribute('position').count},(_,i)=>i));return geo
}
export function buildPropAircraft(spec:RosterSpec,params:AircraftParams):AircraftMesh {
 const profile=PROP_PROFILES[spec.designator]
 if(!profile)throw new Error(`No dedicated prop profile for ${spec.designator}`)
 const g=new THREE.Group();g.name=`player-${spec.designator}`;g.userData.propProfile={...profile};g.userData.modelSource='dedicated-prop'
 const L=spec.lengthM,S=spec.spanM,W=profile.width,H=profile.height
 const paint=aircraftPaint(profile.color??0xecefed,{roughness:.39})
 const add=(name:string,geometry:THREE.BufferGeometry,mat:THREE.Material=paint,parent:THREE.Object3D=g):THREE.Mesh=>{
  const m=new THREE.Mesh(geometry,mat);m.name=name;m.castShadow=m.receiveShadow=true;parent.add(m);return m
 }
 const rod=(name:string,a:THREE.Vector3,b:THREE.Vector3,r:number,mat:THREE.Material=metal,parent:THREE.Object3D=g)=>{
  const d=b.clone().sub(a);const m=add(name,new THREE.CylinderGeometry(r,r,d.length(),8),mat,parent);m.position.copy(a).add(b).multiplyScalar(.5);m.quaternion.setFromUnitVectors(new THREE.Vector3(0,1,0),d.normalize());return m
 }
 const powered=spec.powerplant.kind!=='none';const engineCount=powered&&'count' in spec.powerplant?spec.powerplant.count:0
 // The cabin roof grows out of the cowling and falls smoothly into the tail
 // boom. Gliders have a short cockpit pod and a genuinely thin aft boom.
 const transport=L>18 && !profile.glider
 const stations:Section[]=transport?[
  [0,.001,-H*.09,.001],[.035,W*.22,-H*.05,H*.19],
  [.075,W*.40,0,H*.36],[.13,W*.49,H*.035,H*.48],
  [.20,W*.50,H*.04,H*.50],[.48,W*.50,H*.04,H*.50],
  [.70,W*.50,H*.04,H*.50],[.77,W*.465,H*.055,H*.465],
  [.86,W*.32,H*.13,H*.32],[.95,W*.105,H*.19,H*.115],[1,.001,H*.20,.001]
 ]:profile.glider?[
  [0,.001,0,.001],[.06,W*.27,0,H*.27],[.15,W*.48,.04,H*.48],[.27,W*.50,.04,H*.50],
  [.38,W*.39,0,H*.31],[.50,W*.17,.04,H*.14],[.72,W*.10,.09,H*.09],[.93,W*.07,.12,H*.07],[1,.001,.13,.001]
 ]:[
  [0,.001,0,.001],[.035,W*(profile.radial?.43:.23),0,H*(profile.radial?.36:.18)],
  [.09,W*(profile.radial?.50:.38),0,H*.32],[.19,W*.46,H*.015,H*.37],
  [.29,W*.50,H*.105,H*(profile.canopy?.59:.49)],[.42,W*.50,H*.10,H*.49],
  [.56,W*.43,H*.06,H*.41],[.72,W*.27,H*.07,H*.27],[.88,W*.11,H*.13,H*.12],[1,.001,H*.16,.001]
 ]
 const sample=sampler(stations,L)
 const body=add('fuselage',skin(sample));body.userData.exteriorCabin=true
 // Conformal window patches follow the curved cabin instead of floating boxes.
 const glazing=(name:string,t0:number,t1:number,a0:number,a1:number)=>{
  const seal=add(`${name}-seal`,skin(sample,t0-.003,t1+.003,a0-.025,a1+.025,Math.ceil((t1-t0)*180)+3,Math.ceil((a1-a0)*24)+3,.018*W),dark);seal.userData.exteriorCabin=true
  const pane=add(name,skin(sample,t0,t1,a0,a1,Math.ceil((t1-t0)*180)+3,Math.ceil((a1-a0)*24)+3,.028*W),glass);pane.userData.exteriorCabin=true;pane.castShadow=false;pane.receiveShadow=false;return pane
 }
 if(transport){
  // Commuter/transport noses contain a short cockpit ahead of a long,
  // nearly constant-section passenger/cargo cabin, never a stretched GA pod.
  glazing('cockpitGlazing',.080,.122,.37,Math.PI/2-.045)
  glazing('cockpitGlazing-right',.080,.122,Math.PI/2+.045,Math.PI-.37)
  for(const side of [0,1]){
   glazing('pilotSideWindow',.130,.171,side===0?.19:Math.PI-.77,side===0?.77:Math.PI-.19)
   const count=profile.windows,dt=.34/L,halfAngle=.42/H,center=.32
   for(let j=0;j<count;j++){
    const t=.215+j*.53/Math.max(count-1,1)
    glazing(`cabinWindow-${side===0?0:Math.PI}-${j}`,t,t+dt,
      side===0?center-halfAngle:Math.PI-center-halfAngle,
      side===0?center+halfAngle:Math.PI-center+halfAngle)
   }
  }
 } else if(profile.canopy || profile.glider){
  glazing('cockpitGlazing',profile.glider?.075:.19,profile.glider?.37:.435,.12,Math.PI-.12)
  for(const t of [profile.glider?.13:.245,profile.glider?.34:.408]){
   const pts=Array.from({length:25},(_,j)=>sample(t,.12+(Math.PI-.24)*j/24,.025))
   const frame=add('canopyFrame',new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts),24,.012*W,6,false));frame.userData.exteriorCabin=true
  }
 } else if(profile.family==='Cirrus'){
  // The SR cabin has a painted roof and separate side windows, not a
  // fighter-style bubble. Preserve visible pillars around every pane.
  glazing('cockpitGlazing',.185,.279,.40,Math.PI/2-.04)
  glazing('cockpitGlazing-right',.185,.279,Math.PI/2+.04,Math.PI-.40)
  for(const side of [0,1]){
   glazing('pilotSideWindow',.292,.431,side===0?.04:Math.PI-1.06,side===0?1.06:Math.PI-.04)
   glazing('rearCabinWindow',.447,.533,side===0?.12:Math.PI-.99,side===0?.99:Math.PI-.12)
  }
 } else {
  glazing('cockpitGlazing',.185,.277,.35,Math.PI/2-.038)
  glazing('cockpitGlazing-right',.185,.277,Math.PI/2+.038,Math.PI-.35)
  for(const side of [0,Math.PI]) {
   const a0=side===0?-.03:Math.PI-.79,a1=side===0?.79:Math.PI+.03
   glazing('pilotSideWindow',.287,.375,a0,a1)
   const count=profile.windows
   for(let j=0;j<count;j++){
    const t=.397+j*.225/Math.max(count,1),dt=Math.min(.047,.16/Math.max(count,1))
    glazing(`cabinWindow-${side}-${j}`,t,t+dt,side===0?.0:Math.PI-.59,side===0?.59:Math.PI)
   }
  }
 }
 // Narrow longitudinal stripe hugs the actual surface and makes the airframe's
 // compound curvature readable even at the normal chase-camera distance.
 for(const a of [0,Math.PI])add('fuselageCheatline',skin(sample,.10,.91,a-.12,a-.075,45,2,.012),trim).userData.exteriorCabin=true
 const wingY=profile.wing==='high'?H*.58:profile.wing==='low'?-H*.31:H*.04
 const taper=profile.taper, half=S/2
 const area=spec.wingAreaM2/(profile.biplane?1.78:1)
 const rootChord=2*area/(S*(1+taper)),tipChord=rootChord*taper
 const rootLE=profile.pusher?-L*.10:rootChord*.29
 const tipLE=rootLE-rootChord*(1-taper)*.29
 const chord=(x:number)=>THREE.MathUtils.lerp(rootChord,tipChord,x/half)
 const le=(x:number)=>THREE.MathUtils.lerp(rootLE,tipLE,x/half)
 const flapPivots:{hinge:HingeFrame;side:number}[]=[],ailerons:{hinge:HingeFrame;side:number}[]=[],spoilers:{hinge:HingeFrame;side:number}[]=[]
 const linkages:LiveLinkage[]=[]
 const mechanisms:((fraction:number)=>void)[]=[]
 const dihedral=profile.wing==='low'?.065:profile.glider?.045:.018
 const thickness=Math.max(.025,rootChord*.075)
 const sliced=(geometry:THREE.BufferGeometry,normal:THREE.Vector3,constant:number)=>cutSkin(geometry,new THREE.Plane(normal,constant).normalize())
 const span=(geometry:THREE.BufferGeometry,a:number,b:number,side:number)=>sliced(sliced(geometry,new THREE.Vector3(side,0,0),-a),new THREE.Vector3(-side,0,0),b)
 const chordPlane=(u:number,side:number,lower=false)=>{
  const slope=(-tipLE+tipChord*u-(-rootLE+rootChord*u))/half
  return new THREE.Plane(new THREE.Vector3(-side*slope,0,1),rootLE-rootChord*u-(lower?.22:0)).normalize()
 }
 const region=(full:THREE.BufferGeometry,a:number,b:number,u0:number,u1:number,side:number,lower=false)=>{
  let geo=span(full,a,b,side)
  if(u0>0)geo=cutSkin(geo,chordPlane(u0,side,lower))
  if(u1<1)geo=cutSkin(geo,chordPlane(u1,side,lower).negate())
  return geo
 }
 const moving=(name:string,geometry:THREE.BufferGeometry,a:THREE.Vector3,b:THREE.Vector3)=>{
  const h=createHingeFrame(g,`${name}-hinge`,a,b),skin=add(name,geometry);attachSkin(h,skin);return {h,skin}
 }
 const drive=(h:HingeFrame,skin:THREE.Mesh,fixed:THREE.Mesh,name:string,f=.52)=>{
  const a=h.root.userData.hingeStart as THREE.Vector3,b=h.root.userData.hingeEnd as THREE.Vector3
  const target=a.clone().lerp(b,f)
  linkages.push(skinDrive(g,name,fixed,skin,target.clone().add(new THREE.Vector3(0,0,-rootChord*.05)),target.clone().add(new THREE.Vector3(0,0,rootChord*.06)),Math.max(.025,W*.055),Math.max(.006,W*.007),metal))
 }
 // Airbrakes stow within the wing. Attach their compact horns to triangle
 // interiors, rather than snapping to a remote vertex and hanging a generic
 // external control horn below the lower skin. Dimensions remain visual.
 const brakeDrive=(name:string,fixed:THREE.Mesh,moving:THREE.Mesh,fixedTarget:THREE.Vector3,movingTarget:THREE.Vector3,fixedOffset:number,movingOffset:number)=>{
  const radius=Math.max(.002,thickness*.03)
  const mount=(skin:THREE.Mesh,target:THREE.Vector3,offset:number,label:string)=>{
   skin.updateWorldMatrix(true,false)
   const local=skin.worldToLocal(g.localToWorld(target.clone())),p=skin.geometry.getAttribute('position'),ix=skin.geometry.index!.array
   const triangle=new THREE.Triangle(),nearest=new THREE.Vector3(),anchor=new THREE.Vector3();let best=Infinity
   for(let i=0;i<ix.length;i+=3){
    triangle.a.fromBufferAttribute(p,ix[i]!);triangle.b.fromBufferAttribute(p,ix[i+1]!);triangle.c.fromBufferAttribute(p,ix[i+2]!)
    triangle.closestPointToPoint(local,nearest);const d=nearest.distanceToSquared(local)
    if(d<best){best=d;anchor.copy(nearest)}
   }
   const m=new THREE.Object3D();m.name=`${name}-${label}-mount`;m.position.copy(anchor).add(new THREE.Vector3(0,offset,0));skin.add(m)
   const horn=new THREE.Mesh(new THREE.CylinderGeometry(radius*1.4,radius*1.4,Math.abs(offset),8),metal)
   horn.name=`${name}-${label}-horn`;horn.position.copy(anchor).add(new THREE.Vector3(0,offset/2,0));skin.add(horn)
   m.userData.bracket=horn;m.userData.skin=skin;return m
  }
  linkages.push(createLiveLinkage(g,name,mount(fixed,fixedTarget,fixedOffset,'fixed'),mount(moving,movingTarget,movingOffset,'moving'),radius,metal))
 }
 for(const side of [-1,1]){
  const start=W*.32,fa=profile.rollControl==='spoiler'?start:Math.max(W*.58,half*.13),fb=half*.61,sideName=side<0?'left':'right'
  const full=profiledPanelGeometry(le(start),chord(start),le(half),chord(half),side*start,side*half,thickness)
  const pos=full.getAttribute('position');for(let i=0;i<pos.count;i++)pos.setY(i,pos.getY(i)+wingY+Math.abs(pos.getX(i))*dihedral);full.computeVertexNormals()
  const point=(x:number,u:number,y=wingY)=>new THREE.Vector3(side*x,y+x*dihedral+thickness/2,-le(x)+chord(x)*u)
  const hasBrake=profile.airbrakes||profile.rollControl==='spoiler',ba=half*.34,bb=half*.59
  let fixed:THREE.Mesh
  if(hasBrake){
   fixed=add('wingForward',region(full,start,half,0,.57,side))
   add('wingForward',region(full,start,half,.71,.73,side))
   add('wingForward',region(full,start,ba,.57,.71,side));add('wingForward',region(full,bb,half,.57,.71,side))
   const pocket=region(full,ba,bb,.57,.71,side),floorPlane=new THREE.Plane(new THREE.Vector3(-side*dihedral,1,0),-wingY-thickness/2).normalize()
   const wellGeo=cutSkin(pocket,floorPlane.clone().negate()),well=add(`brake-well-${sideName}`,wellGeo,dark)
   if(profile.airbrakes){
    // Retain the original painted underside; only the cavity floor and cut
    // walls receive the dark well finish. Two batches avoid per-face draws.
    const p=wellGeo.getAttribute('position'),ix=wellGeo.index!.array,outer:number[]=[],inner:number[]=[],triangle=new THREE.Triangle(),normal=new THREE.Vector3()
    for(let i=0;i<ix.length;i+=3){
     triangle.a.fromBufferAttribute(p,ix[i]!);triangle.b.fromBufferAttribute(p,ix[i+1]!);triangle.c.fromBufferAttribute(p,ix[i+2]!)
     const batch=triangle.getNormal(normal).y<-.5?outer:inner;batch.push(ix[i]!,ix[i+1]!,ix[i+2]!)
    }
    wellGeo.setIndex([...outer,...inner]);wellGeo.addGroup(0,outer.length,0);wellGeo.addGroup(outer.length,inner.length,1);well.material=[paint,dark]
   }
   const name=`${profile.airbrakes?'airbrake':'rollSpoiler'}-${sideName}`
   const {h,skin}=moving(name,cutSkin(pocket,floorPlane),point(ba,.57),point(bb,.57))
   skin.material=trim;spoilers.push({hinge:h,side})
   if(profile.airbrakes){
    const x=THREE.MathUtils.lerp(ba,bb,.52)
    brakeDrive(`${name}-actuator`,well,skin,point(x,.60),point(x,.68),thickness*.10,-thickness*.10)
   }else drive(h,skin,fixed,`${name}-actuator`)
   if(profile.airbrakeTiers===2){
    // Two rigid tiers unfold above the real opening. Travel proportions are a
    // visual linkage approximation, not a manufacturer mechanism dimension.
    const tierGeo=region(full,ba,bb,.60,.70,side)
    // A finite thin board nests in the well, rather than duplicating a whole
    // wing section. Keep the clipped tapered outline and curved edge profile;
    // section depth is a visual approximation at 10% of the parent airfoil.
    const tierPositions=tierGeo.getAttribute('position')
    for(let i=0;i<tierPositions.count;i++){
     const middle=wingY+Math.abs(tierPositions.getX(i))*dihedral+thickness/2
     tierPositions.setY(i,middle+(tierPositions.getY(i)-middle)*.10)
    }
    tierGeo.computeVertexNormals()
    const tier=moving(`${name}-upper-tier`,tierGeo,point(ba,.60),point(bb,.60)),tierNeutral=tier.h.root.position.clone();tier.skin.material=trim
    for(const f of [.20,.80]){
     const x=THREE.MathUtils.lerp(ba,bb,f),anchor=point(x,.63)
     brakeDrive(`${name}-tier-support-${f}`,skin,tier.skin,anchor,anchor,-thickness*.07,thickness*.07)
    }
    mechanisms.push(f=>{tier.h.root.position.copy(tierNeutral);tier.h.root.position.y+=gliderOffset+Math.sin(f*Math.PI/2)*rootChord*.15-thickness*.12;tier.h.setAngle(-side*f*1.55)})
   }
  }else fixed=add('wingForward',region(full,start,half,0,.73,side))
  if(fa>start)add(`wingTrailingFixed-inboard-${sideName}`,region(full,start,fa,.73,1,side))
  if(profile.rollControl==='flaperon'){
   const {h,skin}=moving(`flaperon-${sideName}`,region(full,fa,half,.73,1,side),point(fa,.73),point(half,.73));ailerons.push({hinge:h,side})
   for(const f of [.28,.72])drive(h,skin,fixed,`flaperon-drive-${sideName}`,f)
  }else{
   if(profile.flapSystem==='none')add(`wingTrailingFixed-mid-${sideName}`,region(full,fa,fb,.73,1,side))
   else{
    const end=profile.rollControl==='spoiler'?half:fb,fowler=profile.flapSystem==='fowler'
    const {h,skin}=moving(`flap-${sideName}`,region(full,fa,end,.73,fowler?.90:1,side),point(fa,.73),point(end,.73));flapPivots.push({hinge:h,side})
    if(fowler){
     const neutral=h.root.position.clone(),travel=new THREE.Vector3(0,-rootChord*.10,rootChord*.20)
     g.updateMatrixWorld(true)
     const secondaryA=h.root.worldToLocal(g.localToWorld(point(fa,.90))),secondaryB=h.root.worldToLocal(g.localToWorld(point(end,.90)))
     const secondaryHinge=createHingeFrame(h.root,`flap-secondary-slot-${sideName}-hinge`,secondaryA,secondaryB)
     const tabA=half*.65,tabB=half*.78
     const secondaryGeometry=spec.designator==='MU2'?mergeGeometries([
      region(full,fa,tabA,.90,1,side),region(full,tabA,tabB,.90,.97,side),region(full,tabB,end,.90,1,side),
     ]):region(full,fa,end,.90,1,side)
     const secondarySkin=add(`flap-secondary-slot-${sideName}`,secondaryGeometry);attachSkin(secondaryHinge,secondarySkin)
     if(spec.designator==='MU2'){
      // The trim tab is part of the flap, never a pilot-commanded aileron.
      // No roll-trim actuator contract exists here; retain its neutral rigging.
      const tab=add(`flapTrimTab-${sideName}`,region(full,tabA,tabB,.97,1,side),trim)
      g.updateMatrixWorld(true);secondaryHinge.root.attach(tab)
     }
     const second={h:secondaryHinge,skin:secondarySkin},secondaryNeutral=second.h.root.position.clone()
     const secondaryTravel=new THREE.Vector3(0,-rootChord*.018,rootChord*.038).applyQuaternion(h.root.quaternion.clone().invert())
     for(const f of [.25,.75]){
      const at=THREE.MathUtils.lerp(fa,end,f),railStart=point(at,.76).add(new THREE.Vector3(0,-thickness*.8,0)),railEnd=railStart.clone().add(travel)
      const rail=rod(`fowler-rail-${sideName}`,railStart,railEnd,Math.max(.009,W*.008),metal)
      const carriage=add(`fowler-carriage-${sideName}`,new THREE.SphereGeometry(Math.max(.018,W*.018),12,8),metal);carriage.position.copy(railStart)
      // Rail root is physically braced to the fixed skin; carriage drives the
      // flap and the independently deploying second slotted element.
      const mount=new THREE.Object3D();mount.name=`fowler-carriage-mount-${sideName}`;mount.userData.carriage=carriage;carriage.add(mount)
      const target=point(at,.80)
      const support=skinDrive(g,`fowler-support-${sideName}-${f}`,fixed,skin,point(at,.70),target,W*.04,W*.007,metal)
      const railMount=new THREE.Object3D();railMount.name=`fowler-rail-root-${sideName}`;railMount.position.copy(railStart);railMount.userData.rail=rail;g.add(railMount)
      support.rod.removeFromParent();support.rod.geometry.dispose()
      linkages.push(createLiveLinkage(g,`fowler-rail-brace-${sideName}-${f}`,support.fixedMount,railMount,W*.009,metal))
      linkages.push(createLiveLinkage(g,`fowler-carriage-arm-${sideName}-${f}`,mount,support.movingMount,W*.009,metal))
      linkages.push(skinDrive(g,`fowler-secondary-arm-${sideName}-${f}`,skin,second.skin,point(at,.88),point(at,.94),W*.035,W*.007,metal))
      mechanisms.push(frac=>carriage.position.copy(railStart).addScaledVector(travel,fowlerPose(frac).ext))
     }
     mechanisms.push(frac=>{const f=fowlerPose(frac).ext;h.root.position.copy(neutral).addScaledVector(travel,f);second.h.root.position.copy(secondaryNeutral).addScaledVector(secondaryTravel,f);second.h.setAngle(side*frac*.13)})
    }else drive(h,skin,fixed,`flap-${sideName}-actuator`)
   }
   if(profile.rollControl!=='spoiler'){const {h,skin}=moving(`aileron-${sideName}`,region(full,fb,half,.73,1,side),point(fb,.73),point(half,.73));ailerons.push({hinge:h,side});drive(h,skin,fixed,`aileron-${sideName}-actuator`)}
  }
  if(profile.struts)rod('wingLiftStrut',new THREE.Vector3(side*W*.40,-H*.27,L*.015),new THREE.Vector3(side*half*.53,wingY+half*.53*dihedral,-rootLE+rootChord*.44),W*.027,paint)
  if(profile.biplane){
   const end=half*.83,lowerThickness=Math.max(.025,rootChord*.90*.075)
   const lower=profiledPanelGeometry(rootLE-.22,rootChord*.90,tipLE-.22,tipChord*.90,side*start,side*end,lowerThickness),lp=lower.getAttribute('position')
   for(let i=0;i<lp.count;i++)lp.setY(i,lp.getY(i)-H*.36+Math.abs(lp.getX(i))*dihedral);lower.computeVertexNormals()
   const z0=-rootLE+.22+rootChord*.90*.66,z1=-tipLE+.22+tipChord*.90*.66,slope=(z1-z0)/(end-start)
   const lowerCut=new THREE.Plane(new THREE.Vector3(-side*slope,0,1),-z0+slope*start).normalize()
   const fixedLower=add('lowerBiplaneWingForward',cutSkin(lower,lowerCut.clone().negate()))
   const {h,skin}=moving(`lower-flap-${sideName}`,cutSkin(lower,lowerCut),new THREE.Vector3(side*start,-H*.36+start*dihedral+lowerThickness/2,z0),new THREE.Vector3(side*end,-H*.36+end*dihedral+lowerThickness/2,z1))
   flapPivots.push({hinge:h,side});drive(h,skin,fixedLower,`lower-flap-${sideName}-actuator`)
   for(const z of [-rootLE+.20,-rootLE+rootChord*.79])rod('interplaneStrut',new THREE.Vector3(side*half*.64,-H*.30,z+.22),new THREE.Vector3(side*half*.66,wingY+half*.66*dihedral,z),W*.025,paint)
   rod('flyingWire',new THREE.Vector3(side*W*.4,-H*.30,0),new THREE.Vector3(side*half*.66,wingY,rootChord*.45),.009,metal)
  }
  if(profile.tipTanks){const tank=add('wingtipTank',new THREE.SphereGeometry(1,24,14));tank.scale.set(W*.16,W*.19,L*.11);tank.position.set(side*(half-W*.16),wingY+half*dihedral,-tipLE+tipChord*.30)}
  if(profile.winglets){const wl=add('winglet',finGeometry([[-tipLE,0],[-tipLE+.15,H*.40],[-tipLE+.38,H*.38],[-tipLE+tipChord*.75,0]],.025));wl.position.set(side*(half-.025),wingY+half*dihedral,0)}
 }
 const tailZ=L*.48,tailY=H*.16,finH=L*(profile.fin??.175)
 let rudder:HingeFrame|undefined
 if(profile.tail!=='v'){
  const full=finGeometry(profile.mooney?[[tailZ-L*.14,tailY],[tailZ-L*.14,tailY+finH],[tailZ-L*.065,tailY+finH],[tailZ+L*.08,tailY]]:[[tailZ-L*.20,tailY],[tailZ-L*.09,tailY+finH*.22],[tailZ+L*.005,tailY+finH],[tailZ+L*.065,tailY+finH*.94],[tailZ+L*.105,tailY]],W*.075)
  const z0=tailZ+L*(profile.mooney?.035:.068),z1=tailZ+L*(profile.mooney?-.09:.025),height=finH*(profile.mooney?1:.98)
  const plane=new THREE.Plane(new THREE.Vector3(0,-(z1-z0)/height,1),-z0+(z1-z0)/height*tailY).normalize()
  const fin=add('verticalFin',cutSkin(full,plane.clone().negate()));fin.userData.tailType=profile.tail
  const h=moving('rudder',cutSkin(full,plane),new THREE.Vector3(0,tailY,z0),new THREE.Vector3(0,tailY+height,z1));h.skin.material=trim;rudder=h.h;drive(h.h,h.skin,fin,'rudder-actuator')
 }
 const tailHalf=profile.glider?S*.085:S*.165
 const elevators:{hinge:HingeFrame;side:number}[]=[]
 for(const side of [-1,1]){
  const ty=tailY+(profile.tail==='t'?finH*.96:0),cant=profile.tail==='v'?.59:0,thick=Math.max(.025,H*.055)
  const full=profiledPanelGeometry(-tailZ+L*.075,L*.15,-tailZ-L*.008,L*.063,0,side*tailHalf,thick)
  const z0=tailZ-L*.075+L*.15*.70,z1=tailZ+L*.008+L*.063*.70
  const plane=new THREE.Plane(new THREE.Vector3(-side*(z1-z0)/tailHalf,0,1),-z0).normalize()
  const fixedGeo=cutSkin(full,plane.clone().negate()),movingGeo=cutSkin(full,plane)
  const transform=new THREE.Matrix4().makeRotationZ(side*cant);transform.setPosition(0,ty,0);fixedGeo.applyMatrix4(transform);movingGeo.applyMatrix4(transform)
  const fixed=add(profile.tail==='v'?'vTailFixed':'horizontalStabilizerFixed',fixedGeo)
  const a=new THREE.Vector3(0,thick/2,z0).applyMatrix4(transform),b=new THREE.Vector3(side*tailHalf,thick/2,z1).applyMatrix4(transform)
  const name=`${profile.tail==='v'?'ruddervator':'elevator'}-${side<0?'left':'right'}`,h=moving(name,movingGeo,a,b);elevators.push({hinge:h.h,side});drive(h.h,h.skin,fixed,`${name}-actuator`)
  if(profile.pusher){const canard=profiledPanel(L*.235,L*.08,L*.22,L*.035,0,side*S*.15,.05,paint);canard.name='foreplane';canard.position.y=-H*.25;g.add(canard)}
 }
 const discs:THREE.Mesh[]=[]
 const prop=(x:number,y:number,z:number,r:number,reverse=false)=>{
  const spinner=add('propSpinner',new THREE.ConeGeometry(r*.16,r*.43,28),metal);spinner.rotation.x=reverse?Math.PI/2:-Math.PI/2;spinner.position.set(x,y,z+(reverse?1:-1)*r*.14)
  const disc=add('propDisc',new THREE.CircleGeometry(r,48),new THREE.MeshBasicMaterial({color:0x30383a,transparent:true,opacity:.035,depthWrite:false,side:THREE.DoubleSide}));disc.position.set(x,y,z);disc.castShadow=false;disc.receiveShadow=false;discs.push(disc)
  const shape=new THREE.Shape();shape.moveTo(-r*.05,r*.13);shape.bezierCurveTo(-r*.10,r*.43,-r*.08,r*.79,r*.018,r*.985);shape.quadraticCurveTo(r*.10,r*.99,r*.12,r*.87);shape.bezierCurveTo(r*.15,r*.58,r*.07,r*.32,r*.05,r*.13);shape.closePath()
  const base=new THREE.ShapeGeometry(shape,12),positions:number[]=[],normals:number[]=[],indices:number[]=[]
  for(let b=0;b<profile.blades;b++){
   const geo=base.clone().rotateZ(b*Math.PI*2/profile.blades),pos=geo.getAttribute('position'),normal=geo.getAttribute('normal'),offset=positions.length/3;positions.push(...pos.array);normals.push(...normal.array);indices.push(...Array.from(geo.index!.array,i=>i+offset));geo.dispose()
  }
  base.dispose();const geo=new THREE.BufferGeometry();geo.setAttribute('position',new THREE.Float32BufferAttribute(positions,3));geo.setAttribute('normal',new THREE.Float32BufferAttribute(normals,3));geo.setIndex(indices)
  const blade=add('propBlades',geo,new THREE.MeshStandardMaterial({color:0x252b30,roughness:.42,metalness:.35,transparent:true,depthWrite:false,side:THREE.DoubleSide}));blade.position.copy(disc.position);blade.castShadow=false;blade.receiveShadow=false;disc.userData.blade=blade
 }
 if(engineCount===1){
  const radius='propDiameterM' in spec.powerplant?spec.powerplant.propDiameterM/2:W
  prop(0,0,-L*.40+radius*.24,radius)
  for(const side of [-1,1]){
   const intake=add('cowlingIntake',new THREE.SphereGeometry(1,16,10),dark);intake.scale.set(W*.13,H*.07,.04);intake.position.set(side*W*.25,-H*.10,-L*.345);intake.userData.exteriorCabin=true
   if(spec.powerplant.kind==='turboprop')rod('turbineExhaust',new THREE.Vector3(side*W*.38,-H*.08,-L*.27),new THREE.Vector3(side*W*.57,-H*.17,-L*.24),W*.065,metal)
  }
 } else if(engineCount>1){
  const xs=engineCount===4?[-.235,-.13,.13,.235]:[-.17,.17]
  for(const frac of xs){
   const x=frac*S,y=wingY+Math.abs(x)*dihedral-H*.02,nL=L*(L>20?.18:.27),r=W*(L>20?.24:.26)
   const z=profile.pusher?L*.12:-rootLE-nL*.20
   const ns=sampler([[0,.001,0,.001],[.04,r*.77,0,r*.77],[.13,r,0,r],[.43,r,0,r],[.73,r*.65,0,r*.71],[1,.001,0,.001]],nL)
   const pod=add('engineNacelle',skin(ns,0,1,0,Math.PI*2,30,24));pod.position.set(x,y,z)
   const pr='propDiameterM' in spec.powerplant?spec.powerplant.propDiameterM/2:r*2
   prop(x,y,z+(profile.pusher?nL*.57:-nL*.38),pr,profile.pusher)
   const inlet=add('nacelleIntake',new THREE.SphereGeometry(1,16,10),dark);inlet.scale.set(r*.57,r*.27,r*.10);inlet.position.set(x,y-r*.61,z-nL*.34)
  }
 }
 if(spec.designator==='P51'){
  const scoop=add('MustangRadiatorScoop',new THREE.SphereGeometry(1,24,14),metal);scoop.scale.set(W*.39,H*.25,L*.12);scoop.position.set(0,-H*.40,L*.075)
  for(const side of [-1,1])for(let n=0;n<6;n++)rod('MerlinExhaust',new THREE.Vector3(side*W*.37,.10,-L*.24+n*.09),new THREE.Vector3(side*W*.51,.05,-L*.23+n*.09),.036,metal)
 }
 if(spec.designator==='C208'){const pod=add('cargoPod',new THREE.SphereGeometry(1,24,14));pod.scale.set(W*.35,H*.24,L*.20);pod.position.set(0,-H*.47,L*.03)}
 // Each contact marker is exactly the authoritative physics point. The axle
 // sits one radius above it; the same parent handles animated retraction.
 const gearGroups:{group:THREE.Group;side:number;nose:boolean}[]=[]
 let gliderWheel:THREE.Group|undefined
 let gliderOffset=0
 if(profile.glider){
  // Physics retains its audited contact triangle; visible sailplane gear is a
  // recessed centerline wheel. Lower only the exterior to that wheel's plane.
  const main=params.gear.mainL, radius=.18
  gliderOffset=-main.z+radius+H*.22
  for(const child of g.children)child.position.y+=gliderOffset
  gliderWheel=new THREE.Group();gliderWheel.name='gliderMainGear';g.add(gliderWheel)
  const wheel=buildAircraftWheel(radius,.105);wheel.name='gliderCenterWheel'
  wheel.position.set(0,-main.z+radius,-(main.x+params.gear.mainR.x)/2);gliderWheel.add(wheel)
  const fairing=add('gliderWheelFairing',new THREE.SphereGeometry(1,24,14));fairing.scale.set(.095,.10,.25);fairing.position.copy(wheel.position).add(new THREE.Vector3(0,.115,0))
  const aft=sample(.935,-Math.PI/2);aft.y+=gliderOffset
  const tailWheel=buildAircraftWheel(.055,.043);tailWheel.name='gliderTailWheel';tailWheel.position.copy(aft).add(new THREE.Vector3(0,-.045,0));g.add(tailWheel)
  g.userData.visualGearLayout='glider-centerline'
  g.userData.exteriorVerticalOffset=gliderOffset
 }
 for(const [key,leg] of Object.entries(params.gear)){
  if(profile.glider){
   const marker=new THREE.Group();marker.name=`gearContact-${key}`;marker.position.set(leg.y,-leg.z,-leg.x);marker.visible=false;marker.userData.physicsContactOnly=true;g.add(marker);continue
  }
  const group=new THREE.Group();group.name=`gear-${key}`;const radius=Math.min(.58,Math.max(.11,W*(key==='tail'?.105:.17)))
  const topY=Math.max(-H*.28,-leg.z+radius*2.0)
  group.position.set(leg.y,topY,-leg.x);g.add(group)
  const axleY=-leg.z+radius-topY
  const wheel=buildAircraftWheel(radius,radius*.65);wheel.name=`wheel-${key}`;wheel.position.y=axleY;group.add(wheel)
  rod('gearStrut',new THREE.Vector3(0,0,0),new THREE.Vector3(0,axleY,0),radius*.14,metal,group)
  const contact=new THREE.Group();contact.name=`gearContact-${key}`;contact.position.y=-leg.z-topY;group.add(contact)
  // Splayed fixed-gear attachment braces link the cabin to the leg tops.
  if(!spec.gear.retractable && Math.abs(leg.y)>.1)rod('gearAttachment',new THREE.Vector3(Math.sign(leg.y)*W*.35,-H*.25,-leg.x+.1),new THREE.Vector3(leg.y,topY,-leg.x),radius*.13,metal)
  if(!spec.gear.retractable && profile.wing==='low' && !profile.military){const spat=add('wheelFairing',new THREE.SphereGeometry(1,24,14),paint,group);spat.scale.set(radius*.58,radius*.70,radius*1.65);spat.position.set(0,axleY+radius*.46,-radius*.20)}
  gearGroups.push({group,side:Math.sign(leg.y),nose:key==='nose'||key==='tail'})
 }
 // Uniform API for engine-off gliders: non-rendering placeholders never become
 // visible accidentally through updateProp; real props are enumerated separately.
 let propDisc=discs[0]
 if(!propDisc){propDisc=new THREE.Mesh(new THREE.CircleGeometry(.001,3),new THREE.MeshBasicMaterial({transparent:true,opacity:0,depthWrite:false}));propDisc.name='inertProp';propDisc.userData.blade=new THREE.Mesh(new THREE.CircleGeometry(.001,3),new THREE.MeshStandardMaterial({transparent:true,opacity:0}));g.add(propDisc,propDisc.userData.blade)}
 g.userData.propDiscs=discs
 g.userData.lightAnchors={wingtipL:new THREE.Vector3(-half,wingY+half*dihedral,-tipLE+tipChord*.3),wingtipR:new THREE.Vector3(half,wingY+half*dihedral,-tipLE+tipChord*.3),tail:new THREE.Vector3(0,tailY+finH,tailZ),beacon:new THREE.Vector3(0,H*.63,L*.02)}
 if(profile.glider)for(const anchor of Object.values(g.userData.lightAnchors) as THREE.Vector3[])anchor.y+=gliderOffset
 const surfaces=(s:SurfaceState)=>{
  const flap=bounded(s.flapFrac,0,1),gear=bounded(s.gearPos,0,1),roll=bounded(s.roll),pitch=bounded(s.pitch),yaw=bounded(s.yaw)
  if(gliderWheel && spec.gear.retractable)gliderWheel.visible=gear>.05
  for(const p of flapPivots){const physical=flap*Math.max(.35,(spec.flapDetentsDeg.at(-1)??30)*Math.PI/180);p.hinge.setAngle(p.side*physical);p.hinge.root.userData.surfaceAngle=physical}
  for(const a of ailerons){
   const explicit=spec.designator==='DG80'?(a.side<0?s.flaperonLeftRad:s.flaperonRightRad):undefined
   const base=spec.designator==='DG80'&&Number.isFinite(s.flapsDeg)?s.flapsDeg!*Math.PI/180:0
   const an2Droop=spec.designator==='AN2'?flap*16*Math.PI/180:0
   const physical=Number.isFinite(explicit)?bounded(explicit,-Math.PI*.65,Math.PI*.65):bounded(base,-.5,.5)+an2Droop-a.side*roll*(a.side*roll>0?.35:.18)
   a.hinge.setAngle(a.side*physical);a.hinge.root.userData.surfaceAngle=physical
   const skin=a.hinge.root.children.find(o=>o instanceof THREE.Mesh);if(skin)skin.userData.surfaceAngle=physical
  }
  for(const e of elevators){const physical=(Number.isFinite(s.elevatorRad)?bounded(s.elevatorRad,-1,1):-pitch*.42)+(profile.tail==='v'?e.side*yaw*.28:0);e.hinge.setAngle(e.side*physical);e.hinge.root.userData.surfaceAngle=physical}
  rudder?.setAngle(yaw*.48)
  const spoiler=bounded(s.spoilerFrac,0,1)
  for(const p of spoilers)p.hinge.setAngle(-p.side*(profile.rollControl==='spoiler'?Math.max(spoiler,p.side>0?roll: -roll):spoiler)*(profile.airbrakes?1.55:1.05))
  for(const update of mechanisms)update(profile.airbrakes?spoiler:flap)
  for(const l of linkages)l.update()
  if(spec.gear.retractable)for(const {group,side,nose} of gearGroups){if(nose)group.rotation.x=(1-gear)*1.5;else group.rotation.z=-(1-gear)*side*1.55;group.visible=gear>.015}
 }
 g.userData.surfaceLinkages=linkages
 return {group:g,propDisc,surfaces}
}
