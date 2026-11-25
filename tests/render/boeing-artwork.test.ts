import * as THREE from 'three'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { ROSTER } from '../../src/sim/aircraft/roster'
import { PLAYER_AIRCRAFT, buildPlayerAircraft } from '../../src/render/player-aircraft'
import { exactLocalModel, upgradePlayerAircraft, type LocalAircraftVisual } from '../../src/render/local-aircraft'
import { isBoeingPlayer, upgradeBoeingArtwork, type BoeingArtworkPack } from '../../src/render/boeing-artwork'
import { bakeBoeingArtwork, decodeDdsPixel, rasterizeArtwork, type ArtworkTriangle, type BoeingSurface } from '../../src/render/boeing-artwork-projector'
import { parseObj8 } from '../../src/render/xplane-obj8'

describe('Boeing artwork preserves the actual player airplane', () => {
  it('recognizes every Boeing and no other selectable family', () => {
    const keys = new Set(['737', ...ROSTER.filter(r => r.spec.label.startsWith('Boeing ')).map(r => r.spec.designator)])
    for (const entry of PLAYER_AIRCRAFT) expect(isBoeingPlayer(entry.key), entry.key).toBe(keys.has(entry.key))
  })

  it('never requests a replacement exterior for a Boeing variant: each keeps its own geometry (only the installed 737-800 is drawn whole)', async () => {
    for (const entry of PLAYER_AIRCRAFT.filter(e => isBoeingPlayer(e.key) && !exactLocalModel(e.key))) {
      const ship = buildPlayerAircraft(entry.key)
      const children = [...ship.group.children], prop = ship.propDisc, surfaces = ship.surfaces, spin = ship.updateProp
      const geometry: THREE.BufferGeometry[] = []
      ship.group.traverse(o => { if (o instanceof THREE.Mesh) geometry.push(o.geometry) })
      const load = vi.fn(async () => null)
      await upgradePlayerAircraft(ship, entry.key, load)
      expect(load).not.toHaveBeenCalled()
      expect(ship.group.children).toEqual(children)
      expect(ship.propDisc).toBe(prop); expect(ship.surfaces).toBe(surfaces); expect(ship.updateProp).toBe(spin)
      const after: THREE.BufferGeometry[] = []
      ship.group.traverse(o => { if (o instanceof THREE.Mesh) after.push(o.geometry) })
      expect(after).toEqual(geometry)
      expect(ship.group.userData.visualSource).not.toBe('local-xplane')
    }
  })

  it.each(['737', 'B738'])('draws the installed 737-800 itself for %s, with its own textures, not the fitted procedural airplane', async key => {
    if (!PLAYER_AIRCRAFT.some(e => e.key === key)) return
    expect(exactLocalModel(key)?.folder).toBe('Boeing 737-800')
    const ship = buildPlayerAircraft(key)
    const original = [...ship.group.children]
    const group = new THREE.Group(), propDisc = new THREE.Mesh()
    group.add(propDisc)
    const visual: LocalAircraftVisual = { group, propDisc, surfaces: vi.fn(), updateProp: vi.fn(), dispose: vi.fn() }
    const load = vi.fn(async () => visual)
    await upgradePlayerAircraft(ship, key, load)
    expect(load).toHaveBeenCalledTimes(1)
    expect(ship.group.userData.visualSource).toBe('local-xplane')
    expect(ship.group.userData.boeingArtworkStarted).toBeUndefined()
    expect(original.every(o => o.parent !== ship.group)).toBe(true)    // the procedural body is swapped out for the model
    expect(ship.propDisc).toBe(propDisc)
  })

  it.each(['737','B744','B77W'])('replaces old surface maps with fitted X-Plane paint on %s while retaining geometry, engine count and animation', async key => {
    const ship = buildPlayerAircraft(key)
    const shell = ship.group.getObjectByName('continuousJetSkin') as THREE.Mesh
    const uv = shell.geometry.getAttribute('uv'), positions = shell.geometry.getAttribute('position')
    const s = ship.surfaces, prop = ship.propDisc
    const color = new THREE.DataTexture(new Uint8Array(32*32*4).fill(180),32,32)
    const kinds = ['body','wing','flap','spoiler','fin','stabilizer','engine','sleeve','winglet','tire'] as const
    const pack: BoeingArtworkPack = { charts: Object.fromEntries(kinds.map(kind=>[kind,{color,finish:null,slots:1}])), evidence: { donor: 'B738', charts: [...kinds], pixels: 1024 } }
    const engines:THREE.Object3D[]=[]; const tagged:THREE.Mesh[]=[]
    ship.group.traverse(o=>{if(o.name==='turbofan')engines.push(o);if(o instanceof THREE.Mesh&&o.userData.boeingSurface)tagged.push(o)})
    expect(engines).toHaveLength(key==='B744'?4:2)
    const bounds = new THREE.Box3().setFromObject(ship.group)
    const originalMaterial=shell.material as THREE.MeshStandardMaterial
    expect(originalMaterial.map).not.toBeNull()
    expect(originalMaterial.roughnessMap).not.toBeNull()
    expect(originalMaterial.bumpMap).not.toBeNull()
    await upgradeBoeingArtwork(ship, key, async () => pack)
    expect(shell.geometry.getAttribute('uv')).toBe(uv)
    expect(shell.geometry.getAttribute('position')).toBe(positions)
    expect(shell.geometry.getAttribute('boeingUv')).toBeDefined()
    expect((shell.material as THREE.MeshStandardMaterial).map).toBeNull()
    expect((shell.material as THREE.MeshStandardMaterial).roughnessMap).toBeNull()
    expect((shell.material as THREE.MeshStandardMaterial).bumpMap).toBeNull()
    expect(tagged.every(o=>{
      const m=o.material as THREE.MeshStandardMaterial
      return !m.map&&!m.roughnessMap&&!m.bumpMap
    })).toBe(true)
    expect(new THREE.Box3().setFromObject(ship.group)).toEqual(bounds)
    expect(tagged.length).toBeGreaterThan(18)
    expect(tagged.every(o=>!!o.geometry.getAttribute('boeingUv'))).toBe(true)
    expect(ship.surfaces).toBe(s); expect(ship.propDisc).toBe(prop)
    expect(ship.group.userData.visualSource).toBe('procedural-xplane-artwork')
    expect((shell.material as THREE.Material).userData.boeingArtwork).toMatchObject({ donor: 'B738', surface: 'body' })
    expect(ship.group.userData.assetEvidence.donor).toBe('B738')
    console.info(`${key} applied donor surfaces: ${JSON.stringify(ship.group.userData.assetEvidence.applied)}`)
    const flap=tagged.find(o=>o.userData.boeingSurface.kind==='flap')!,previous=flap.getWorldPosition(new THREE.Vector3())
    ship.surfaces!({flapFrac:1,spoilerFrac:1,gearPos:0,reverseFrac:1,yaw:.4})
    expect(flap.getWorldPosition(new THREE.Vector3()).distanceTo(previous)).toBeGreaterThan(.1)
    expect(engines.every(o=>o.getObjectByName('reverserSleeve')!.position.z>.1)).toBe(true)
  })
})

