import { describe, expect, it } from 'vitest'
import * as THREE from 'three'
import { ROSTER } from '../src/sim/aircraft/roster'
import { deriveParams } from '../src/sim/aircraft/derive'
import { buildPropAircraft } from '../src/render/prop-aircraft'
import { PROP_PROFILES } from '../src/render/prop-profiles'
const fleet = ROSTER.filter(r => r.spec.powerplant.kind !== 'jet')
describe('dedicated prop fleet models', () => {
  it('explicitly distinguishes signature configurations', () => {
    expect(PROP_PROFILES.C208!.wing).toBe('high')
    expect(PROP_PROFILES.B350!.wing).toBe('low')
    expect(PROP_PROFILES.BE35!.tail).toBe('v')
    expect(PROP_PROFILES.PA44!.tail).toBe('t')
    expect(PROP_PROFILES.P180!.pusher).toBe(true)
    expect(PROP_PROFILES.AN2!.biplane).toBe(true)
    expect(PROP_PROFILES.C177!.struts).toBe(false)
    expect(PROP_PROFILES.SR22!.canopy).toBe(false)
    expect(PROP_PROFILES.DA40!.canopy).toBe(true)
  })
  it('builds every nonjet with bounded finite outward geometry and calibrated contacts', () => {
    expect(fleet.length).toBeGreaterThan(50)
    for (const {spec,opts} of fleet) {
      expect(PROP_PROFILES[spec.designator], spec.designator).toBeTruthy()
      const params = deriveParams(spec,opts)
      const model = buildPropAircraft(spec,params)
      const fuselage = model.group.getObjectByName('fuselage') as THREE.Mesh
      expect(fuselage).toBeTruthy()
      // At the right-hand side of each cabin ring, normals must point out.
      const fn = fuselage.geometry.getAttribute('normal')
      for (let ring=15;ring<48;ring++) expect(fn.getX(ring*41),spec.designator).toBeGreaterThan(.15)
      expect(model.group.getObjectByName('cockpitGlazing')).toBeTruthy()
      if (spec.lengthM > 18) {
        const position = fuselage.geometry.getAttribute('position')
        // Transport cabins retain full section well behind the wing.
        expect(position.getX(50*41), spec.designator).toBeGreaterThan(PROP_PROFILES[spec.designator]!.width*.46)
        const cockpitBounds = new THREE.Box3().setFromObject(model.group.getObjectByName('cockpitGlazing')!)
        expect(cockpitBounds.max.z-cockpitBounds.min.z, spec.designator).toBeLessThan(spec.lengthM*.05)
        if(PROP_PROFILES[spec.designator]!.windows > 0) {
          const lastWindow = model.group.getObjectByName(`cabinWindow-0-${PROP_PROFILES[spec.designator]!.windows-1}`)!
          expect(new THREE.Box3().setFromObject(lastWindow).max.z, spec.designator).toBeGreaterThan(spec.lengthM*.30)
        }
      }
      const discs = model.group.userData.propDiscs as THREE.Mesh[]
      expect(discs.length).toBe(spec.powerplant.kind === 'none' ? 0 : spec.powerplant.count)
      for (const disc of discs) { expect(disc.castShadow).toBe(false); expect(disc.userData.blade.castShadow).toBe(false) }
      let meshes = 0, vertices = 0
      model.group.traverse(o => {
        if (!(o instanceof THREE.Mesh)) return
        meshes++
        const p = o.geometry.getAttribute('position'); vertices += p.count
        expect(Array.from(p.array).every(Number.isFinite),spec.designator).toBe(true)
        expect(Array.from(o.geometry.getAttribute('normal')?.array ?? []).every(Number.isFinite)).toBe(true)
      })
      expect(meshes,spec.designator).toBeLessThan(180)
      expect(vertices,spec.designator).toBeLessThan(100000)
      const box = new THREE.Box3().setFromObject(model.group)
      expect(box.max.x-box.min.x).toBeCloseTo(spec.spanM,0)
      expect(box.max.z-box.min.z).toBeLessThan(spec.lengthM * 1.12)
      for (const [key,leg] of Object.entries(params.gear)) {
        const contact = model.group.getObjectByName(`gearContact-${key}`)!
        expect(contact,spec.designator).toBeTruthy()
        const p = contact.getWorldPosition(new THREE.Vector3())
        expect(p.x).toBeCloseTo(leg.y,5);expect(p.y).toBeCloseTo(-leg.z,5);expect(p.z).toBeCloseTo(-leg.x,5)
        if(spec.powerplant.kind==='none') { expect(contact.visible).toBe(false); continue }
        const tireBounds = new THREE.Box3().setFromObject(model.group.getObjectByName(`wheel-${key}`)!)
        expect(tireBounds.min.y, spec.designator).toBeCloseTo(-leg.z,5)
        expect((tireBounds.min.x+tireBounds.max.x)/2).toBeCloseTo(leg.y,5)
        expect((tireBounds.min.z+tireBounds.max.z)/2).toBeCloseTo(-leg.x,5)
      }
      if(spec.powerplant.kind==='none'){
        const centerWheel=model.group.getObjectByName('gliderCenterWheel')!
        const bounds=new THREE.Box3().setFromObject(centerWheel)
        expect(bounds.min.y).toBeCloseTo(-params.gear.mainL.z,5)
        expect(centerWheel.position.x).toBe(0)
        expect(model.group.getObjectByName('gearStrut')).toBeUndefined()
        expect(model.group.userData.exteriorVerticalOffset).toBeLessThan(0)
      }
      const flap = model.group.getObjectByName('flap-left-hinge')
      model.surfaces!({flapFrac:1,spoilerFrac:1,gearPos:0})
      if(PROP_PROFILES[spec.designator]!.flapSystem!=='none' && spec.designator!=='DG80') {
        expect(flap,spec.designator).toBeTruthy()
        expect(flap!.userData.surfaceAngle,spec.designator).toBeGreaterThan(0)
      } else expect(flap,spec.designator).toBeUndefined()
      for (const key of spec.powerplant.kind==='none'?[]:Object.keys(params.gear)) expect(model.group.getObjectByName(`gear-${key}`)!.visible).toBe(!spec.gear.retractable)
      model.surfaces!({flapFrac:0,spoilerFrac:0,gearPos:1})
      if(flap) expect(flap.userData.surfaceAngle).toBe(0)
      for (const key of spec.powerplant.kind==='none'?[]:Object.keys(params.gear)) expect(model.group.getObjectByName(`gear-${key}`)!.visible).toBe(true)
      model.group.traverse(o => { if (o instanceof THREE.Mesh) o.geometry.dispose() })
    }
  }, 60000)
})
