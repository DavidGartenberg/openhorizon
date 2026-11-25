import * as THREE from 'three'
import { ROSTER } from '../sim/aircraft/roster'
import type { AircraftMesh } from './aircraft-mesh'
import { circumferentialU, type BoeingSurface } from './boeing-artwork-projector'
import type { BoeingArtworkWorkerResult } from './boeing-artwork-worker'
import type { BoeingSurfaceFit } from './boeing-surface-fit'
import { withSurfaceFinish } from './material-finish'

const BOEING_KEYS=new Set(['737','B738',...ROSTER.filter(r=>r.spec.label.startsWith('Boeing ')).map(r=>r.spec.designator)])
export const isBoeingPlayer=(key:string)=>BOEING_KEYS.has(key)
interface Chart { color:THREE.Texture; finish:THREE.Texture|null; slots:1|2|4 }
export interface BoeingArtworkPack {
  charts:Partial<Record<BoeingSurface,Chart>>
  evidence:{donor:'B738';charts:string[];pixels:number;coverage?:Partial<Record<BoeingSurface,number>>;gpuMiB?:number;warnings?:string[]}
  retain?:()=>()=>void
}

function texture(data:Uint8Array,width:number,height:number,srgb:boolean):THREE.DataTexture {
  const map=new THREE.DataTexture(data,width,height)
  map.colorSpace=srgb?THREE.SRGBColorSpace:THREE.NoColorSpace
  map.minFilter=THREE.LinearMipmapLinearFilter;map.magFilter=THREE.LinearFilter
  map.generateMipmaps=true;map.anisotropy=4;map.needsUpdate=true
  return map
}

// One immutable bounded chart pack is shared by the sim and the inspection
// studio's small LRU, including on rapid aircraft changes. No per-aircraft
// copies of X-Plane's original 4K maps are uploaded to the GPU.
let loading:Promise<BoeingArtworkPack|null>|undefined
async function loadBoeingArtwork():Promise<BoeingArtworkPack|null>{
  if(typeof Worker==='undefined'||typeof window==='undefined')return null
  return loading??=(async()=>{
    const manifest=await fetch('/xp/manifest.json')
    if(!manifest.ok||!(await manifest.json() as {available?:boolean}).available)return null
    const result=await new Promise<BoeingArtworkWorkerResult>((resolve,reject)=>{
      const worker=new Worker(new URL('./boeing-artwork-worker.ts',import.meta.url),{type:'module'})
      const done=()=>{clearTimeout(timer);worker.terminate()}
      const timer=setTimeout(()=>{done();reject(new Error('Boeing artwork projection timed out'))},60_000)
      worker.onmessage=(event:MessageEvent<BoeingArtworkWorkerResult>)=>{done();resolve(event.data)}
      worker.onerror=event=>{done();reject(new Error(event.message||'Boeing artwork worker failed'))}
      worker.postMessage(null)
    })
    const charts:BoeingArtworkPack['charts']={}
    const coverage:Partial<Record<BoeingSurface,number>>={}
    let pixels=0,bytes=0
    for(const [kind,chart] of Object.entries(result.charts)){
      if(!chart)continue
      charts[kind as BoeingSurface]={
        color:texture(chart.color,chart.width,chart.height,true),
        finish:chart.finish?texture(chart.finish,chart.width,chart.height,false):null,
        slots:chart.slots,
      }
      coverage[kind as BoeingSurface]=chart.coverage
      pixels+=chart.width*chart.height
      bytes+=chart.color.byteLength+(chart.finish?.byteLength??0)
    }
    if(!pixels)throw new Error(result.warnings.join('; ')||'Boeing donor atlas unavailable')
    let users=0,idle:ReturnType<typeof setTimeout>
    const retire=()=>{
      if(users)return
      idle=setTimeout(()=>{
        if(users)return
        for(const chart of Object.values(charts)){chart.color.dispose();chart.finish?.dispose()}
        loading=undefined
      },20_000)
    }
    retire()
    return {charts,evidence:{donor:'B738' as const,charts:Object.keys(charts),pixels,coverage,gpuMiB:bytes*(4/3)/(1024**2),warnings:result.warnings},retain:()=>{
      clearTimeout(idle);users++
      let released=false
      return ()=>{if(released)return;released=true;users--;retire()}
    }}
  })().catch(error=>{loading=undefined;throw error})
}

