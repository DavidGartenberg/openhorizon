import * as THREE from 'three'
import { aircraftPaint } from './aircraft-materials'

const PROFILE:[number,number][]=[[0,1],[.13,.994],[.27,.935],[.43,.81],[.60,.63],[.76,.425],[.88,.245],[.96,.105],[1,0]]
function point(r:number,length:number,f:number,angle:number,proud=0):THREE.Vector3 {
  let radius=0
  for(let i=1;i<PROFILE.length;i++){
    const a=PROFILE[i-1]!,b=PROFILE[i]!
    if(f<=b[0]){radius=THREE.MathUtils.lerp(a[1],b[1],(f-a[0])/(b[0]-a[0]));break}
  }
  return new THREE.Vector3(Math.sin(angle)*(r*radius+proud),Math.cos(angle)*(r*radius+proud)-r*.15*f*f,-length*f)
}
/** Continuous barrel shoulder, drooped radome and glazing on its actual skin.
 * The original cylinder attachment and forward extent are retained. */
export function buildJetNose(radius:number,length:number,paint:THREE.Material):THREE.Group {
  const group=new THREE.Group();group.name='jetNose'
  const positions:number[]=[],uv:number[]=[],indices:number[]=[]
  const n=64
  for(const [f] of PROFILE)for(let i=0;i<=n;i++){
    positions.push(...point(radius,length,f,i/n*Math.PI*2).toArray());uv.push(i/n,1-f)
  }
  for(let j=0;j<PROFILE.length-1;j++)for(let i=0;i<n;i++){
    const a=j*(n+1)+i,b=a+n+1
    indices.push(a,a+1,b,b,a+1,b+1)
  }
  const geometry=new THREE.BufferGeometry();geometry.setAttribute('position',new THREE.Float32BufferAttribute(positions,3));geometry.setAttribute('uv',new THREE.Float32BufferAttribute(uv,2));geometry.setIndex(indices);geometry.computeVertexNormals()
  const nose=new THREE.Mesh(geometry,paint);nose.name='radome';nose.castShadow=nose.receiveShadow=true;group.add(nose)
  const glass=new THREE.MeshPhysicalMaterial({color:0x163140,roughness:.13,metalness:.08,clearcoat:1,clearcoatRoughness:.055,transparent:true,opacity:.84,depthWrite:false,side:THREE.DoubleSide})
  for(const side of [-1,1])for(const [a0,a1] of [[.025,.42],[.455,.98]]){
    const p:number[]=[],id:number[]=[]
    for(let row=0;row<=4;row++)for(let col=0;col<=5;col++){
      const angle=side*(a0!+(a1!-a0!)*col/5)
      p.push(...point(radius,length,.245+row/4*.285,angle,.009).toArray())
    }
    for(let row=0;row<4;row++)for(let col=0;col<5;col++){const i=row*6+col;id.push(i,i+1,i+6,i+1,i+7,i+6)}
    const g=new THREE.BufferGeometry();g.setAttribute('position',new THREE.Float32BufferAttribute(p,3));g.setIndex(id);g.computeVertexNormals()
    const pane=new THREE.Mesh(g,glass);pane.name='cockpitGlazing';pane.userData.exteriorCabin=true;group.add(pane)
  }
  return group
}
let flag:THREE.DataTexture|undefined
/** Conforming painted flag; UV follows span/chord, so no raised color blocks. */
export function tailFlagMaterial():THREE.MeshPhysicalMaterial{
  if(!flag){
    const w=128,h=128,data=new Uint8Array(w*h*4)
    for(let y=0;y<h;y++)for(let x=0;x<w;x++){
      const height=x/(w-1),chord=y/(h-1)
      const band=Math.floor(height*8+chord*1.6)
      const color=chord>.66&&height>.25?[27,54,105]:band%2?[184,30,46]:[235,239,243]
      const i=(y*w+x)*4;data[i]=color[0]!;data[i+1]=color[1]!;data[i+2]=color[2]!;data[i+3]=255
    }
    flag=new THREE.DataTexture(data,w,h);flag.colorSpace=THREE.SRGBColorSpace;flag.magFilter=THREE.LinearFilter;flag.minFilter=THREE.LinearMipmapLinearFilter;flag.generateMipmaps=true;flag.anisotropy=8;flag.needsUpdate=true
  }
  return aircraftPaint(0xffffff,{map:flag,roughness:.32})
}
