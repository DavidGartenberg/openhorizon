import * as THREE from 'three'
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js'
import { aircraftPaint, aircraftMetal, aircraftRubber } from './aircraft-materials'

/** Exterior fittings, expressed in model metres and merged by finish. */
export function addC172Details(group: THREE.Group): void {
  const paint: THREE.BufferGeometry[]=[],metal: THREE.BufferGeometry[]=[],dark: THREE.BufferGeometry[]=[],seals: THREE.BufferGeometry[]=[]
  const white=aircraftPaint(0xe8eced),silver=aircraftMetal(0xbdc9d0,.25),rubber=aircraftRubber()
  const orient=(geo:THREE.BufferGeometry,a:THREE.Vector3,b:THREE.Vector3)=>{
    const q=new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0,1,0),b.clone().sub(a).normalize())
    return geo.applyQuaternion(q).translate((a.x+b.x)/2,(a.y+b.y)/2,(a.z+b.z)/2)
  }
  const rod=(parts:THREE.BufferGeometry[],a:number[],b:number[],r:number)=>{
    const va=new THREE.Vector3(...a),vb=new THREE.Vector3(...b)
    parts.push(orient(new THREE.CylinderGeometry(r,r,va.distanceTo(vb),8),va,vb))
  }
  const loop=(points:number[][])=>{
    for(let i=0;i<points.length;i++)rod(seals,points[i]!,points[(i+1)%points.length]!, .008)
  }
  for(const side of [-1,1]){
    // Lift strut terminates at wing skin and lower cabin longeron.
    const a=new THREE.Vector3(side*.44,-.25,-.38),b=new THREE.Vector3(side*3.65,1.150,-.43)
    const geo=new THREE.CylinderGeometry(.038,.042,a.distanceTo(b),12)
    geo.scale(1,1,1.85);paint.push(orient(geo,a,b))
    for(const p of [a,b])metal.push(new THREE.SphereGeometry(.057,12,8).scale(1,.45,1).translate(p.x,p.y,p.z))
    // Spring main leg from the belly to the axle, not a vertical floating post.
    const ga=new THREE.Vector3(side*.40,-.34,.30),gb=new THREE.Vector3(side*1.15,-1.13,.35)
    const leg=new THREE.CylinderGeometry(.05,.038,ga.distanceTo(gb),10);leg.scale(.6,1,1.7)
    paint.push(orient(leg,ga,gb))
    // Door handle and hinge barrels.
    rod(metal,[side*.566,.24,-.12],[side*.567,.24,-.30],.012)
    for(const z of [-1.18,-1.02])rod(metal,[side*.557,-.05,z],[side*.557,.04,z],.012)
    // Window seals and center divider, exterior-only at cockpit eyepoint.
    const sx=side*.537
    loop([[sx,.459,-1.35],[sx,.459,.02],[sx,.932,.02],[sx,.932,-.932]])
    loop([[sx,.459,.055],[sx,.459,.692],[sx,.932,.692],[sx,.932,.055]])
    // Flush fuel cap on each wing and a short vent below.
    metal.push(new THREE.CylinderGeometry(.05,.05,.009,24).translate(side*1.45,1.174,-.43))
    rod(dark,[side*1.45,1.180,-.455],[side*1.45,1.180,-.405],.004)
    // Cowling openings set just proud of the forward shell, black recessed center.
    const mouth=new THREE.CircleGeometry(.10,32);mouth.scale(1,.58,1);mouth.rotateY(Math.PI)
    dark.push(mouth.translate(side*.245,.12,-2.176))
    const lip=new THREE.TorusGeometry(.102,.008,6,32);lip.scale(1,.58,1)
    metal.push(lip.translate(side*.245,.12,-2.18))
  }
  // Oleo nose leg, fork and small exposed brake hardware.
  rod(metal,[0,-.3,-1.3],[0,-.91,-1.3],.028)
  rod(paint,[0,-.6,-1.3],[0,-.92,-1.3],.043)
  for(const x of [-.087,.087])rod(metal,[0,-.89,-1.3],[x,-1.11,-1.3],.018)
  // Pitot mast, dorsal aerials and exhaust outlet.
  rod(metal,[-2.25,.99,-.65],[-2.25,.78,-.65],.012)
  rod(metal,[-2.25,.78,-.65],[-2.25,.78,-.94],.012)
  rod(paint,[0,1.0,.36],[0,1.36,.54],.011)
  rod(paint,[0,.80,1.20],[0,1.15,1.42],.010)
  rod(dark,[.28,-.34,-1.78],[.3,-.58,-1.80],.034)
  loop([[-.498,.478,-1.565],[.498,.478,-1.565],[.487,.942,-.935],[-.487,.942,-.935]])
  for(const [pieces,material,name,exterior] of [[paint,white,'c172PaintedFittings',false],[metal,silver,'c172MetalFittings',false],[dark,rubber,'c172DarkFittings',false],[seals,rubber,'c172WindowSeals',true]] as const){
    const geo=mergeGeometries([...pieces],false)
    pieces.forEach(g=>g.dispose())
    if(!geo)continue
    const mesh=new THREE.Mesh(geo,material);mesh.name=name;mesh.castShadow=mesh.receiveShadow=true
    if(exterior)mesh.userData.exteriorCabin=true
    group.add(mesh)
  }
}


/** Twisted, tapered two-blade prop silhouette; vertex color tips share one draw. */
export function c172PropGeometry(): THREE.BufferGeometry {
  const shape=new THREE.Shape()
  shape.moveTo(-.04,.06);shape.bezierCurveTo(-.08,.28,-.12,.58,-.072,.89)
  shape.quadraticCurveTo(-.055,.965,.015,.95)
  shape.bezierCurveTo(.10,.77,.065,.47,.04,.06);shape.closePath()
  const blade=new THREE.ExtrudeGeometry(shape,{depth:.025,bevelEnabled:true,bevelSize:.009,bevelThickness:.006,bevelSegments:2,steps:1})
  blade.translate(0,0,-.0125)
  const p=blade.getAttribute('position')
  for(let i=0;i<p.count;i++){const y=p.getY(i);p.setZ(i,p.getZ(i)+p.getX(i)*(.65-y*.5))}
  const opposite=blade.clone().rotateZ(Math.PI)
  const geo=mergeGeometries([blade,opposite],false)!
  blade.dispose();opposite.dispose();geo.computeVertexNormals()
  const pos=geo.getAttribute('position'),colors=new Float32Array(pos.count*3)
  const c=new THREE.Color()
  for(let i=0;i<pos.count;i++){c.setHex(Math.abs(pos.getY(i))>.83?0xd6d6cb:0x20272b);colors[i*3]=c.r;colors[i*3+1]=c.g;colors[i*3+2]=c.b}
  geo.setAttribute('color',new THREE.BufferAttribute(colors,3));return geo
}
