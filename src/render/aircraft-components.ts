import * as THREE from 'three'
import { aircraftPaint, aircraftMetal, aircraftRubber } from './aircraft-materials'

/** A closed airfoil loft retaining the old panel's planform and 0..thick envelope.
 * Cosine chord spacing resolves the rounded nose without wasting aft vertices. */
export function profiledPanelGeometry(
  rootLeX: number, rootChord: number, tipLeX: number, tipChord: number,
  y0: number, y1: number, thick: number,
): THREE.BufferGeometry {
  const steps = 32
  const sample = (u: number): number => Math.max(0, .2969 * Math.sqrt(u) - .126 * u - .3516 * u ** 2 + .2843 * u ** 3 - .1036 * u ** 4)
  const chord = Array.from({ length: steps + 1 }, (_, i) => (1 - Math.cos(i * Math.PI / steps)) / 2)
  const peak = Math.max(...chord.map(sample))
  const section: [number, number][] = []
  for (let i = 0; i <= steps; i++) section.push([chord[i]!, .5 + sample(chord[i]!) / peak * .5])
  for (let i = steps - 1; i > 0; i--) section.push([chord[i]!, .5 - sample(chord[i]!) / peak * .5])
  const p: number[] = [], uv: number[] = [], idx: number[] = []
  const n = section.length
  for (let station = 0; station <= 4; station++) {
    const t = station / 4
    for (const [u, h] of section) {
      p.push(THREE.MathUtils.lerp(y0, y1, t), h * thick, -(THREE.MathUtils.lerp(rootLeX, tipLeX, t) - THREE.MathUtils.lerp(rootChord, tipChord, t) * u))
      uv.push(t, u)
    }
  }
  const triangle = (a: number, b: number, c: number): void => { if (y1 > y0) idx.push(a, b, c); else idx.push(a, c, b) }
  for (let s = 0; s < 4; s++) for (let j = 0; j < n; j++) {
    const a = s * n + j, b = s * n + (j + 1) % n, c = a + n, d = b + n
    triangle(a, b, c); triangle(b, d, c)
  }
  // Duplicate cap vertices so flat end normals don't spoil the airfoil skin.
  for (const end of [0, 4]) {
    const base = p.length / 3
    for (let j = 0; j < n; j++) { p.push(...p.slice((end * n + j) * 3, (end * n + j) * 3 + 3)); uv.push(...section[j]!) }
    for (let j = 1; j < n - 1; j++) {
      if (end === 0) triangle(base, base + j + 1, base + j)
      else triangle(base, base + j, base + j + 1)
    }
  }
  const geo = new THREE.BufferGeometry()
  geo.setAttribute('position', new THREE.Float32BufferAttribute(p, 3))
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2))
  geo.setIndex(idx)
  geo.computeVertexNormals()
  return geo
}

export function profiledPanel(
  rootLeX: number, rootChord: number, tipLeX: number, tipChord: number,
  y0: number, y1: number, thick: number, material: THREE.Material,
): THREE.Mesh {
  const mesh = new THREE.Mesh(profiledPanelGeometry(rootLeX, rootChord, tipLeX, tipChord, y0, y1, thick), material)
  mesh.castShadow = mesh.receiveShadow = true
  return mesh
}

const nacellePaint = aircraftPaint(0xe6e9eb)
const polished = aircraftMetal(0xb8c2cc, .25)
const fanMetal = new THREE.MeshStandardMaterial({ color: 0x64717c, roughness: .4, metalness: .8, side: THREE.DoubleSide })
const liner = new THREE.MeshStandardMaterial({ color: 0x303a42, roughness: .78, metalness: .35, side: THREE.DoubleSide })
const exhaustMetal = new THREE.MeshStandardMaterial({ color: 0x3c4147, roughness: .57, metalness: .7, side: THREE.DoubleSide })
const tireMaterial = aircraftRubber()

function axialShell(points: [number, number][], radius: number, length: number, material: THREE.Material): THREE.Mesh {
  const geo = new THREE.LatheGeometry(points.map(([r, z]) => new THREE.Vector2(r * radius, z * length)), 48)
  geo.rotateX(Math.PI / 2)
  const mesh = new THREE.Mesh(geo, material)
  mesh.castShadow = mesh.receiveShadow = true
  return mesh
}

/** Nose is -Z. Shells are annuli, never opaque inlet caps. Sleeve translates in
 * local +Z; callers may animate userData.reverserSleeve without moving the rig. */
