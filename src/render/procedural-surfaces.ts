import * as THREE from 'three'

export interface HingeFrame {
  root: THREE.Group
  length: number
  setAngle(rad:number):void
  worldEndpoints():readonly [THREE.Vector3,THREE.Vector3]
}

export interface LiveLinkage {
  rod: THREE.Mesh
  fixedMount: THREE.Object3D
  movingMount: THREE.Object3D
  update():void
  readonly lastFixed: THREE.Vector3
  readonly lastMoving: THREE.Vector3
}

const X = new THREE.Vector3(1,0,0)
const Y = new THREE.Vector3(0,1,0)
const finite = (n:number,fallback=0):number => Number.isFinite(n)?n:fallback

/** A local X-axis frame whose complete axis passes through both supplied parent-space points. */
export function createHingeFrame(parent:THREE.Object3D,name:string,a:THREE.Vector3,b:THREE.Vector3):HingeFrame {
  const axis=b.clone().sub(a), length=axis.length()
  if(!(length>1e-7))throw new Error(`${name} hinge endpoints coincide`)
  const root=new THREE.Group();root.name=name;root.position.copy(a)
  root.quaternion.setFromUnitVectors(X,axis.multiplyScalar(1/length));parent.add(root)
  const baseQuaternion=root.quaternion.clone(),twist=new THREE.Quaternion()
  root.userData.hingeStart=a.clone();root.userData.hingeEnd=b.clone();root.userData.hingeLength=length
  let angle=0
  return {
    root,length,
    setAngle(rad:number){angle=THREE.MathUtils.clamp(finite(rad),-Math.PI*.65,Math.PI*.65);root.userData.surfaceAngle=angle;root.quaternion.copy(baseQuaternion).multiply(twist.setFromAxisAngle(X,angle))},
    worldEndpoints(){
      root.updateWorldMatrix(true,false)
      return [root.localToWorld(new THREE.Vector3()),root.localToWorld(new THREE.Vector3(length,0,0))] as const
    },
  }
}

/** Allocation-free updating rod joining mounts that may live under different transforms. */
export function createLiveLinkage(parent:THREE.Object3D,name:string,fixedMount:THREE.Object3D,movingMount:THREE.Object3D,radius:number,material=new THREE.MeshStandardMaterial({color:0x929aa1,metalness:.7,roughness:.3})):LiveLinkage {
  const rod=new THREE.Mesh(new THREE.CylinderGeometry(radius,radius,1,8),material);rod.name=name;parent.add(rod)
  const lastFixed=new THREE.Vector3(),lastMoving=new THREE.Vector3(),a=new THREE.Vector3(),b=new THREE.Vector3(),d=new THREE.Vector3(),mid=new THREE.Vector3()
  const update=()=>{
    fixedMount.updateWorldMatrix(true,false);movingMount.updateWorldMatrix(true,false);parent.updateWorldMatrix(true,false)
    fixedMount.getWorldPosition(a);movingMount.getWorldPosition(b)
    lastFixed.copy(a);lastMoving.copy(b)
    parent.worldToLocal(a);parent.worldToLocal(b);d.subVectors(b,a)
    const length=Math.max(1e-7,d.length());rod.position.copy(mid.addVectors(a,b).multiplyScalar(.5));rod.scale.set(1,length,1)
    rod.quaternion.setFromUnitVectors(Y,d.multiplyScalar(1/length));rod.updateWorldMatrix(false,false);rod.userData.fixedEndpoint=lastFixed;rod.userData.movingEndpoint=lastMoving
  }
  const linkage={rod,fixedMount,movingMount,update,lastFixed,lastMoving};update();return linkage
}

/** Attachment error since the last mechanism update; useful for geometry acceptance. */
export function linkageError(linkage:LiveLinkage):number {
  linkage.fixedMount.updateWorldMatrix(true,false);linkage.movingMount.updateWorldMatrix(true,false)
  const a=linkage.fixedMount.getWorldPosition(new THREE.Vector3()),b=linkage.movingMount.getWorldPosition(new THREE.Vector3())
  linkage.rod.updateWorldMatrix(true,false)
  const r0=linkage.rod.localToWorld(new THREE.Vector3(0,-.5,0)),r1=linkage.rod.localToWorld(new THREE.Vector3(0,.5,0))
  return Math.min(Math.max(a.distanceTo(r0),b.distanceTo(r1)),Math.max(a.distanceTo(r1),b.distanceTo(r0)))
}

export function bounded(value:number|undefined,lo=-1,hi=1):number {
  return THREE.MathUtils.clamp(Number.isFinite(value)?value!:0,lo,hi)
}

/** Clip the existing indexed skin, retaining its contour and interpolated normals.
 * Positive plane distance is retained. The exposed cross-section is capped;
 * neither half is re-lofted into a smaller, differently shaped airfoil. */
