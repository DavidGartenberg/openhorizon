import * as THREE from 'three'
import { obj8AnimMatrix, type ParsedObj8 } from './xplane-obj8'

export type BoeingSurface = 'body' | 'wing' | 'flap' | 'spoiler' | 'fin' | 'stabilizer' | 'engine' | 'sleeve' | 'winglet' | 'tire'
type Point2 = [number, number]
type Triple<T> = [T,T,T]
type Pixel = [number,number,number,number]
export type ArtworkSampler = (u: number, v: number) => Pixel
export interface ArtworkTriangle { chart: Triple<Point2>; uv: Triple<Point2>; depth: Triple<number> }
export interface BakedArtwork { width: number; height: number; slots: 1 | 2 | 4; color: Uint8Array; finish: Uint8Array | null; coverage: number }

const cap = (x: number, min: number, max: number) => Math.max(min, Math.min(max, x))
const mod = (n: number) => n - Math.floor(n)
const tau = Math.PI * 2
/** A belly seam on a cylinder aligned along Z; starboard .25, crown .5. */
export const circumferentialU = (x: number, y: number) => mod((Math.PI - Math.atan2(x, y)) / tau)

/** Sample the top-down BC1, BC2 or BC3 DDS base image directly, without an
 * uncompressed 4096² intermediate. OBJ UVs count up; DDS rows count down.
 * The installed 737 uses BC1 (opaque wing/engine/tail) and BC3 (fuselage/gear). */
export function decodeDdsPixel(buffer: ArrayBuffer): ArtworkSampler {
  if (buffer.byteLength < 128) throw new Error('DDS header is truncated')
  const d = new DataView(buffer)
  if (d.getUint32(0,true) !== 0x20534444 || d.getUint32(4,true) !== 124) throw new Error('Invalid DDS header')
  const fourCc = d.getUint32(84,true), w = d.getUint32(16,true), h = d.getUint32(12,true)
  const bc1 = fourCc === 0x31545844, bc2 = fourCc === 0x33545844, bc3 = fourCc === 0x35545844
  if ((!bc1 && !bc2 && !bc3) || !w || !h || w > 8192 || h > 8192) throw new Error('Unsupported DDS format or size')
  const blockBytes = bc1 ? 8 : 16, bw = Math.ceil(w/4)
  if (128 + bw*Math.ceil(h/4)*blockBytes > buffer.byteLength) throw new Error('DDS base image is truncated')
  const color = (c: number): Pixel => [Math.round((c>>>11)*255/31), Math.round(((c>>>5)&63)*255/63), Math.round((c&31)*255/31),255]
  // The triangle raster walks neighboring pixels; reuse the palette across a block.
  let last = -1, palette: Pixel[] = [], bits = 0, alpha: number[] = []
  return (u,v) => {
    const x = cap(Math.floor(u*w),0,w-1), y = cap(Math.floor((1-v)*h),0,h-1)
    const offset = 128 + ((x>>>2)+(y>>>2)*bw)*blockBytes, index = (x&3)+(y&3)*4
    if (offset !== last) {
      last=offset
      const co=offset+(bc1?0:8), c0=d.getUint16(co,true), c1=d.getUint16(co+2,true), a=color(c0), b=color(c1)
      const lerp=(f:number):Pixel=>[Math.round(a[0]*(1-f)+b[0]*f),Math.round(a[1]*(1-f)+b[1]*f),Math.round(a[2]*(1-f)+b[2]*f),255]
      palette=bc1&&c0<=c1?[a,b,lerp(.5),[0,0,0,0]]:[a,b,lerp(1/3),lerp(2/3)]
      bits=d.getUint32(co+4,true)
      if(bc3){
        const a0=d.getUint8(offset),a1=d.getUint8(offset+1)
        alpha=[a0,a1]
        if(a0>a1) for(let i=1;i<=6;i++) alpha.push(Math.round(((7-i)*a0+i*a1)/7))
        else { for(let i=1;i<=4;i++) alpha.push(Math.round(((5-i)*a0+i*a1)/5)); alpha.push(0,255) }
      }
    }
    const c=palette[(bits>>>(2*index))&3]!
    if(bc1)return c
    if(bc2)return [c[0],c[1],c[2],((d.getUint8(offset+(index>>>1))>>>(4*(index&1)))&15)*17]
    const bit=index*3, lo=offset+2+(bit>>>3)
    const a=(d.getUint8(lo)|(lo<offset+7?d.getUint8(lo+1)<<8:0))>>>(bit&7)
    return [c[0],c[1],c[2],alpha[a&7]!]
  }
}

