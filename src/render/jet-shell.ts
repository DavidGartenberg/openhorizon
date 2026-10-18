import * as THREE from 'three'
import { liveryMaterial, isBusinessLivery } from './livery'

const NOSE: [number, number][] = [[0,1],[.13,.994],[.27,.935],[.43,.81],[.60,.63],[.76,.425],[.88,.245],[.96,.105],[1,0]]
const smooth = (x: number): number => { x = THREE.MathUtils.clamp(x, 0, 1); return x*x*(3-2*x) }
/** One closed loft, exact ±length/2 envelope; upper decks deform the crown
 * of this same skin instead of intersecting cylindrical pods. */
export function buildJetShell(length: number, radius: number, paint: THREE.Material,
  designator?: string, hump: '747' | 'a380' | 'none' = 'none'): THREE.Group {
  const group = new THREE.Group(); group.name = 'jetFuselage'
  const business = !!designator && isBusinessLivery(designator)
  const noseLength = radius * (business ? 3.35 : hump === 'a380' ? 1.8 : designator?.startsWith('B73') ? 2.15 : designator?.startsWith('B78') ? 2.2 : 1.9)
  const shoulder = -length/2 + noseLength
  const tailStart = length * .25
  const barrelLength = tailStart - shoulder
  const point = (z: number, angle: number, proud = 0): THREE.Vector3 => {
    let r = radius, center = radius*.32
    if (z < shoulder) {
      const f = (shoulder-z)/noseLength
      for (let i=1;i<NOSE.length;i++) {
        const a=NOSE[i-1]!, b=NOSE[i]!
        if(f<=b[0]+1e-8) { r *= THREE.MathUtils.lerp(a[1],b[1],(f-a[0])/(b[0]-a[0])); break }
      }
      center -= radius*.15*f*f
    } else if(z > tailStart) {
      const f = (z-tailStart)/(length/2-tailStart)
      r *= 1-smooth(f)
      center += radius*.42*smooth(f)
    }
    let crown = 0
    if(hump === 'a380') crown = radius*.42
    if(hump === '747') {
      const end = designator === 'B742' ? -.10*length : .04*length
      crown = radius*.52*(1-smooth((z-(end-length*.12))/(length*.12)))
    }
    const c=Math.cos(angle)
    return new THREE.Vector3(Math.sin(angle)*(r+proud), center+c*(r+proud) + Math.max(c,0)**2*crown*(r/radius), z)
  }
  const stations = [...NOSE.map(([f])=>shoulder-noseLength*f).reverse()]
  for(let i=1;i<=16;i++) stations.push(shoulder+barrelLength*i/16)
  for(let i=1;i<=16;i++) stations.push(tailStart+(length/2-tailStart)*i/16)
  const p:number[]=[], uv:number[]=[], idx:number[]=[]; const n=64
  const geometry=new THREE.BufferGeometry()
  for(const z of stations)for(let i=0;i<=n;i++) {
    // Belly seam, starboard quarter, crown half: existing livery convention.
    p.push(...point(z,Math.PI-i/n*Math.PI*2).toArray())
    uv.push(i/n,THREE.MathUtils.clamp((z-shoulder)/barrelLength,0,1))
  }
  for(let j=0;j<stations.length-1;j++) {
    for(let i=0;i<n;i++) { const a=j*(n+1)+i,b=a+n+1; idx.push(a,a+1,b,b,a+1,b+1) }
  }
  geometry.setAttribute('position',new THREE.Float32BufferAttribute(p,3));geometry.setAttribute('uv',new THREE.Float32BufferAttribute(uv,2));geometry.setIndex(idx);geometry.computeVertexNormals()
  const shell=new THREE.Mesh(geometry,designator?liveryMaterial(designator,barrelLength,radius):paint);shell.userData.exteriorCabin=true;shell.name='continuousJetSkin';shell.castShadow=shell.receiveShadow=true;group.add(shell)
  const glass=new THREE.MeshPhysicalMaterial({color:0x183344,roughness:.13,metalness:.08,clearcoat:1,transparent:true,opacity:.9,depthWrite:false,side:THREE.DoubleSide})
  // Three trapezoids per side. Solve the skin angle for a physical window
  // height, so upper-deck deformation cannot stretch glazing into an arch.
  const topY = radius * (hump==='747' ? 1.48 : business ? 1.10 : .98)
  const glassHeight = Math.min(.70, radius*(business?.40:.53))
  const bottomY = topY-glassHeight
  const centerFraction = (height:number):number => {
    let lo=0,hi=1
    for(let i=0;i<30;i++) {const f=(lo+hi)/2;if(point(shoulder-noseLength*f,.025).y>height)lo=f;else hi=f}
    return (lo+hi)/2
  }
  const skinAtHeight=(f:number,y:number,side:number):THREE.Vector3=> {
    const z=shoulder-noseLength*f
    // y = center + r*cos(a) + crown*max(cos(a),0)^2. Solve directly
    // instead of 30 allocating point evaluations per glazing vertex.
    const equator=point(z,Math.PI/2),r=equator.x
    const crown=Math.max(0,point(z,0).y-equator.y-r),dy=y-equator.y
    const cosine=dy>0&&crown>1e-8
      ? 2*dy/(r+Math.sqrt(r*r+4*crown*dy))
      : dy/Math.max(r,1e-8)
    return point(z,side*Math.acos(THREE.MathUtils.clamp(cosine,-1,1)),.035)
  }
  const frontTop=centerFraction(topY),frontBottom=centerFraction(bottomY)
  // Top/bottom fore-aft bounds: front windshield, sliding side pane, aft pane.
  const panes = business
    ? [[frontTop,.28,frontBottom,.38],[.26,.10,.36,.14],[.08,-.03,.12,-.03]]
    : [[frontTop,.18,frontBottom,.31],[.16,-.055,.285,.015],[-.075,-.23,-.005,-.23]]
  for(const side of [-1,1])for(const bounds of panes) {
    const pos:number[]=[],ids:number[]=[]
    for(let row=0;row<=10;row++)for(let col=0;col<=20;col++) {
      const v=row/10,u=col/20
      const f=THREE.MathUtils.lerp(THREE.MathUtils.lerp(bounds[0]!,bounds[1]!,u),THREE.MathUtils.lerp(bounds[2]!,bounds[3]!,u),v)
      pos.push(...skinAtHeight(f,THREE.MathUtils.lerp(topY,bottomY,v),side).toArray())
    }
    for(let row=0;row<10;row++)for(let col=0;col<20;col++){const a=row*21+col;ids.push(a,a+1,a+21,a+1,a+22,a+21)}
    const geo=new THREE.BufferGeometry();geo.setAttribute('position',new THREE.Float32BufferAttribute(pos,3));geo.setIndex(ids);geo.computeVertexNormals()
    const pane=new THREE.Mesh(geo,glass);pane.name='cockpitGlazing';pane.userData.exteriorCabin=true;group.add(pane)
  }
  if(hump!=='none') {
    // One combined draw for every upper-deck window.
    const end=hump==='a380'?tailStart-radius:designator==='B742'?-length*.22:-length*.07
    const pos:number[]=[],ids:number[]=[]
    for(const side of [-1,1])for(let z=shoulder+radius*.45;z<end;z+=.82) {
      const base=pos.length/3
      for(const dz of [-.16,.16])for(const da of [-.055,.055])pos.push(...point(z+dz,side*(.83+da),.015).toArray())
      ids.push(base,base+1,base+2,base+1,base+3,base+2)
    }
    const geo=new THREE.BufferGeometry();geo.setAttribute('position',new THREE.Float32BufferAttribute(pos,3));geo.setIndex(ids);geo.computeVertexNormals()
    const pane=new THREE.Mesh(geo,glass);pane.name='upperDeckWindow';pane.userData.exteriorCabin=true;group.add(pane)
  }
  group.userData.barrelLength=barrelLength
  group.userData.noseLength=noseLength
  return group
}
