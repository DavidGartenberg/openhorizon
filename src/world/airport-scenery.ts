/** Procedural facilities are scale-aware scenery, not a real airport diagram.
 * All planning coordinates are airport-local east/up/south, so rebases only move
 * the airport parent. Routes and the complete facility site avoid known surfaces.
 */
import * as THREE from 'three'
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js'
import type { AirportData, RunwayData } from './airports'

export interface GroundPoint { x: number; z: number }
export interface SurfaceObstacle { a: GroundPoint; b: GroundPoint; radius: number }
export interface FacilityPlan {
  scale: 'strip' | 'ga' | 'commercial'
  center: GroundPoint
  yaw: number
  width: number
  depth: number
  elevation: number
  grade: number
  fleetCount: number
  route: GroundPoint[]
}
export function primaryRunway(ap: AirportData): RunwayData | undefined {
  return [...ap.r].filter(r=>Number.isFinite(r.l)&&r.l>0).sort((a,b)=>b.l-a.l || a.li.localeCompare(b.li) || a.hi.localeCompare(b.hi) || a.la1-b.la1 || a.lo1-b.lo1)[0]
}
export function airportPoint(ap: Pick<AirportData,'la'|'lo'>, lat: number, lon: number): GroundPoint {
  return {x:(lon-ap.lo)*111_320*Math.cos(ap.la*Math.PI/180),z:-(lat-ap.la)*111_320}
}
export function runwayObstacles(ap: AirportData): SurfaceObstacle[] {
  return ap.r.map(r=>({a:airportPoint(ap,r.la1,r.lo1),b:airportPoint(ap,r.la2,r.lo2),radius:Math.max(r.w*.3048/2,8)+24}))
}
function local(p: GroundPoint, center: GroundPoint, yaw: number): GroundPoint {
  const dx=p.x-center.x,dz=p.z-center.z,c=Math.cos(yaw),s=Math.sin(yaw)
  return {x:c*dx-s*dz,z:s*dx+c*dz}
}
export function facilityPoint(p: Pick<FacilityPlan,'center'|'yaw'>, x: number,z: number): GroundPoint {
  const c=Math.cos(p.yaw),s=Math.sin(p.yaw)
  return {x:p.center.x+c*x+s*z,z:p.center.z-s*x+c*z}
}
/** Segment vs inflated rectangle (conservative capsule exclusion, including ends). */
function hitsSite(a: GroundPoint,b: GroundPoint,hw: number,hd: number): boolean {
  let lo=0,hi=1
  for(const [v,d,h] of [[a.x,b.x-a.x,hw],[a.z,b.z-a.z,hd]]) {
    if(Math.abs(d!)<1e-9){if(Math.abs(v!)>h!)return false;continue}
    let t0=(-h!-v!)/d!,t1=(h!-v!)/d!;if(t0>t1)[t0,t1]=[t1,t0]
    lo=Math.max(lo,t0);hi=Math.min(hi,t1);if(lo>hi)return false
  }
  return true
}
export function planAirportFacilities(ap: AirportData, extra: SurfaceObstacle[]=[]): FacilityPlan | null {
  const r=primaryRunway(ap);if(!r)return null
  const a=airportPoint(ap,r.la1,r.lo1),b=airportPoint(ap,r.la2,r.lo2)
  const len=Math.hypot(b.x-a.x,b.z-a.z)||r.l*.3048
  const yaw=Math.atan2(-(b.x-a.x),-(b.z-a.z))
  const scale=r.s!==0||r.l*.3048<1100?'strip':ap.t>=1&&r.l*.3048>=2130?'commercial':'ga'
  const width=scale==='commercial'?156:scale==='ga'?88:56
  const depth=scale==='commercial'?240:scale==='ga'?136:80
  const midpoint={x:(a.x+b.x)/2,z:(a.z+b.z)/2}
  const obstacles=[...runwayObstacles(ap),...extra]
  // Search both sides and along the runway, then farther out. Bounded 70 sites.
  for(const distance of [0,100,240,480,800,1200,1800]) for(const along of [0,-.25,.25,-.45,.45]) for(const side of [1,-1]) {
    const across=side*(r.w*.3048/2+40+width/2+distance)
    const center=facilityPoint({center:midpoint,yaw},across,along*len)
    if(obstacles.some(o=>hitsSite(local(o.a,center,yaw),local(o.b,center,yaw),width/2+o.radius,depth/2+o.radius)))continue
    const elevation=(r.e1+r.e2)*.3048/2-along*(r.e2-r.e1)*.3048
    const plan: FacilityPlan={scale,center,yaw,width,depth,elevation,grade:-(r.e2-r.e1)*.3048/len,fleetCount:scale==='commercial'?8:scale==='ga'?4:2,route:[]}
    plan.route=[[-width*.32,-depth*.32],[-width*.16,-depth*.32],[-width*.16,depth*.32],[-width*.32,depth*.32]].map(([x,z])=>facilityPoint(plan,x!,z!))
    return plan
  }
  return null
}

