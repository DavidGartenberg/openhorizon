import {existsSync,readFileSync} from 'node:fs'
import {describe,expect,it} from 'vitest'
import type {SurfaceState} from '../../src/render/aircraft-mesh'
import {interfacePosition,socketClearance,type DrawComponent} from './native-interface-geometry'
import {nativeBase,nativeInterfaceScene} from './native-interface-scenes'

interface Witness {
 source:string
 sourceVertex:number
 partner:string
 partnerTriangle:number[]
 positions:number[]|number[][]
 maximum:number
 end:string
 toleranceM:number
}
interface Socket {
 source:string
 sourceVertex:number
 partner:string
 end:string
 clearance:number[][]
 toleranceM:number
}
const fixture=JSON.parse(readFileSync('tests/fixtures/native-surface-interfaces.json','utf8')) as {
 states:SurfaceState[]
 models:Array<{key:string;interfaces:Witness[];sockets:Socket[]}>
}
function registrationError(witness:Witness,components:Map<string,DrawComponent>,state:number):number {
 const source=components.get(witness.source)!,partner=components.get(witness.partner)!
 expect(source,`${witness.source} source component`).toBeDefined()
 expect(partner,`${witness.partner} partner component`).toBeDefined()
 expect(source.vertices).toContain(witness.sourceVertex)
 expect(partner.triangles).toContainEqual(witness.partnerTriangle)
 const measured=interfacePosition(source,witness.sourceVertex,partner,witness.partnerTriangle)
 const expected=Array.isArray(witness.positions[0])?witness.positions[state] as number[]:witness.positions as number[]
 return Math.max(...measured.map((v,i)=>Math.abs(v-expected[i]!)))
}

describe.skipIf(!existsSync(nativeBase))('identified original local attachment interfaces',()=>{
 for(const model of fixture.models)it(`${model.key}: local hinge/support partners and embedded sockets through travel`,()=>{
  const scene=nativeInterfaceScene(model.key)
  const components=new Map(scene.components.map(c=>[c.id,c]))
  try {
   expect(model.interfaces.length).toBeGreaterThan(0)
   fixture.states.forEach((state,index)=>{
    scene.pose(state)
    for(const witness of model.interfaces){
     expect(registrationError(witness,components,index),`${witness.source} ${witness.end} → ${witness.partner}, pose ${index}`).toBeLessThanOrEqual(witness.toleranceM)
    }
    for(const socket of model.sockets){
     const source=components.get(socket.source)!,partner=components.get(socket.partner)!
     expect(source.vertices).toContain(socket.sourceVertex)
     const clearance=socketClearance(source,socket.sourceVertex,partner)
     // Each selected tip stays between the *identified partner's* drawn
     // upper/lower skins, not anywhere inside a broad aircraft bounding box.
     expect(clearance.every(Number.isFinite),`${socket.source} embedded ${socket.end}, pose ${index}`).toBe(true)
     clearance.forEach((distance,side)=>{
      expect(distance).toBeGreaterThanOrEqual(0)
      expect(Math.abs(distance-socket.clearance[index]![side]!)).toBeLessThanOrEqual(socket.toleranceM)
     })
    }
   })
   if(process.env.NATIVE_SURFACE_DIAGNOSTICS==='1')console.log(`${model.key}: ${model.interfaces.length} identified interfaces, ${model.sockets.length} embedded tips`)
  } finally {scene.dispose()}
 },120000)

 it('rejects a detached flap panel while another component under the same dataref remains attached',()=>{
  const model=fixture.models.find(m=>m.key==='C172')!,scene=nativeInterfaceScene('C172')
  const components=new Map(scene.components.map(c=>[c.id,c]))
  const panel=scene.components.find(c=>c.id.endsWith('wings.obj|24930|6902'))!
  const panelWitnesses=model.interfaces.filter(i=>i.source===panel.id)
  const attachedRod=model.interfaces.filter(i=>i.source.endsWith('wings.obj|25260|7048'))
  expect(panelWitnesses.length).toBeGreaterThan(0)
  expect(attachedRod).toHaveLength(2)
  scene.pose(fixture.states[2]!) // half deployed
  for(const witness of [...panelWitnesses,...attachedRod])expect(registrationError(witness,components,2)).toBeLessThanOrEqual(witness.toleranceM)
  const original=panel.mesh.geometry
  try {
   // Actual mesh mutation: detach only the connected panel island. Other
   // pieces sharing this draw/animation remain unchanged and attached.
   const geometry=original.clone()
   const position=original.attributes.position!.clone()
   geometry.setAttribute('position',position);panel.mesh.geometry=geometry
   for(const vertex of panel.vertices)position.setY(vertex,position.getY(vertex)+.5)
   position.needsUpdate=true
   const errors=panelWitnesses.map(w=>registrationError(w,components,2))
   expect(errors.some(error=>error>.1)).toBe(true)
   for(const witness of attachedRod)expect(registrationError(witness,components,2)).toBeLessThanOrEqual(witness.toleranceM)
   geometry.dispose()
  } finally {panel.mesh.geometry=original;scene.dispose()}
 })
})
