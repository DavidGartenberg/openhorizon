import { parseObj8 } from './xplane-obj8'
import { bakeBoeingArtwork, decodeDdsPixel, type ArtworkSampler, type BakedArtwork, type BoeingSurface } from './boeing-artwork-projector'

const BASE='/xp/aircraft/Boeing%20737-800/objects/'
const SOURCES: ReadonlyArray<readonly [string,readonly BoeingSurface[]]>=[
  ['738fuselage.obj',['body']],['738wings.obj',['wing','flap','spoiler']],
  ['738tailwinglets.obj',['fin','stabilizer','winglet']],['738cfm56L.obj',['engine','sleeve']],['738maingear.obj',['tire']],
]
export interface BoeingArtworkWorkerResult { charts: Partial<Record<BoeingSurface,BakedArtwork>>; warnings:string[] }
const href=(name:string)=>BASE+name.split('/').map(encodeURIComponent).join('/')

async function imageSampler(blob:Blob):Promise<ArtworkSampler>{
  const img=await createImageBitmap(blob,{premultiplyAlpha:'none',colorSpaceConversion:'none'})
  try{
    const k=Math.min(1,2048/Math.max(img.width,img.height)),w=Math.max(1,Math.round(img.width*k)),h=Math.max(1,Math.round(img.height*k))
    const canvas=new OffscreenCanvas(w,h),ctx=canvas.getContext('2d',{willReadFrequently:true})
    if(!ctx)throw new Error('2D texture conversion unavailable')
    ctx.drawImage(img,0,0,w,h)
    const pixels=ctx.getImageData(0,0,w,h).data
    return (u,v)=>{
      const x=Math.max(0,Math.min(w-1,Math.floor(u*w))),y=Math.max(0,Math.min(h-1,Math.floor((1-v)*h))),i=(y*w+x)*4
      return [pixels[i]!,pixels[i+1]!,pixels[i+2]!,pixels[i+3]!]
    }
  } finally{ img.close() }
}

async function readMap(name:string,ddsFirst:boolean):Promise<ArtworkSampler>{
  const bare=name.replace(/\.(png|dds)$/i,'')
  const candidates=ddsFirst?[`${bare}.dds`,name]:[name,`${bare}.dds`]
  let cause:unknown
  for(const file of new Set(candidates)){
    try{
      const r=await fetch(href(file))
      if(!r.ok)throw new Error(`${file}: HTTP ${r.status}`)
      if(/\.dds$/i.test(file))return decodeDdsPixel(await r.arrayBuffer())
      return await imageSampler(await r.blob())
    } catch(err){cause=err}
  }
  throw cause
}

async function project():Promise<BoeingArtworkWorkerResult>{
  const charts:BoeingArtworkWorkerResult['charts']={},warnings:string[]=[]
  // Only one donor OBJ and compressed source atlas are live at a time. The
  // worker never instantiates a donor aircraft or creates WebGL resources.
  for(const [file,roles] of SOURCES){
    try{
      const response=await fetch(href(file))
      if(!response.ok)throw new Error(`HTTP ${response.status}`)
      const obj=parseObj8(await response.text())
      if(!obj.albedo||!obj.indices.length)throw new Error('No textured geometry')
      const diffuse=await readMap(obj.albedo,true)
      let finish:ArtworkSampler|null=null
      if(obj.normalMetalness&&obj.normal){
        try{
          const normal=await readMap(obj.normal,false),gain=Math.max(0,Math.min(1,obj.specular??1))
          finish=(u,v)=>{
            const [, ,f0,gloss]=normal(u,v)
            const rough=Math.round(Math.max(.06,1-gain*gloss/255)*255)
            return [rough,Math.round(Math.max(0,(f0/255-.04)/.96)*255),0,255]
          }
        } catch(error){warnings.push(`${file}: optional finish unavailable (${String(error)})`)}
      }
      for(const role of roles){
        const chart=bakeBoeingArtwork(obj,role,diffuse,finish)
        if(chart.coverage>=.08)charts[role]=chart
        else warnings.push(`${file}: insufficient ${role} chart coverage (${Math.round(chart.coverage*100)}%)`)
      }
    } catch(err){warnings.push(`${file}: ${String(err)}`)}
  }
  return {charts,warnings}
}

// Keep the message surface small and one-shot; all pixels remain local.
const scope=self as unknown as {onmessage:(event:MessageEvent)=>void;postMessage:(data:BoeingArtworkWorkerResult,transfer:Transferable[])=>void}
scope.onmessage=()=>{void project().then(result=>{
  const transfer:Transferable[]=[]
  for(const chart of Object.values(result.charts)){
    if(!chart)continue
    transfer.push(chart.color.buffer as ArrayBuffer)
    if(chart.finish)transfer.push(chart.finish.buffer as ArrayBuffer)
  }
  scope.postMessage(result,transfer)
}).catch(error=>scope.postMessage({charts:{},warnings:[String(error)]},[]))}