function assignSurfaceCoordinates(mesh:THREE.Mesh,fit:BoeingSurfaceFit):void {
  const geometry=mesh.geometry,position=geometry.getAttribute('position'),uv=geometry.getAttribute('uv')
  const normals=geometry.getAttribute('normal')
  geometry.computeBoundingBox()
  const b=geometry.boundingBox!
  const range=(v:number,a:number,z:number)=>Math.max(0,Math.min(1,(v-a)/Math.max(z-a,1e-6)))
  const data=new Float32Array(position.count*3)
  for(let i=0;i<position.count;i++){
    const x=position.getX(i),y=position.getY(i),z=position.getZ(i)
    let u=uv?.getX(i)??0,v=uv?.getY(i)??0,face=normals?.getY(i)??1
    if(fit.chart==='barrel'){
      // JetShell's first U already follows its closed ring and preserves the
      // belly UV seam even at the collapsed nose/tail vertices. Keep Z in
      // metres, not the procedural livery's clamped barrel-only coordinate.
      u=fit.kind==='body'?u:circumferentialU(x,y)
      v=range(z,b.min.z,b.max.z)
      if(fit.kind!=='body'&&u<1e-5&&uv&&uv.getX(i)>.9)u=1
    }else if(fit.chart==='wheel'){
      // The tire's own lathe UV puts a duplicated seam on the positive-Z
      // radial line. The donor chart shares that axis and winding.
      u=uv?.getX(i)??0;v=range(x,b.min.x,b.max.x)
    }else if(fit.chart==='box'){
      if(fit.kind==='winglet'){
        u=range(y,b.min.y,b.max.y);v=range(z,b.min.z,b.max.z);face=normals?.getX(i)??1
      }else{
        const span=range(x,b.min.x,b.max.x)
        u=fit.side>0?span:1-span;v=range(z,b.min.z,b.max.z)
      }
    }
    if(fit.span)u=THREE.MathUtils.lerp(fit.span[0],fit.span[1],u)
    if(fit.kind==='fin')face=-face
    data.set([u,v,face],i*3)
  }
  geometry.setAttribute('boeingUv',new THREE.BufferAttribute(data,3))
}