const WALL=new THREE.MeshStandardMaterial({color:0xc4c8c7,roughness:.8})
const ROOF=new THREE.MeshStandardMaterial({color:0x606c73,roughness:.68,metalness:.25})
const GLASS=new THREE.MeshStandardMaterial({color:0x255365,roughness:.22,metalness:.4,envMapIntensity:1.5})
const FRAME=new THREE.MeshStandardMaterial({color:0xd7dfe0,roughness:.48,metalness:.4})
const DARK=new THREE.MeshStandardMaterial({color:0x222b30,roughness:.85})
const PAVE=new THREE.MeshStandardMaterial({color:0x777b79,roughness:.95})
const YELLOW=new THREE.MeshStandardMaterial({color:0xe9be35,roughness:.58})
const WHITE=new THREE.MeshStandardMaterial({color:0xe3e8e6,roughness:.6})
const ORANGE=new THREE.MeshStandardMaterial({color:0xe77b24,roughness:.55})
const shared=new Set<THREE.Material>([WALL,ROOF,GLASS,FRAME,DARK,PAVE,YELLOW,WHITE,ORANGE])
/** Register a per-object material/texture, never module-shared finishes. */
export function ownMaterial<T extends THREE.Material>(m: T): T {m.userData.airportOwned=true;return m}
export function disposeAirportObject(root: THREE.Object3D): void {
  if(root.userData.airportDisposed)return
  const geos=new Set<THREE.BufferGeometry>(),mats=new Set<THREE.Material>(),textures=new Set<THREE.Texture>()
  root.traverse(o=>{
    o.userData.airportDisposed=true
    if(o instanceof THREE.Mesh||o instanceof THREE.Points){geos.add(o.geometry);for(const m of Array.isArray(o.material)?o.material:[o.material]) {
      if(!shared.has(m)&&!m.userData.airportShared&&(m.userData.airportOwned||o instanceof THREE.Points)){mats.add(m);const map=(m as THREE.MeshBasicMaterial).map;if(map?.userData.airportOwned)textures.add(map)}
    }}
    if(o instanceof THREE.InstancedMesh)o.dispose()
  })
  geos.forEach(g=>g.dispose());mats.forEach(m=>m.dispose());textures.forEach(t=>t.dispose())
  root.removeFromParent()
}
class Parts {
  private buckets=new Map<THREE.Material,THREE.BufferGeometry[]>()
  box(m: THREE.Material,x: number,y: number,z: number,w: number,h: number,d: number,rz=0): void {
    const geo=new THREE.BoxGeometry(w,h,d);if(rz)geo.rotateZ(rz);geo.translate(x,y,z);this.add(m,geo)
  }
  add(m: THREE.Material,g: THREE.BufferGeometry): void { const list=this.buckets.get(m)??[];list.push(g);this.buckets.set(m,list) }
  finish(group: THREE.Group): void {
    for(const [mat,parts] of this.buckets){const geo=mergeGeometries(parts,false)!;parts.forEach(g=>g.dispose());const mesh=new THREE.Mesh(geo,mat);mesh.castShadow=mesh.receiveShadow=true;group.add(mesh)}
  }
}
function building(parts: Parts,parent: THREE.Group,name: string,x: number,y: number,z: number,w: number,h: number,d: number,hangar=false): void {
  const marker=new THREE.Object3D();marker.name=name;marker.position.set(x,y,z);parent.add(marker)
  parts.box(WALL,x,y+h/2,z,w,h,d)
  parts.box(ROOF,x,y+h+.25,z,w+1.4,.5,d+1.4)
  // Roof parapets, entrance canopy, rooftop ventilation units.
  for(const sign of [-1,1]){parts.box(FRAME,x+sign*w/2,y+h+.7,z,.35,1,d);parts.box(FRAME,x,y+h+.7,z+sign*d/2,w,1,.35)}
  if(!hangar){
  parts.box(ROOF,x-w/2-1.8,y+3.1,z,3.6,.25,Math.min(d*.3,9))
  for(const side of [-1,1])parts.box(FRAME,x-w/2-3,y+1.5,z+side*Math.min(d*.15,4),.18,3,.18)
  parts.box(GLASS,x-w/2-.08,y+1.3,z,.12,2.6,2.4)
  }
  parts.box(ROOF,x+1,y+h+1,z+2,3,1.4,2)
  if(hangar){
    parts.box(DARK,x-w/2-.06,y+h*.43,z,.16,h*.76,d*.85)
    for(let zz=-d*.4;zz<=d*.4;zz+=2)parts.box(FRAME,x-w/2-.17,y+h*.43,z+zz,.15,h*.76,.12)
    // Shallow pitched roof over the hangar's wide sliding doors.
    for(const side of [-1,1])parts.box(ROOF,x+side*w*.25,y+h+1.2,z,w*.52,.35,d+1.8,-side*.18)
    return
  }
  for(let yy=3.8;yy<h-1;yy+=3.6){
    for(const side of [-1,1]){
      parts.box(GLASS,x+side*(w/2+.045),y+yy,z,.1,2.3,d-2)
      parts.box(GLASS,x,y+yy,z+side*(d/2+.045),w-2,2.3,.1)
      for(let zz=-d/2+1;zz<=d/2-1;zz+=3)parts.box(FRAME,x+side*(w/2+.12),y+yy,z+zz,.15,2.45,.13)
      for(let xx=-w/2+1;xx<=w/2-1;xx+=3)parts.box(FRAME,x+xx,y+yy,z+side*(d/2+.12),.13,2.45,.15)
    }
  }
}
function vehicle(kind: string): THREE.Group {
  const group=new THREE.Group();group.name=kind
  const p=new Parts(),bus=kind==='bus',fuel=kind==='fuel tanker',tug=kind==='baggage tug'
  const length=bus?9:fuel?7:tug?2.8:4.2,width=bus?2.5:2
  p.box(DARK,0,.55,0,width,.4,length)
  p.box(kind==='operations'?ORANGE:WHITE,0,1.1,-length*.28,width,1.2,length*.36)
  p.box(GLASS,0,1.8,-length*.29,width*.88,.6,length*.31)
  p.box(WHITE,0,2.16,-length*.29,width+.05,.12,length*.34)
  if(bus){p.box(WHITE,0,1.4,length*.15,width,1.7,length*.6);p.box(GLASS,0,1.95,length*.15,width+.03,.65,length*.57);p.box(WHITE,0,2.32,0,width+.1,.2,length)}
  else if(fuel){const tank=new THREE.CylinderGeometry(.95,.95,4,12);tank.rotateX(Math.PI/2);tank.translate(0,1.55,1);p.add(FRAME,tank);p.box(YELLOW,0,2.5,1,.2,.12,3.6)}
  else if(tug){p.box(YELLOW,0,.85,.9,2,.5,1.1);for(const z of [3.5,6]){p.box(DARK,0,.45,z,.15,.15,2.5);p.box(FRAME,0,.7,z,1.6,.25,1.9);p.box(ROOF,0,1.1,z,1.4,.6,1.6);for(const x of [-.8,.8])p.box(DARK,x,.35,z,.2,.5,1.5)}}
  else p.box(WHITE,0,1.1,1.1,width,.7,1.6)
  for(const x of [-width/2,width/2])for(const z of [-length*.3,length*.3]){const wheel=new THREE.CylinderGeometry(.4,.4,.28,8);wheel.rotateZ(Math.PI/2);wheel.translate(x,.43,z);p.add(DARK,wheel)}
  p.box(YELLOW,0,2.35,-length*.3,.55,.18,.3)
  p.finish(group);return group
}
export function buildAirportFacilities(plan: FacilityPlan, buildings=true,pavement=true): THREE.Group {
  const g=new THREE.Group();g.name='airportFacilities';g.position.set(plan.center.x,plan.elevation,plan.center.z);g.rotation.y=plan.yaw;g.userData.facilityPlan=plan
  const parts=new Parts(),ground=(z: number)=>z*plan.grade
  // Slightly thick foundation closes minor terrain/slope gaps. Terrain away
  // from the runway remains an estimate until a terrain-sampler API exists.
  const apron=new THREE.BoxGeometry(plan.width,.6,plan.depth)
  const pos=apron.getAttribute('position');for(let i=0;i<pos.count;i++)pos.setY(i,pos.getY(i)+ground(pos.getZ(i))-.18)
  apron.computeVertexNormals();if(pavement)parts.add(PAVE,apron);else apron.dispose()
  if(buildings){
    if(plan.scale==='commercial'){
      building(parts,g,'terminal',plan.width*.29,ground(0),0,28,15,166)
      building(parts,g,'concourse',plan.width*.13,ground(0),0,12,9,190)
      for(const z of [-64,-22,22,64]){const y=ground(z);parts.box(FRAME,plan.width*.035,y+4.6,z,19,3,3.5);parts.box(GLASS,plan.width*.035,y+4.9,z-1.8,18,1.8,.12);parts.box(DARK,plan.width*.035-8,y+2,z,.5,4,.5)}
      const tx=plan.width*.35,tz=plan.depth*.43,y=ground(tz)
      parts.box(WALL,tx,y+11,tz,4.5,22,4.5);parts.box(GLASS,tx,y+23,tz,9,4,8);parts.box(ROOF,tx,y+25.4,tz,10,.8,9)
      for(const side of [-1,1]){parts.box(FRAME,tx+side*4,y+23,tz,.2,4,8);parts.box(FRAME,tx,y+23,tz+side*3.5,9,4,.2)}
    }else{
      const strip=plan.scale==='strip',x=plan.width*.25,z=-plan.depth*.24
      building(parts,g,'hangar',x,ground(z),z,strip?16:24,strip?6:8,strip?23:32,true)
      const fz=plan.depth*.22
      building(parts,g,'FBO',x,ground(fz),fz,strip?12:20,strip?5.6:8,strip?15:25)
      if(!strip)building(parts,g,'hangar',x,ground(0),0,24,8,27,true)
    }
  }
  // Service lane paint and apron stand bars share a single material batch.
  if(pavement)for(const x of [-plan.width*.39,-plan.width*.1])parts.box(YELLOW,x,.16,0,.14,.025,plan.depth*.77)
  if(pavement)for(const z of [-plan.depth*.35,0,plan.depth*.35])parts.box(YELLOW,-plan.width*.02,ground(z)+.17,z,plan.width*.12,.025,.15)
  parts.finish(g)
  const fleet=new THREE.Group();fleet.name='airportServices'
  const kinds=plan.scale==='commercial'?['bus','fuel tanker','baggage tug','operations','baggage tug','bus','fuel tanker','operations']:plan.scale==='ga'?['fuel tanker','operations','baggage tug','operations']:['fuel tanker','operations']
  kinds.forEach((kind,i)=>{const v=vehicle(kind);v.userData.phase=i/kinds.length;fleet.add(v)})
  g.add(fleet);updateAirportServices(g,0);return g
}
/** Bounded 2–8 vehicles per airport, parent visibility/distance gates updates. */
export function updateAirportServices(root: THREE.Object3D,time: number): void {
  if(!root.visible||root.userData.airportDisposed||!Number.isFinite(time))return
  const g=root.name==='airportFacilities'?root:root.getObjectByName('airportFacilities')
  if(!g?.visible)return
  const plan=g.userData.facilityPlan as FacilityPlan|undefined
  const fleet=g.getObjectByName('airportServices');if(!plan||!fleet)return
  const points=plan.route.map(p=>local(p,plan.center,plan.yaw))
  const lengths=points.map((p,i)=>Math.hypot(points[(i+1)%points.length]!.x-p.x,points[(i+1)%points.length]!.z-p.z))
  const total=lengths.reduce((a,b)=>a+b,0)
  fleet.children.forEach((v,i)=>{
    let distance=((time*(i%3===0?1.5:2.2)+Number(v.userData.phase)*total)%total+total)%total
    for(let j=0;j<points.length;j++){
      const len=lengths[j]!;if(distance>len){distance-=len;continue}
      const a=points[j]!,b=points[(j+1)%points.length]!,t=distance/len
      const x=a.x+(b.x-a.x)*t,z=a.z+(b.z-a.z)*t
      v.position.set(x,plan.grade*z+.16,z);v.rotation.y=Math.atan2(-(b.x-a.x),-(b.z-a.z));break
    }
  })
}