/** Render donor UVs to a mesh-independent chart. A depth buffer removes
 * overlaid interiors, hardware and overlaps; texture seams are evaluated per
 * donor triangle rather than interpolating vertex UVs across atlas islands. */
export function rasterizeArtwork(tris: readonly ArtworkTriangle[], width:number,height:number,sample:ArtworkSampler):Uint8Array {
  const data=new Uint8Array(width*height*4),depth=new Float32Array(width*height)
  depth.fill(-Infinity)
  for(const tri of tris){
    const [a,b,c]=tri.chart,[u,v,w]=tri.uv,[da,db,dc]=tri.depth
    const ax=a[0]*width,ay=a[1]*height,bx=b[0]*width,by=b[1]*height,cx=c[0]*width,cy=c[1]*height
    const det=(by-cy)*(ax-cx)+(cx-bx)*(ay-cy)
    if(Math.abs(det)<1e-8)continue
    const x0=cap(Math.floor(Math.min(ax,bx,cx)),0,width-1),x1=cap(Math.floor(Math.max(ax,bx,cx)),0,width-1)
    const y0=cap(Math.floor(Math.min(ay,by,cy)),0,height-1),y1=cap(Math.floor(Math.max(ay,by,cy)),0,height-1)
    for(let y=y0;y<=y1;y++)for(let x=x0;x<=x1;x++){
      const rx=x+.5-cx,ry=y+.5-cy,s=((by-cy)*rx+(cx-bx)*ry)/det,t=((cy-ay)*rx+(ax-cx)*ry)/det,k=1-s-t
      if(s< -1e-7||t< -1e-7||k< -1e-7)continue
      const i=y*width+x,z=da*s+db*t+dc*k
      if(z<=depth[i]!)continue
      const color=sample(u[0]*s+v[0]*t+w[0]*k,u[1]*s+v[1]*t+w[1]*k)
      if(!color[3])continue
      depth[i]=z; data.set(color,i*4)
    }
  }
  return data
}