const installedRoot=join(process.env.XPLANE_DIR??'/Users/davidgartenberg/X-Plane 12/Aircraft/Laminar Research','Boeing 737-800','objects')
const installed: Array<[string,string,BoeingSurface[],number[]]> = [
  ['738fuselage.obj','738fuselage.dds',['body'],[.75]],
  ['738wings.obj','738wing.dds',['wing','flap','spoiler'],[.55,.4,.3]],
  ['738tailwinglets.obj','738tail.dds',['fin','stabilizer','winglet'],[.5,.45,.25]],
  ['738cfm56L.obj','738cfm56.dds',['engine','sleeve'],[.4,.4]],
  ['738maingear.obj','738gear.dds',['tire'],[.4]],
]
it.skipIf(!installed.every(([obj,dds])=>existsSync(join(installedRoot,obj))&&existsSync(join(installedRoot,dds))))('projects all ten artwork components from the installed OBJ/DDS source with substantial mapped coverage',()=>{
  for(const [obj,dds,kinds,minimum] of installed){
    const parsed=parseObj8(readFileSync(join(installedRoot,obj),'utf8'))
    const sample=decodeDdsPixel(Uint8Array.from(readFileSync(join(installedRoot,dds))).buffer)
    for(const [i,kind] of kinds.entries()){
      const atlas=bakeBoeingArtwork(parsed,kind,sample,null,[80,128])
      console.info(`${kind}: ${Math.round(atlas.coverage*100)}%`)
      expect(atlas.coverage,kind).toBeGreaterThan(minimum[i]!)
      expect(atlas.color.some((v,i)=>i%4!==3&&v>0)).toBe(true)
    }
  }
},15_000)

describe('authored texture projection', () => {
  const tri = (p: number[][]): ArtworkTriangle => ({ chart: p as ArtworkTriangle['chart'], uv: [[0,0],[1,0],[0,1]], depth: [1,1,1] })
  it('rasterizes donor UVs barycentrically instead of assigning an unrelated atlas to the target UVs', () => {
    const pixels = rasterizeArtwork([tri([[0,0],[1,0],[0,1]])], 16, 16, (u,v) => [Math.round(u*255),Math.round(v*255),80,255])
    const sample = (x:number,y:number) => Array.from(pixels.slice((y*16+x)*4,(y*16+x)*4+4))
    expect(sample(3,3)[0]).toBeGreaterThan(40)
    expect(sample(3,3)[1]).toBeGreaterThan(40)
    expect(sample(3,3)[3]).toBe(255)
    expect(sample(15,15)[3]).toBe(0)
  })
  it('keeps the outermost surface when projection overlaps', () => {
    const t=tri([[0,0],[1,0],[0,1]])
    const far={...t,depth:[0,0,0] as [number,number,number],uv:[[.2,.2],[.2,.2],[.2,.2]] as ArtworkTriangle['uv']}
    const near={...t,depth:[2,2,2] as [number,number,number],uv:[[.8,.8],[.8,.8],[.8,.8]] as ArtworkTriangle['uv']}
    const pixels=rasterizeArtwork([near,far],8,8,(u)=>[Math.round(u*255),0,0,255])
    expect(pixels[(1*8+1)*4]).toBe(204)
  })
  it('decodes DDS block colors and rejects malformed/truncated files', () => {
    const buffer=new ArrayBuffer(136),d=new DataView(buffer)
    d.setUint32(0,0x20534444,true);d.setUint32(4,124,true);d.setUint32(12,4,true);d.setUint32(16,4,true)
    d.setUint32(84,0x31545844,true);d.setUint16(128,0xf800,true);d.setUint16(130,0x07e0,true)
    expect(decodeDdsPixel(buffer)(0,0)).toEqual([255,0,0,255])
    expect(()=>decodeDdsPixel(buffer.slice(0,130))).toThrow()
    expect(()=>decodeDdsPixel(new ArrayBuffer(128))).toThrow()
  })
})