export function buildTurbofan(radius: number, length: number, paint: THREE.Material = nacellePaint): THREE.Group {
  const group = new THREE.Group()
  group.name = 'turbofan'
  // Ordered axial sections make a continuous rolled lip and barrel shoulder.
  const cowl = axialShell([[.83,-.485],[.89,-.5],[.95,-.486],[.985,-.445],[1,-.36],[.99,-.16],[.955,.09],[.88,.29]], radius, length, paint)
  cowl.name = 'nacelleCowl'
  group.add(cowl)
  const lip = axialShell([[.825,-.455],[.83,-.485],[.86,-.498],[.89,-.5],[.92,-.496],[.95,-.486],[.972,-.465]],radius,length,polished)
  lip.name = 'intakeLip'
  group.add(lip)
  group.add(axialShell([[.825,-.455],[.80,-.38],[.77,-.27],[.75,-.18]],radius,length,liner))
  const back = new THREE.Mesh(new THREE.CircleGeometry(radius * .84, 48), liner)
  back.rotation.y = Math.PI
  back.position.z = -length * .155
  back.name = 'fanRecess'
  group.add(back)
  // One instanced draw for swept, twisted fan blades. Geometry is radial in XY.
  const bladeGeo = new THREE.BufferGeometry()
  bladeGeo.setAttribute('position', new THREE.Float32BufferAttribute([
    radius*.16,0,0, radius*.42,radius*.10,-radius*.025, radius*.75,radius*.15,radius*.035,
    radius*.75,radius*.23,radius*.07, radius*.42,radius*.22,radius*.025, radius*.16,radius*.095,0,
  ],3))
  bladeGeo.setIndex([0,1,5,1,4,5,1,2,4,2,3,4]); bladeGeo.computeVertexNormals()
  const blades = new THREE.InstancedMesh(bladeGeo,fanMetal,28)
  const dummy = new THREE.Object3D()
  for (let i=0;i<28;i++) { dummy.rotation.z=i*Math.PI*2/28; dummy.position.z=-length*.19; dummy.updateMatrix(); blades.setMatrixAt(i,dummy.matrix) }
  blades.name='fanBlades'; group.add(blades)
  const hub = axialShell([[0,-.34],[.09,-.32],[.17,-.25],[.20,-.18],[.20,-.155]],radius,length,polished)
  hub.name='fanHub'; group.add(hub)
  const sleeve = axialShell([[.96,.08],[.955,.15],[.90,.32],[.81,.46]],radius,length,paint)
  sleeve.name='reverserSleeve'; sleeve.userData.stowZ=0
  group.userData.reverserSleeve=sleeve; group.add(sleeve)
  group.add(axialShell([[.89,.08],[.89,.28],[.77,.45],[.70,.47]],radius,length,liner))
  group.add(axialShell([[.57,.26],[.57,.40],[.49,.50],[.43,.50],[.43,.38]],radius,length,exhaustMetal))
  group.add(axialShell([[.30,.30],[.28,.39],[.16,.48],[0,.50]],radius,length,exhaustMetal))
  return group
}

/** Wheel axle X. Profile remains within the original radius and width envelope. */
export function buildAircraftWheel(radius: number, width: number): THREE.Group {
  const group = new THREE.Group(); group.name='aircraftWheel'
  const points: [number,number][] = [[.48,-.47],[.68,-.5],[.88,-.45],[.97,-.32],[1,-.18],[.99,-.13],[1,-.09],[1,.09],[.99,.13],[1,.18],[.97,.32],[.88,.45],[.68,.5],[.48,.47],[.48,-.47]]
  const tireGeo = new THREE.LatheGeometry(points.map(([r,x])=>new THREE.Vector2(r*radius,x*width)),40)
  tireGeo.rotateZ(-Math.PI/2)
  const tire = new THREE.Mesh(tireGeo,tireMaterial); tire.name='tire'; tire.castShadow=true; group.add(tire)
  const hubGeo=new THREE.CylinderGeometry(radius*.49,radius*.49,width*.89,32)
  hubGeo.rotateZ(Math.PI/2)
  const hub=new THREE.Mesh(hubGeo,polished); hub.name='wheelHub'; group.add(hub)
  for (const side of [-1,1]) {
    const rim=new THREE.Mesh(new THREE.TorusGeometry(radius*.43,Math.min(radius*.028,width*.04),8,32),fanMetal)
    rim.rotation.y=Math.PI/2; rim.position.x=side*width*.45; group.add(rim)
  }
  return group
}
