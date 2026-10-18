import {readFileSync} from 'node:fs'
import * as THREE from 'three'
import {XP_MODELS,XP_CONTROL_LIMITS} from '../../src/render/xplane-manifest'
import {parseObj8,buildObj8,applyObj8Anim,applyObj8Visibility} from '../../src/render/xplane-obj8'
import {localDatarefReader} from '../../src/render/local-aircraft'
import type {SurfaceState} from '../../src/render/aircraft-mesh'
import {drawComponents} from './native-interface-geometry'

export const nativeBase='/Users/davidgartenberg/X-Plane 12/Aircraft/Laminar Research/'
export function nativeInterfaceScene(key:string) {
 const root=new THREE.Group(),animated:THREE.Group[]=[]
 for(const path of XP_MODELS[key]!.objs){
  // Cabin instruments, propellers and glazing are not exterior mechanisms.
  if(/glass|cockpit|seats|alpha|pax_windows|prop/i.test(path))continue
  const parsed=parseObj8(readFileSync(nativeBase+path,'utf8'))
  const built=buildObj8(parsed,new THREE.MeshBasicMaterial(),{name:path})
  root.add(built.group);animated.push(...built.animated)
 }
 root.updateMatrixWorld(true)
 const components=drawComponents(root)
 return {
  root,components,
  pose(state:SurfaceState){
   const read=localDatarefReader(state,0,0,new Map(Object.entries(XP_CONTROL_LIMITS[key]!)),key)
   for(const node of animated){applyObj8Anim(node,read);applyObj8Visibility(node,read)}
   root.updateMatrixWorld(true)
  },
  dispose(){root.traverse(o=>{if(o instanceof THREE.Mesh){o.geometry.dispose();(o.material as THREE.Material).dispose()}})},
 }
}
