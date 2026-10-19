import * as THREE from 'three'
import { aircraftPaint } from './aircraft-materials'

/** Painted aluminum skins. These are graphic construction cues, not additional
 * aerodynamic surfaces. UVs use the complete airframe so stripes cross parts. */
let bodyMap: THREE.CanvasTexture | undefined
let wingMap: THREE.CanvasTexture | undefined
function texture(canvas: HTMLCanvasElement): THREE.CanvasTexture {
  const t=new THREE.CanvasTexture(canvas);t.colorSpace=THREE.SRGBColorSpace;t.anisotropy=8
  return t
}
function bodyTexture(): THREE.CanvasTexture | undefined {
  if (bodyMap || typeof document==='undefined')return bodyMap
  const canvas=document.createElement('canvas');canvas.width=2048;canvas.height=1024
  const c=canvas.getContext('2d');if(!c)return undefined
  // Two independently lettered sides: the far-side registration stays readable.
  const scaleX=2048/8.03, scaleY=512/1.65
  for(const side of [0,1]){
    c.save();c.translate(0,side*512)
    const X=(z:number)=>(side===0?5.78-z:z+2.25)*scaleX
    const Y=(y:number)=>(1.12-y)*scaleY
    c.fillStyle='#eff1f1';c.fillRect(0,0,2048,512)
    const grad=c.createLinearGradient(0,Y(-.08),0,Y(-.5));grad.addColorStop(0,'#e5e8e8');grad.addColorStop(1,'#aeb7bd')
    c.fillStyle=grad;c.fillRect(0,Y(-.08),2048,512-Y(-.08))
    const polygon=(points:[number,number][],color:string)=>{c.fillStyle=color;c.beginPath();points.forEach(([z,y],i)=>i?c.lineTo(X(z),Y(y)):c.moveTo(X(z),Y(y)));c.closePath();c.fill()}
    polygon([[-2.25,.12],[-.9,.08],[.6,.15],[2.6,.39],[5.78,.64],[5.78,.52],[2.6,.28],[.6,-.015],[-.9,-.075],[-2.25,-.05]],'#9f1727')
    polygon([[-2.25,-.09],[-.9,-.115],[.6,-.055],[2.6,.235],[5.78,.47],[5.78,.435],[2.6,.195],[.6,-.09],[-.9,-.15],[-2.25,-.125]],'#233e52')
    // Door seam follows the lower cabin; the window perimeter is real geometry.
    c.strokeStyle='rgba(38,49,56,.50)';c.lineWidth=1.4
    c.beginPath();c.moveTo(X(-1.29),Y(.43));c.lineTo(X(-1.26),Y(-.22));c.quadraticCurveTo(X(-1.2),Y(-.33),X(-1.05),Y(-.33));c.lineTo(X(-.03),Y(-.33));c.quadraticCurveTo(X(.09),Y(-.29),X(.09),Y(-.13));c.lineTo(X(.09),Y(.45));c.stroke()
    c.strokeStyle='rgba(60,70,74,.25)';c.lineWidth=1
    for(const z of [-1.64,.95,1.7,2.5,3.3]){c.beginPath();c.moveTo(X(z),Y(.47));c.lineTo(X(z),Y(-.46));c.stroke()}
    // Small service access panel and cowling fasteners.
    c.strokeRect(X(side===0?-1.98:-1.73),Y(.33),.25*scaleX,.14*scaleY)
    c.fillStyle='#5c6469'
    for(const z of [-2.08,-1.72])for(const y of [.30,.03,-.25]){c.beginPath();c.arc(X(z),Y(y),1.6,0,Math.PI*2);c.fill()}
    c.font='600 68px sans-serif';c.fillStyle='#203646'
    c.textAlign='center';c.save();c.translate(X(2.55),Y(.37));c.scale(1,.82);c.fillText('N172OH',0,0);c.restore()
    c.font='italic 24px sans-serif';c.textAlign='center';c.fillStyle='#293c4a';c.fillText('SKYHAWK',X(-.63),Y(.28))
    c.restore()
  }
  bodyMap=texture(canvas);return bodyMap
}
function wingTexture(): THREE.CanvasTexture | undefined {
  if(wingMap||typeof document==='undefined')return wingMap
  const canvas=document.createElement('canvas');canvas.width=2048;canvas.height=512
  const c=canvas.getContext('2d');if(!c)return undefined
  c.fillStyle='#e8eded';c.fillRect(0,0,2048,512)
  const X=(x:number)=>(x+5.5)/11*2048
  const Y=(q:number)=>q*512
  c.fillStyle='#a41c2c';c.fillRect(0,0,X(-5.24),512);c.fillRect(X(5.24),0,2048-X(5.24),512)
  c.strokeStyle='rgba(62,76,85,.26)';c.lineWidth=1
  for(let x=-4.9;x<=4.91;x+=.55){c.beginPath();c.moveTo(X(x),Y(.12));c.lineTo(X(x),Y(.94));c.stroke()}
  c.strokeStyle='rgba(41,55,64,.6)';c.lineWidth=2
  for(const side of [-1,1]){
    c.beginPath();c.moveTo(X(side*.75),Y(.79));c.lineTo(X(side*5.17),Y(.79));c.stroke()
    c.beginPath();c.moveTo(X(side*2.7),Y(.79));c.lineTo(X(side*2.7),512);c.stroke()
    c.strokeStyle='rgba(61,72,82,.35)';c.lineWidth=1
    c.strokeRect(X(side<0?-2.1:.9),Y(.28),1.2/11*2048,.32*512)
    c.fillStyle='#50606a';c.font='9px sans-serif';c.textAlign='center';c.fillText('NO STEP',X(side*3.4),Y(.9))
  }
  wingMap=texture(canvas);return wingMap
}
export function finishC172Body(mesh: THREE.Mesh): void {
  mesh.updateMatrix()
  const position=mesh.geometry.getAttribute('position'), uv=new Float32Array(position.count*2)
  const p=new THREE.Vector3()
  for(let i=0;i<position.count;i++){
    p.fromBufferAttribute(position,i).applyMatrix4(mesh.matrix)
    const right=p.x>=0
    uv[i*2]=(right?5.78-p.z:p.z+2.25)/8.03
    uv[i*2+1]=(right?.5:0)+THREE.MathUtils.clamp((p.y+.53)/1.65,0,1)*.5
  }
  mesh.geometry.setAttribute('uv',new THREE.BufferAttribute(uv,2))
  const material=aircraftPaint(0xffffff,{map:bodyTexture()??null,roughness:.3,clearcoat:.48,clearcoatRoughness:.18})
  const compile=material.onBeforeCompile
  material.onBeforeCompile=(shader,renderer)=>{
    compile.call(material,shader,renderer)
    // Side lettering must not interpolate through the opposite-side atlas on
    // the roof/nose centerline. Smoothly reveal plain paint around those bends.
    shader.fragmentShader=shader.fragmentShader.replace('#include <map_fragment>',`#include <map_fragment>
      diffuseColor.rgb=mix(vec3(1.0),diffuseColor.rgb,smoothstep(0.25,0.65,abs(vAircraftSkinNormal.x)));`)
  }
  material.customProgramCacheKey=()=> 'c172-painted-sides-v1'
  mesh.material=material
}
export function finishC172Wing(mesh: THREE.Mesh): void {
  const p=mesh.geometry.getAttribute('position'),uv=new Float32Array(p.count*2)
  for(let i=0;i<p.count;i++){
    const x=p.getX(i),taper=Math.max(0,(Math.abs(x)-2.7)/2.8)
    const chord=1.63-taper*.5,leading=1.115-taper*.255
    uv[i*2]=(x+5.5)/11;uv[i*2+1]=1-(p.getZ(i)+leading)/chord
  }
  mesh.geometry.setAttribute('uv',new THREE.BufferAttribute(uv,2))
  mesh.material=aircraftPaint(0xffffff,{map:wingTexture()??null,roughness:.34,clearcoat:.38})
}
