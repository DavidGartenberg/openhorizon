import * as THREE from 'three'
import type {AnimSpec} from '../../src/render/xplane-obj8'

export const surfaceRef = /\/(?:aileron\d_deg|elevator\d_deg|rudder\d_deg|flap\d_deg|spoiler\d_deg|speedbrake\d_deg|slat\d_deploy_ratio)|\/composite_|\/stabilizer_deflection_degrees|\/controls\/(?:elevator|rudder)_trim/
export interface DrawComponent {
  id:string
  mesh:THREE.Mesh
  vertices:number[]
  triangles:number[][]
  refs:string[]
  center:THREE.Vector3
  size:THREE.Vector3
}
/** Weld only coincident positions within one actual draw, not unused buffer vertices. */
export function drawComponents(root:THREE.Object3D):DrawComponent[] {
 const result:DrawComponent[]=[]
 root.traverse(o=>{
  if(!(o instanceof THREE.Mesh))return
  const g=o.geometry,index=g.index!,position=g.attributes.position!
  const parents=new Map<number,number>(),welded=new Map<string,number>()
  const find=(v:number):number=>{const parent=parents.get(v)!;if(parent===v)return v;const r=find(parent);parents.set(v,r);return r}
  const vertex=(i:number)=>{
   const v=index.getX(i),k=`${Math.round(position.getX(v)*1e5)},${Math.round(position.getY(v)*1e5)},${Math.round(position.getZ(v)*1e5)}`
   if(!parents.has(v))parents.set(v,v)
   const duplicate=welded.get(k)
   if(duplicate!==undefined)parents.set(find(v),find(duplicate));else welded.set(k,v)
   return v
  }
  for(let i=g.drawRange.start;i<g.drawRange.start+g.drawRange.count;i+=3){const a=vertex(i),b=vertex(i+1),c=vertex(i+2);parents.set(find(b),find(a));parents.set(find(c),find(a))}
  const islands=new Map<number,number[]>()
  for(const v of parents.keys()){const r=find(v),island=islands.get(r)??[];island.push(v);islands.set(r,island)}
  const refs=new Set<string>();let p=o.parent;while(p){for(const spec of (p.userData.anim??[]) as AnimSpec[])if(surfaceRef.test(spec.dataref))refs.add(spec.dataref);p=p.parent}
  let part=o;while(part.parent&&part.parent!==root)part=part.parent as THREE.Mesh
  for(const [islandRoot,vertices] of islands){
   const triangles:number[][]=[]
   for(let i=g.drawRange.start;i<g.drawRange.start+g.drawRange.count;i+=3)if(find(index.getX(i))===islandRoot)triangles.push([index.getX(i),index.getX(i+1),index.getX(i+2)])
   vertices.sort((a,b)=>a-b)
   const box=new THREE.Box3().setFromPoints(vertices.map(v=>new THREE.Vector3().fromBufferAttribute(position,v).applyMatrix4(o.matrixWorld)))
   result.push({id:`${part.name}|${g.drawRange.start}|${vertices[0]}`,mesh:o,vertices,triangles,refs:[...refs],center:box.getCenter(new THREE.Vector3()),size:box.getSize(new THREE.Vector3())})
  }
 })
 return result
}
export function vertexWorld(c:DrawComponent,v:number):THREE.Vector3 {
 return new THREE.Vector3().fromBufferAttribute(c.mesh.geometry.attributes.position!,v).applyMatrix4(c.mesh.matrixWorld)
}

/** Registration in a frozen partner triangle's local frame. This also detects
 * sliding tangentially away from a hinge, which a scalar gap cannot detect. */
export function interfacePosition(source:DrawComponent,sourceVertex:number,partner:DrawComponent,triangle:number[]):number[] {
 const a=vertexWorld(partner,triangle[0]!),b=vertexWorld(partner,triangle[1]!),c=vertexWorld(partner,triangle[2]!)
 const along=b.sub(a).normalize(),normal=new THREE.Vector3().crossVectors(along,c.sub(a)).normalize()
 const across=new THREE.Vector3().crossVectors(normal,along)
 const delta=vertexWorld(source,sourceVertex).sub(a)
 if(!normal.lengthSq())throw new Error(`Degenerate interface triangle ${partner.id}`)
 return [delta.dot(along),delta.dot(normal),delta.dot(across)]
}

/** Upper/lower drawn skin at an embedded track's exact x/z location. */
export function socketClearance(source:DrawComponent,vertex:number,partner:DrawComponent):number[] {
 const p=vertexWorld(source,vertex)
 let bottom=-Infinity,top=Infinity
 for(const ids of partner.triangles){
  const a=vertexWorld(partner,ids[0]!),b=vertexWorld(partner,ids[1]!),c=vertexWorld(partner,ids[2]!)
  const d=(b.z-c.z)*(a.x-c.x)+(c.x-b.x)*(a.z-c.z)
  if(Math.abs(d)<1e-10)continue
  const u=((b.z-c.z)*(p.x-c.x)+(c.x-b.x)*(p.z-c.z))/d
  const v=((c.z-a.z)*(p.x-c.x)+(a.x-c.x)*(p.z-c.z))/d
  if(u<0||v<0||u+v>1)continue
  const y=u*a.y+v*b.y+(1-u-v)*c.y
  if(y<=p.y)bottom=Math.max(bottom,y)
  if(y>=p.y)top=Math.min(top,y)
 }
 return [p.y-bottom,top-p.y]
}