/** Add facade glazing/mullions to the actual polygon, never substitute a box. */
export function mappedTerminalFacade(points: GroundPoint[],elevation: number,height=11): THREE.Group {
  const group=new THREE.Group();group.name='mappedTerminalFacade';const parts=new Parts();let remaining=360
  for(let i=0;i<points.length;i++){
    const a=points[i]!,b=points[(i+1)%points.length]!,dx=b.x-a.x,dz=b.z-a.z,len=Math.hypot(dx,dz)
    if(len<.5)continue
    const angle=-Math.atan2(dz,dx),x=(a.x+b.x)/2,z=(a.z+b.z)/2
    const add=(mat: THREE.Material,y: number,w: number,h: number,d: number,along=0)=>{
      if(remaining--<=0)return
      const geo=new THREE.BoxGeometry(w,h,d);geo.rotateY(angle);geo.translate(x+dx/len*along,y,z+dz/len*along);parts.add(mat,geo)
    }
    // Thin glazed ribbon straddles the facade, visible for either winding.
    for(const y of [elevation+4,elevation+8]){
      add(GLASS,y,len,2.3,.22)
      for(let d=-len/2+1;d<len/2&&remaining>0;d+=4)add(FRAME,y,.14,2.5,.32,d)
      add(FRAME,y-1.2,len,.15,.32)
    }
    add(ROOF,elevation+height+.25,len+.3,.5,.6)
  }
  parts.finish(group);return group
}
function insidePolygon(p: GroundPoint,polygon: GroundPoint[]): boolean {
  let inside=false
  for(let i=0,j=polygon.length-1;i<polygon.length;j=i++){
    const a=polygon[i]!,b=polygon[j]!
    if((a.z>p.z)!==(b.z>p.z)&&p.x<(b.x-a.x)*(p.z-a.z)/(b.z-a.z)+a.x)inside=!inside
  }
  return inside
}
/** Require the whole padded service site inside a mapped apron. Sampling the
 * rectangle alone is insufficient for concave notches, so also reject apron
 * boundary segments intersecting its interior. */
