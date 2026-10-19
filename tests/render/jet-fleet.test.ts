import * as THREE from 'three'
import { describe, expect, it } from 'vitest'
import { ROSTER } from '../../src/sim/aircraft/roster'
import { deriveParams } from '../../src/sim/aircraft/derive'
import { airlinerCfgFor, buildAirliner } from '../../src/render/airliner-mesh'
import { JET_PROFILES } from '../../src/render/jet-profiles'
import { buildJetShell } from '../../src/render/jet-shell'

const jets = ROSTER.filter(e => e.spec.powerplant.kind === 'jet')
describe('recognizable fleet jets',()=> {
  it.each(jets.map(e=>[e.spec.designator,e] as const))('%s has the proper topology, dimensions and live gear',(_id,e)=> {
    const {spec}=e
    expect(JET_PROFILES[spec.designator]).toBeDefined()
    const params=deriveParams(spec,e.opts)
    const cfg=airlinerCfgFor(spec,params.gear)
    const model=buildAirliner(cfg)
    const engines:THREE.Object3D[]=[], gears:THREE.Object3D[]=[], wheels:THREE.Object3D[]=[], sleeves:THREE.Object3D[]=[]
    model.group.traverse(o=> {if(o.userData.jetEngine) engines.push(o);if(o.name==='jetGear') gears.push(o);if(o.name==='aircraftWheel') wheels.push(o);if(o.name==='reverserSleeve') sleeves.push(o)})
    expect(engines.length).toBe(spec.powerplant.kind==='jet'?spec.powerplant.count:0)
    expect(sleeves.length).toBe(engines.length)
    expect(model.group.getObjectByName('continuousJetSkin')).toBeDefined()
    model.surfaces!({flapFrac:0,spoilerFrac:0,gearPos:1,reverseFrac:0})
    model.group.updateMatrixWorld(true)
    for(const wheel of wheels)expect(new THREE.Box3().setFromObject(wheel).min.y).toBeCloseTo(-wheel.parent!.userData.contact.z,4)
    for(const [name,contact] of Object.entries(params.gear)) {
      const leg=cfg.gear.find(l=>name==='nose'?l.nose:!l.nose&&l.y===contact.y)!
      expect([leg.x,leg.y,leg.z]).toEqual([contact.x,contact.y,contact.z])
    }
    if(cfg.engines.mounted==='tail') for(const engine of engines)expect(engine.position.z).toBeGreaterThan(spec.lengthM*.2)
    if(cfg.engines.mounted==='overwing')for(const engine of engines)expect(engine.position.y).toBeGreaterThan(0)
    const bounds=new THREE.Box3().setFromObject(model.group)
    expect(bounds.max.z-bounds.min.z).toBeLessThanOrEqual(spec.lengthM*1.025)
    expect(bounds.max.x-bounds.min.x).toBeGreaterThan(spec.spanM*.94)
    expect(bounds.max.x-bounds.min.x).toBeLessThan(spec.spanM*1.04)
    model.surfaces!({flapFrac:1,spoilerFrac:1,gearPos:0,reverseFrac:1})
    for(const gear of gears)expect(gear.visible).toBe(false)
    for(const sleeve of sleeves)expect(sleeve.position.z).toBeCloseTo(.85)
    model.group.traverse(o=> {if(o instanceof THREE.Mesh){const pos=o.geometry.getAttribute('position');expect(Array.from(pos.array).every(Number.isFinite)).toBe(true)}})
  })
  it('bounds cockpit pane height on both decks and limits shell draw calls',()=> {
    for(const id of ['C25A','B739','B744','A388']) {
      const e=jets.find(e=>e.spec.designator===id)!,p=JET_PROFILES[id]!
      const shell=buildJetShell(e.spec.lengthM,p.diameter/2,new THREE.MeshBasicMaterial(),id,p.hump)
      const panes=shell.children.filter(o=>o.name==='cockpitGlazing')
      expect(panes).toHaveLength(6)
      for(const pane of panes){const box=new THREE.Box3().setFromObject(pane);expect(box.max.y-box.min.y).toBeLessThan(.73)}
      const skin=shell.getObjectByName('continuousJetSkin') as THREE.Mesh
      expect(skin.geometry.groups).toHaveLength(0)
      expect(Array.isArray(skin.material)).toBe(false)
      expect(shell.children.filter(o=>o.name==='upperDeckWindow').length).toBeLessThanOrEqual(1)
      if(id==='C25A')expect(shell.userData.noseLength).toBeGreaterThan(p.diameter*1.5)
    }
    for(const id of ['FA7X','F2TH','C56X','C680','C68A'])expect(JET_PROFILES[id]!.stabilizerHeight).toBeGreaterThan(.4)
  })
  it('keeps family cabin width independent of stretch length',()=> {
    for(const ids of [['A318','A321'],['B736','B739'],['B762','B764'],['B788','B78X']])expect(JET_PROFILES[ids[0]!]!.diameter).toBe(JET_PROFILES[ids[1]!]!.diameter)
    expect(JET_PROFILES.C25A!.diameter).toBeLessThan(1.8)
    expect(JET_PROFILES.FA7X!.mount).toBe('tail')
  })
  it('has outward-facing, fair closed shells and upper decks within exact length',()=> {
    for(const id of ['A320','B744','B742','A388']) {
      const e=jets.find(e=>e.spec.designator===id)!,p=JET_PROFILES[id]!
      const shell=buildJetShell(e.spec.lengthM,p.diameter/2,new THREE.MeshBasicMaterial(),undefined,p.hump)
      shell.updateMatrixWorld(true)
      const box=new THREE.Box3().setFromObject(shell)
      expect(box.min.z).toBeCloseTo(-e.spec.lengthM/2,4);expect(box.max.z).toBeCloseTo(e.spec.lengthM/2,4)
      const hits=new THREE.Raycaster(new THREE.Vector3(20,p.diameter*.16,0),new THREE.Vector3(-1,0,0)).intersectObject(shell)
      expect(hits.length).toBeGreaterThan(0);expect(hits[0]!.point.x).toBeCloseTo(p.diameter/2,2)
    }
  })
})
