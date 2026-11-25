import * as THREE from 'three'
import type { BoeingSurface } from './boeing-artwork-projector'

export interface BoeingSurfaceFit { kind:BoeingSurface; side:1|-1; chart:'panel'|'box'|'barrel'|'wheel'; ownsMaterial:boolean; span?:readonly [number,number] }

/** Mark existing paintable meshes. The actual geometry and pivots stay in
 * the aircraft builder. The marker is inert unless the Boeing donor loads. */
export function markBoeingSurface<T extends THREE.Mesh>(mesh:T,kind:BoeingSurface,side:number=1,chart:BoeingSurfaceFit['chart']='panel',ownsMaterial=false,span?:readonly [number,number]):T {
  mesh.userData.boeingSurface={kind,side:side<0?-1:1,chart,ownsMaterial,span} satisfies BoeingSurfaceFit
  return mesh
}

export function markBoeingNacelle(group:THREE.Group,side:number):void {
  group.traverse(o=>{
    if(!(o instanceof THREE.Mesh))return
    if(o.name==='nacelleCowl')markBoeingSurface(o,'engine',side,'barrel')
    if(o.name==='reverserSleeve')markBoeingSurface(o,'sleeve',side,'barrel')
  })
}

export function markBoeingWheel(group:THREE.Group):void {
  const tire=group.getObjectByName('tire')
  if(tire instanceof THREE.Mesh)markBoeingSurface(tire,'tire',1,'wheel')
}