interface Vertex { x:number; y:number; z:number; u:number; v:number; nx:number; ny:number; nz:number }
interface DonorTriangle { p:Triple<Vertex>; refs:string }
const each3=<A,B>(items:Triple<A>, f:(x:A)=>B):Triple<B>=>[f(items[0]),f(items[1]),f(items[2])]
const av=(t:DonorTriangle,axis:'x'|'y'|'z')=>(t.p[0][axis]+t.p[1][axis]+t.p[2][axis])/3
const wingRef=/wing_tip_deflection|slat\d|aileron\d|flap\d|spoiler\d|speedbrake\d/
const moveFlap=/\/flap\d_deg\[/, moveSpoiler=/\/(?:spoiler|speedbrake)\d_deg\[/
const donorDataref=(ref:string)=>ref.includes('/gear/deploy_ratio[')?1:0

function donorTriangles(parsed:ParsedObj8,kind:BoeingSurface):DonorTriangle[]{
  const matrices=parsed.anims.map(()=>new THREE.Matrix4()), point=new THREE.Vector3(), normal=new THREE.Vector3(), normalMatrix=new THREE.Matrix3()
  for(const node of parsed.anims){
    const m=matrices[node.id]!
    obj8AnimMatrix(node.specs,donorDataref,m)
    if(node.parent>=0)m.premultiply(matrices[node.parent]!)
  }
  const visible=parsed.draws.filter(d=>!d.hidden&&!d.cockpit&&d.lod===0&&d.count>0)
  // The largest datum-frame fuselage draw is the opaque hull. Smaller draws
  // include cabin fittings, door recesses, windows and animated internals.
  const hull=kind==='body'?visible.filter(d=>!d.animPath.length).reduce<(typeof visible)[number]|undefined>((best,d)=>!best||d.count>best.count?d:best,undefined):null
  const out:DonorTriangle[]=[]
  const identity=new THREE.Matrix4()
  for(const draw of visible){
    if(hull&&draw!==hull)continue
    const refs=draw.animPath.flatMap(n=>parsed.anims[n]?.specs.map(s=>s.dataref)??[]).join(' ')
    if(kind==='wing'&&!wingRef.test(refs))continue
    if(kind==='flap'&&!moveFlap.test(refs))continue
    if(kind==='spoiler'&&!moveSpoiler.test(refs))continue
    if(kind==='stabilizer'&&!/stabilizer_deflection|elevator\d_deg/.test(refs))continue
    if(kind==='fin'&&/stabilizer_deflection|elevator\d_deg|wing_tip_deflection/.test(refs))continue
    if(kind==='winglet'&&(!/wing_tip_deflection/.test(refs)||moveFlap.test(refs)))continue
    if(kind==='engine'&&/engine_rotation_angle|thrust_reverser_deploy_ratio/.test(refs))continue
    if(kind==='sleeve'&&!/thrust_reverser_deploy_ratio/.test(refs))continue
    if(kind==='tire'&&(!/tire_rotation_angle_deg\[1\]/.test(refs)||draw.count<1000))continue
    // Engine and tire artwork uses its component-local datum; fuselage and
    // wing sections are aligned in the deployed aircraft frame instead.
    const local=kind==='engine'||kind==='sleeve'||kind==='tire'
    const matrix=local?identity:matrices[draw.animPath.at(-1)??-1]??identity
    normalMatrix.getNormalMatrix(matrix)
    const vertex=(i:number):Vertex=>{
      point.fromArray(parsed.vertices,i*3).applyMatrix4(matrix)
      normal.fromArray(parsed.normals,i*3).applyMatrix3(normalMatrix).normalize()
      return {x:point.x,y:point.y,z:point.z,nx:normal.x,ny:normal.y,nz:normal.z,u:parsed.uvs[i*2]!,v:parsed.uvs[i*2+1]!}
    }
    for(let i=draw.start;i<draw.start+draw.count;i+=3){
      const ix=parsed.indices[i],iy=parsed.indices[i+1],iz=parsed.indices[i+2]
      if(ix===undefined||iy===undefined||iz===undefined||Math.max(ix,iy,iz)*3+2>=parsed.vertices.length)continue
      const p:Triple<Vertex>=[vertex(ix),vertex(iy),vertex(iz)]
      const t={p,refs}
      if(kind==='fin'&&(av(t,'z')<28||av(t,'y')<1.3||Math.abs(av(t,'x'))>1.0))continue
      if(kind==='winglet'&&(Math.abs(av(t,'x'))<15.0||av(t,'y')<.75))continue
      if(kind==='wing'&&Math.abs(av(t,'x'))<1.4)continue
      // Omit the recessed fan and pylon from the nacelle-cowl chart: the
      // source CFM barrel radius is near 1 m around (-.4,-1.1).
      if(kind==='engine'&&(av(t,'y')>-.2||av(t,'z')>-.1))continue
      if(kind==='tire'&&(av(t,'x')<.15||av(t,'x')>.75))continue
      out.push(t)
    }
  }
  return out
}

function planar(tris:DonorTriangle[],kind:BoeingSurface,side:number,top:number):ArtworkTriangle[]{
  const vertical=kind==='fin'||kind==='winglet'
  const bothSides=kind!=='fin'
  const selected=tris.filter(t=>(!bothSides||Math.sign(av(t,'x'))===side))
  const span=(p:Vertex)=>vertical?p.y:Math.abs(p.x)
  const depth=(p:Vertex)=>top*(vertical?p.x:p.y)
  let s0=Infinity,s1=-Infinity,c0=Infinity,c1=-Infinity
  for(const {p} of selected)for(const v of p){ const s=span(v);s0=Math.min(s0,s);s1=Math.max(s1,s);c0=Math.min(c0,v.z);c1=Math.max(c1,v.z) }
  if(!(s1-s0>1e-4&&c1-c0>1e-4))return []
  return selected.filter(({p})=>p.reduce((a,v)=>a+top*(vertical?v.nx:v.ny),0)>-.1).map(({p})=>({
    chart:each3(p,v=>[(span(v)-s0)/(s1-s0),(v.z-c0)/(c1-c0)]), uv:each3(p,v=>[v.u,v.v]), depth:each3(p,depth),
  }))
}

function cylinder(tris:DonorTriangle[],kind:BoeingSurface):ArtworkTriangle[]{
  const axis=(v:Vertex)=>kind==='tire'?v.x:v.z
  let min=Infinity,max=-Infinity
  for(const {p} of tris)for(const v of p){ min=Math.min(min,axis(v));max=Math.max(max,axis(v)) }
  if(!(max-min>1e-4))return []
  const result:ArtworkTriangle[]=[]
  for(const {p} of tris){
    const coords=each3(p,(v):{uv:Point2;radius:number;front:number}=>{
      const x=kind==='tire'?v.y:v.x+(kind==='engine'?.40:0)
      const y=kind==='tire'?v.z:v.y+(kind==='engine'?1.12:0)
      const u=kind==='tire'?mod(circumferentialU(x,y)-.5):circumferentialU(x,y)
      return {uv:[u,(axis(v)-min)/(max-min)],radius:Math.hypot(x,y),front:x*(kind==='tire'?v.ny:v.nx)+y*(kind==='tire'?v.nz:v.ny)}
    })
    if(coords.reduce((a,c)=>a+c.front,0)<-.05)continue
    const chart=each3(coords,c=>c.uv), u=chart.map(c=>c[0])
    const wrap=Math.max(...u)-Math.min(...u)>.5
    if(wrap)for(const v of chart)if(v[0]<.5)v[0]+=1
    const uv=each3(p,(v):Point2=>[v.u,v.v]),depth=each3(coords,c=>c.radius)
    result.push({chart,uv,depth})
    if(wrap)result.push({chart:each3(chart,(v):Point2=>[v[0]-1,v[1]]),uv,depth})
  }
  return result
}

/** Pack each span column into its own leading→trailing chord coordinate.
 * This follows sweep/taper rather than squeezing a whole 737 silhouette into
 * a different Boeing's wing bounding box. Four-pixel tiles gutters prevent
 * unrelated faces bleeding into each other through mip filtering. */
function packTile(raw:Uint8Array,w:number,h:number,dst:Uint8Array,stride:number,ox:number,oy:number,planarFit:boolean,bounds?:Int32Array):Int32Array {
  const rect=bounds??new Int32Array(w*2), inset=4
  if(!bounds)for(let x=0;x<w;x++){
    let lo=0,hi=h-1
    if(planarFit){
      while(lo<h&&!raw[(lo*w+x)*4+3])lo++
      while(hi>=0&&!raw[(hi*w+x)*4+3])hi--
    }
    rect[2*x]=lo;rect[2*x+1]=hi
  }
  for(let y=0;y<h;y++)for(let x=0;x<w;x++){
    const sx=Math.round(cap((x-inset)/(w-1-inset*2),0,1)*(w-1))
    const t=cap((y-inset)/(h-1-inset*2),0,1),lo=rect[2*sx]!,hi=rect[2*sx+1]!
    if(lo>hi)continue
    const sy=Math.round(lo+(hi-lo)*t),from=(sy*w+sx)*4,to=((oy+y)*stride+ox+x)*4
    dst[to]=raw[from]!;dst[to+1]=raw[from+1]!;dst[to+2]=raw[from+2]!;dst[to+3]=raw[from+3]!
  }
  return rect
}

/** Bake donor color and optional PBR channels into bounded chart tiles. */
export function bakeBoeingArtwork(parsed:ParsedObj8,kind:BoeingSurface,colorSample:ArtworkSampler,finishSample:ArtworkSampler|null,tile?:[number,number]):BakedArtwork {
  const cylindrical=kind==='body'||kind==='engine'||kind==='sleeve'||kind==='tire'
  const slots=cylindrical?1:kind==='fin'?2:4
  const columns=slots===4?2:1,rows=slots===1?1:2
  const [w,h]=tile??(kind==='body'?[768,1536]:kind==='engine'||kind==='sleeve'?[512,768]:kind==='tire'?[256,256]:[384,384])
  const width=w*columns,height=h*rows,color=new Uint8Array(width*height*4),finish=finishSample?new Uint8Array(color.length):null
  const tris=donorTriangles(parsed,kind)
  for(let row=0;row<rows;row++)for(let col=0;col<columns;col++){
    const projection=cylindrical?cylinder(tris,kind):planar(tris,kind,col===0?-1:1,row===0?1:-1)
    const albedo=rasterizeArtwork(projection,w,h,colorSample)
    const bounds=packTile(albedo,w,h,color,width,col*w,row*h,!cylindrical)
    if(finish&&finishSample)packTile(rasterizeArtwork(projection,w,h,finishSample),w,h,finish,width,col*w,row*h,!cylindrical,bounds)
  }
  let painted=0
  for(let i=3;i<color.length;i+=4)if(color[i]!)painted++
  return {width,height,slots,color,finish,coverage:painted/(width*height)}
}