export function cutSkin(source:THREE.BufferGeometry,plane:THREE.Plane):THREE.BufferGeometry {
  const positions=source.getAttribute('position'),normals=source.getAttribute('normal')
  const indices=source.index?.array??Array.from({length:positions.count},(_,i)=>i)
  const p:number[]=[],n:number[]=[],ix:number[]=[],edge:THREE.Vector3[]=[]
  type V={p:THREE.Vector3;n:THREE.Vector3}
  const put=(v:V)=>{const i=p.length/3;p.push(...v.p.toArray());n.push(...v.n.toArray());return i}
  for(let k=0;k<indices.length;k+=3){
    const tri=Array.from({length:3},(_,j)=>{const i=indices[k+j]!;return {p:new THREE.Vector3().fromBufferAttribute(positions,i),n:new THREE.Vector3().fromBufferAttribute(normals,i)}})
    const poly:V[]=[]
    for(let j=0;j<3;j++){
      const a=tri[j]!,b=tri[(j+1)%3]!,da=plane.distanceToPoint(a.p),db=plane.distanceToPoint(b.p)
      if(da>=-1e-8)poly.push(a)
      if((da>1e-8&&db< -1e-8)||(da< -1e-8&&db>1e-8)){
        const t=da/(da-db),v={p:a.p.clone().lerp(b.p,t),n:a.n.clone().lerp(b.n,t).normalize()};poly.push(v);edge.push(v.p)
      }else if(Math.abs(da)<1e-8)edge.push(a.p)
    }
    if(poly.length>=3){const base=poly.map(put);for(let j=1;j<base.length-1;j++)ix.push(base[0]!,base[j]!,base[j+1]!)}
  }
  const unique=[...new Map(edge.map(v=>[v.toArray().map(x=>Math.round(x*1e6)).join(','),v])).values()]
  if(unique.length>=3){
    const center=unique.reduce((a,b)=>a.add(b),new THREE.Vector3()).divideScalar(unique.length)
    const normal=plane.normal.clone().negate(),axis=Math.abs(normal.x)<.8?new THREE.Vector3(1,0,0):new THREE.Vector3(0,1,0)
    const u=axis.addScaledVector(normal,-axis.dot(normal)).normalize(),v=new THREE.Vector3().crossVectors(normal,u)
    unique.sort((a,b)=>Math.atan2(a.clone().sub(center).dot(v),a.clone().sub(center).dot(u))-Math.atan2(b.clone().sub(center).dot(v),b.clone().sub(center).dot(u)))
    const ci=put({p:center,n:normal}),ring=unique.map(p=>put({p,n:normal}))
    for(let j=0;j<ring.length;j++)ix.push(ci,ring[j]!,ring[(j+1)%ring.length]!)
  }
  const geometry=new THREE.BufferGeometry(),position=new THREE.Float32BufferAttribute(p,3)
  geometry.setAttribute('position',position);geometry.setAttribute('normal',new THREE.Float32BufferAttribute(n,3))
  // Exact-on-plane vertices can appear twice during polygon clipping. Reject
  // zero-area triangles after Float32 conversion, including degenerate cap fans.
  const clean:number[]=[],a=new THREE.Vector3(),b=new THREE.Vector3(),c=new THREE.Vector3()
  for(let i=0;i<ix.length;i+=3){a.fromBufferAttribute(position,ix[i]!);b.fromBufferAttribute(position,ix[i+1]!);c.fromBufferAttribute(position,ix[i+2]!);if(b.sub(a).cross(c.sub(a)).lengthSq()>1e-18)clean.push(ix[i]!,ix[i+1]!,ix[i+2]!)}
  geometry.setIndex(clean);return geometry
}

export function attachSkin(hinge:HingeFrame,skin:THREE.Mesh):void {
  hinge.root.parent!.updateMatrixWorld(true);hinge.root.attach(skin);skin.userData.hinge=hinge.root
}

/** A real horn ends on an indexed skin vertex. The mount is its other end,
 * and the live cylinder joins the two horns through all surface travel. */
export function skinDrive(parent:THREE.Object3D,name:string,fixedSkin:THREE.Mesh,movingSkin:THREE.Mesh,fixedTarget:THREE.Vector3,movingTarget:THREE.Vector3,offset:number,radius:number,material:THREE.Material):LiveLinkage {
  const horn=(skin:THREE.Mesh,target:THREE.Vector3,label:string)=>{
    skin.updateWorldMatrix(true,false)
    const p=skin.geometry.getAttribute('position'),local=skin.worldToLocal(parent.localToWorld(target.clone()))
    let best=Infinity,anchor=new THREE.Vector3()
    for(const i of new Set(skin.geometry.index!.array)){const v=new THREE.Vector3().fromBufferAttribute(p,i),d=v.distanceToSquared(local);if(d<best){best=d;anchor=v}}
    const mount=new THREE.Object3D();mount.name=`${name}-${label}-mount`;mount.position.copy(anchor).add(new THREE.Vector3(0,-offset,0));skin.add(mount)
    const bracket=new THREE.Mesh(new THREE.CylinderGeometry(radius*1.8,radius*1.8,offset,8),material);bracket.name=`${name}-${label}-horn`;bracket.position.copy(anchor).add(new THREE.Vector3(0,-offset/2,0));skin.add(bracket)
    mount.userData.bracket=bracket;mount.userData.skin=skin
    return mount
  }
  return createLiveLinkage(parent,name,horn(fixedSkin,fixedTarget,'fixed'),horn(movingSkin,movingTarget,'moving'),radius,material as THREE.MeshStandardMaterial)
}
