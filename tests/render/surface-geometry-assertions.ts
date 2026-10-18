import * as THREE from 'three'

/** Independent probes: only current indexed triangles and world transforms. */
export function triangles(mesh:THREE.Mesh):THREE.Triangle[]{
 mesh.updateWorldMatrix(true,false)
 const p=mesh.geometry.getAttribute('position'),ix=mesh.geometry.index!.array,result:THREE.Triangle[]=[]
 for(let i=0;i<ix.length;i+=3)result.push(new THREE.Triangle(...[ix[i]!,ix[i+1]!,ix[i+2]!].map(j=>new THREE.Vector3().fromBufferAttribute(p,j).applyMatrix4(mesh.matrixWorld)) as [THREE.Vector3,THREE.Vector3,THREE.Vector3]))
 return result
}
export function distanceToTriangles(point:THREE.Vector3,tris:THREE.Triangle[]):number{
 let best=Infinity;const q=new THREE.Vector3()
 for(const t of tris){best=Math.min(best,t.closestPointToPoint(point,q).distanceToSquared(point));if(best<1e-14)return 0}
 return Math.sqrt(best)
}
export function indexedPoints(mesh:THREE.Mesh):THREE.Vector3[]{
 mesh.updateWorldMatrix(true,false);const p=mesh.geometry.getAttribute('position')
 return [...new Map([...new Set(mesh.geometry.index!.array)].map(i=>{const v=new THREE.Vector3().fromBufferAttribute(p,i).applyMatrix4(mesh.matrixWorld);return [v.toArray().map(x=>Math.round(x*1e6)).join(','),v] as const})).values()]
}
export function cylinderEnds(mesh:THREE.Mesh):[THREE.Vector3,THREE.Vector3]{
 const p=mesh.geometry.getAttribute('position'),ys=Array.from({length:p.count},(_,i)=>p.getY(i)),limits=[Math.min(...ys),Math.max(...ys)]
 mesh.updateWorldMatrix(true,false)
 return limits.map(y=>new THREE.Vector3(0,y,0).applyMatrix4(mesh.matrixWorld)) as [THREE.Vector3,THREE.Vector3]
}