function paintExistingSurface(original:THREE.MeshStandardMaterial,fit:BoeingSurfaceFit,chart:Chart):THREE.MeshStandardMaterial {
  const mat=original.clone()
  // The procedural airline canvas can leak through gaps and mip transitions
  // when it remains bound beneath a projected X-Plane chart. Release every
  // old paint map on this material and use the donor chart as its sole image.
  mat.map=null;mat.roughnessMap=null;mat.bumpMap=null
  // Authored panel joints already live in the donor image. Do not composite
  // the old skin shader's second set of artificial seams/rivets over them.
  delete mat.userData.surfaceFinish
  mat.userData.boeingArtwork={donor:'B738',surface:fit.kind}
  const rows=chart.slots===1?1:2,cols=chart.slots===4?2:1
  const image=chart.color.image as {width:number;height:number}
  const inset=new THREE.Vector2(4.5/(image.width/cols),4.5/(image.height/rows))
  const column=cols===2&&fit.side>0?1:0
  mat.onBeforeCompile=(shader,renderer)=>{
    shader.uniforms.uBoeingArt={value:chart.color}
    shader.uniforms.uBoeingInset={value:inset}
    shader.uniforms.uBoeingColumn={value:column}
    if(chart.finish)shader.uniforms.uBoeingFinish={value:chart.finish}
    shader.vertexShader=shader.vertexShader.replace('#include <common>','#include <common>\nattribute vec3 boeingUv; varying vec3 vBoeingUv;')
      .replace('#include <begin_vertex>','#include <begin_vertex>\nvBoeingUv = boeingUv;')
    shader.fragmentShader=shader.fragmentShader.replace('#include <common>',`#include <common>\nvarying vec3 vBoeingUv; uniform sampler2D uBoeingArt; uniform vec2 uBoeingInset; uniform float uBoeingColumn;${chart.finish?' uniform sampler2D uBoeingFinish;':''}`)
      .replace('#include <map_fragment>',`#include <map_fragment>
vec2 boeingSampleUv = mix(uBoeingInset, vec2(1.0) - uBoeingInset, clamp(vBoeingUv.xy, 0.0, 1.0));
boeingSampleUv.x = (boeingSampleUv.x + uBoeingColumn) / ${cols.toFixed(1)};
boeingSampleUv.y = (boeingSampleUv.y${rows===2?' + float(vBoeingUv.z < 0.0)':''}) / ${rows.toFixed(1)};
vec4 boeingPaint = texture2D(uBoeingArt, boeingSampleUv);
diffuseColor.rgb = mix(diffuseColor.rgb, boeingPaint.rgb, boeingPaint.a);
${chart.finish?'vec2 boeingPbr = texture2D(uBoeingFinish, boeingSampleUv).rg;':''}`)
    if(chart.finish)shader.fragmentShader=shader.fragmentShader
      .replace('#include <roughnessmap_fragment>','#include <roughnessmap_fragment>\nroughnessFactor = mix(roughnessFactor, boeingPbr.r, boeingPaint.a * 0.72);')
      .replace('#include <metalnessmap_fragment>','#include <metalnessmap_fragment>\nmetalnessFactor = mix(metalnessFactor, boeingPbr.g, boeingPaint.a * 0.72);')
    THREE.Material.prototype.onBeforeCompile.call(mat,shader,renderer)
  }
  mat.customProgramCacheKey=()=>`boeing-chart:${rows}:${cols}:${+!!chart.finish}:v2`
  if(fit.ownsMaterial){
    // The new paint no longer samples the original cached livery maps.
    // Release this aircraft's owner now; other cached users remain valid.
    original.dispose()
  }
  return withSurfaceFinish(mat,fit.kind==='tire'?'rubber':'authored-paint')
}

/** Material-only upgrade. Missing/invalid local files leave the existing
 * aircraft flyable, with its unaltered geometry and animation callbacks. */
export async function upgradeBoeingArtwork(ship:AircraftMesh,key:string,load:()=>Promise<BoeingArtworkPack|null>=loadBoeingArtwork):Promise<void>{
  if(!isBoeingPlayer(key)||ship.group.userData.boeingArtworkStarted)return
  ship.group.userData.boeingArtworkStarted=true
  const oldDispose=ship.group.userData.dispose as (()=>void)|undefined
  let disposed=false,release:(()=>void)|undefined
  ship.group.userData.dispose=()=>{if(disposed)return;disposed=true;release?.();oldDispose?.()}
  try{
    const pack=await load()
    if(!pack||disposed)return
    const applied:Partial<Record<BoeingSurface,number>>={}
    ship.group.traverse(o=>{
      if(!(o instanceof THREE.Mesh)||!(o.material instanceof THREE.MeshStandardMaterial))return
      const fit=o.userData.boeingSurface as BoeingSurfaceFit|undefined
      if(!fit)return
      const chart=pack.charts[fit.kind]
      if(!chart)return
      assignSurfaceCoordinates(o,fit)
      o.material=paintExistingSurface(o.material,fit,chart)
      applied[fit.kind]=(applied[fit.kind]??0)+1
    })
    if(Object.keys(applied).length){
      release=pack.retain?.()
      ship.group.userData.visualSource='procedural-xplane-artwork'
      ship.group.userData.assetEvidence={...pack.evidence,applied}
    }
  }catch(err){if(!disposed)ship.group.userData.localAssetError=err instanceof Error?err.message:String(err)}
}