export function mappedApronPlan(ap: AirportData,polygons: GroundPoint[][],obstacles: SurfaceObstacle[],elevation: number): FacilityPlan|null {
  const original=planAirportFacilities(ap);if(!original)return null
  const width=original.scale==='commercial'?58:40,depth=original.scale==='commercial'?100:62
  for(const poly of polygons){
    const xs=poly.map(p=>p.x),zs=poly.map(p=>p.z),minX=Math.min(...xs),maxX=Math.max(...xs),minZ=Math.min(...zs),maxZ=Math.max(...zs)
    for(const fx of [.5,.25,.75,.125,.875])for(const fz of [.5,.25,.75,.125,.875]){
      const center={x:minX+(maxX-minX)*fx,z:minZ+(maxZ-minZ)*fz}
      const hw=width/2+10,hd=depth/2+10
      if(![[-hw,-hd],[-hw,hd],[hw,-hd],[hw,hd]].every(([x,z])=>insidePolygon({x:center.x+x!,z:center.z+z!},poly)))continue
      if(poly.some((p,i)=>hitsSite(local(p,center,0),local(poly[(i+1)%poly.length]!,center,0),hw-.01,hd-.01)))continue
      if([...runwayObstacles(ap),...obstacles].some(o=>hitsSite(local(o.a,center,0),local(o.b,center,0),hw+o.radius,hd+o.radius)))continue
      const plan={...original,center,yaw:0,width,depth,elevation,grade:0,route:[] as GroundPoint[]}
      plan.route=[[-width*.32,-depth*.32],[-width*.16,-depth*.32],[-width*.16,depth*.32],[-width*.32,depth*.32]].map(([x,z])=>facilityPoint(plan,x!,z!))
      return plan
    }
  }
  return null
}
/** Conservative footprint exclusion, including polygon interiors. */
export function footprintObstacle(points: GroundPoint[]): SurfaceObstacle {
  const xs=points.map(p=>p.x),zs=points.map(p=>p.z),minX=Math.min(...xs),maxX=Math.max(...xs),minZ=Math.min(...zs),maxZ=Math.max(...zs)
  return {a:{x:minX,z:(minZ+maxZ)/2},b:{x:maxX,z:(minZ+maxZ)/2},radius:(maxZ-minZ)/2+8}
}
