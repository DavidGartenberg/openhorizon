import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import * as THREE from 'three'
import { TileManager, WorldFrame } from '../src/world/tiles'
import { tileXToLon, tileYToLat, metersPerDegree } from '../src/math/geo'

class WorkerStub { onmessage: unknown; postMessage = vi.fn(); terminate = vi.fn() }
const ring = (z: number) => ({ z, radiusM: 10000, grid: 2, skirt: 10, depthBiasM: 0 })
function setup() {
  const scene = new THREE.Scene(), frame = new WorldFrame({lat:37.5092,lon:-122.4959})
  const manager = new TileManager(scene, frame, () => [])
  manager.setImagery(false)
  const internal = manager as any
  function want(z: number, x: number, y: number) {
    internal.want(ring(z),x,y)
    return internal.tiles.get(`${z}/${x}/${y}`)
  }
  function ready(t: any, heights = [100,100,100,100]) {
    const e=t.sizeEastM/2,n=t.sizeNorthM/2
    internal.onTileBuilt({key:t.key,requestId:t.requestId,positions:new Float32Array([-e,heights[0]!,-n,e,heights[1]!,-n,-e,heights[2]!,n,e,heights[3]!,n]),normals:new Float32Array(12),colors:new Float32Array(12),uvs:new Float32Array([0,1,1,1,0,0,1,0]),urban:new Float32Array(4),indices:new Uint32Array([0,2,1,1,2,3]),heights:new Float32Array(heights),gridSize:2})
  }
  function visible(t: any, lat: number, lon: number) {
    return manager.isSurfaceVisible(t.mesh,lat,lon)
  }
  return {manager,internal,scene,frame,want,ready,visible}
}
beforeEach(()=>vi.stubGlobal('Worker',WorkerStub))
afterEach(()=>{vi.unstubAllGlobals();vi.restoreAllMocks()})

describe('READY terrain visibility',()=>{
  it('clips a higher coarse surface only after fine geometry is ready, and restores fallback on removal',()=>{
    const s=setup(), coarse=s.want(7,20,49), fine=s.want(13,1308,3174)
    s.ready(coarse); const lat=fine.latC,lon=fine.lonC
    expect(s.visible(coarse,lat,lon)).toBe(true)
    fine.state='failed'; expect(s.visible(coarse,lat,lon)).toBe(true)
    fine.state='loading'; s.ready(fine,[10,10,10,10])
    expect(s.visible(coarse,lat,lon)).toBe(false)
    expect(s.visible(fine,lat,lon)).toBe(true)
    // Exercise actual eviction: only the fine tile is stale.
    coarse.lastWanted=2;fine.lastWanted=0;s.internal.stamp=2
    for(let i=0;i<340;i++)s.internal.tiles.set(`dummy${i}`,{...coarse,key:`dummy${i}`,mesh:undefined,lastWanted:2})
    s.internal.evict(0,0)
    expect(s.internal.tiles.has(fine.key)).toBe(false)
    expect(s.visible(coarse,lat,lon)).toBe(true)
  })
  it('filters an actual 90m-high coarse ray hit above the loaded fine surface',()=>{
    const s=setup(), coarse=s.want(7,20,49), fine=s.want(13,1308,3174)
    s.ready(coarse);s.ready(fine,[10,10,10,10]);s.scene.updateMatrixWorld(true)
    const p=s.frame.toLocal(fine.latC,fine.lonC)
    const ray=new THREE.Raycaster(new THREE.Vector3(p.e,1000,-p.n),new THREE.Vector3(0,-1,0))
    const hits=ray.intersectObjects(s.scene.children)
    expect(hits[0]!.point.y).toBeCloseTo(100)
    const visible=hits.find(h=>s.manager.isSurfaceVisible(h.object,fine.latC,fine.lonC))
    expect(visible!.point.y).toBeCloseTo(s.manager.elevationAt(fine.latC,fine.lonC),5)
  })
  it('uses exact fine boundaries, preserving fallback ten centimeters outside all four edges',()=>{
    const s=setup(), coarse=s.want(7,20,49), fine=s.want(13,1308,3174)
    s.ready(coarse);s.ready(fine)
    const d=0.1/metersPerDegree(fine.latC).north
    for(const [lat,lon] of [[fine.latN+d,fine.lonC],[fine.latS-d,fine.lonC],[fine.latC,fine.lonW-d],[fine.latC,fine.lonE+d]])expect(s.visible(coarse,lat!,lon!)).toBe(true)
    for(const [lat,lon] of [[fine.latN-d,fine.lonC],[fine.latS+d,fine.lonC],[fine.latC,fine.lonW+d],[fine.latC,fine.lonE-d]])expect(s.visible(coarse,lat!,lon!)).toBe(false)
  })
  it('clips independently across multiple LODs and retains holes inside the ready envelope',()=>{
    const s=setup(), coarse=s.want(7,20,49), middle=s.want(11,327,793), fine=s.want(13,1308,3174)
    s.ready(coarse);s.ready(middle);s.ready(fine)
    expect(s.visible(coarse,fine.latC,fine.lonC)).toBe(false)
    expect(s.visible(middle,fine.latC,fine.lonC)).toBe(false)
    expect(s.visible(middle,tileYToLat(3172.5,13),tileXToLon(1308.5,13))).toBe(true)
    expect(s.visible(coarse,tileYToLat(3172.5,13),tileXToLon(1308.5,13))).toBe(false)
    expect(s.visible(coarse,tileYToLat(3178.5,13),tileXToLon(1308.5,13))).toBe(true)
  })
  it('places adjacent edges in the current frame, including a late response after rebase',()=>{
    const s=setup(), north=s.want(7,20,49), south=s.want(7,20,50)
    s.ready(north)
    s.frame.anchor={lat:45,lon:-123};s.manager.onRebase();s.ready(south)
    s.scene.updateMatrixWorld(true)
    for(const t of [north,south]) {
      const corner=new THREE.Vector3(-t.sizeEastM/2,100,-t.sizeNorthM/2).applyMatrix4(t.mesh.matrixWorld)
      const expected=s.frame.toLocal(t.latN,t.lonW)
      expect(corner.x).toBeCloseTo(expected.e,4);expect(corner.z).toBeCloseTo(-expected.n,4)
    }
  })
  it('samples the actual rendered diagonal rather than a bilinear saddle',()=>{
    const s=setup(), tile=s.want(13,1308,3174);s.ready(tile,[0,0,0,100])
    expect(s.manager.elevationAt(tile.latC,tile.lonC)).toBeCloseTo(0,6)
  })
  it('keeps requested coarse fallback in desired fine rings',()=>{
    const s=setup(), p=s.frame.toLocal(tileYToLat(49.5,7),tileXToLon(20.5,7));s.manager.update(p.n,p.e)
    const t=s.internal.tiles.get('7/20/49')
    expect(t).toBeDefined()
  })
  it('skips stale queued generations without occupying a slot or duplicating resources',()=>{
    const s=setup()
    const imagery=vi.spyOn(s.internal,'loadImageryTexture')
    for(let i=0;i<8;i++)s.want(13,1300+i,3174)
    const stale=s.want(13,1308,3174)
    s.internal.pump()
    const dispatches=()=>s.internal.workers.flatMap((worker:any)=>
      worker.postMessage.mock.calls.map(([request]:any[])=>({worker,request})))
      .sort((a:any,b:any)=>a.request.requestId-b.request.requestId)
    const initial=dispatches()
    expect(initial).toHaveLength(8)
    expect(s.internal.inFlight).toBe(8)
    expect(s.internal.queue).toEqual([stale])
    // Eviction invalidates the map entry, but its queued object still exists.
    s.internal.tiles.delete(stale.key)
    const replacement=s.want(13,1308,3174)
    const finish=({worker,request}:any)=>worker.onmessage({data:{
      key:request.key,requestId:request.requestId,
      positions:new Float32Array(12),normals:new Float32Array(12),colors:new Float32Array(12),
      uvs:new Float32Array(8),urban:new Float32Array(4),indices:new Uint32Array([0,2,1,1,2,3]),
      heights:new Float32Array(4),gridSize:2,
    }})
    finish(initial[0])
    const all=dispatches()
    expect(all).toHaveLength(9)
    expect(all[8].request.requestId).toBe(replacement.requestId)
    expect(all.some(({request}:any)=>request.requestId===stale.requestId)).toBe(false)
    expect(s.internal.queue).toHaveLength(0)
    expect(s.internal.inFlight).toBe(8)
    for(const dispatched of all.slice(1))finish(dispatched)
    expect(s.internal.inFlight).toBe(0)
    expect(dispatches()).toHaveLength(9)
    expect(s.manager.readyCount).toBe(9)
    expect(s.scene.children).toHaveLength(9)
    expect(new Set(s.scene.children.map(mesh=>mesh.userData.terrainKey)).size).toBe(9)
    expect(imagery).not.toHaveBeenCalled()
    expect(s.internal.imLoading).toBe(0)
    expect(s.internal.imQueue).toHaveLength(0)
    s.manager.dispose()
  })
  it('rejects an evicted request that arrives after the same key has been requested again',()=>{
    const s=setup(), old=s.want(13,1308,3174)
    s.internal.tiles.delete(old.key)
    const replacement=s.want(13,1308,3174)
    s.ready(old)
    expect(replacement.state).toBe('loading')
    expect(replacement.mesh).toBeUndefined()
    s.ready(replacement)
    expect(replacement.state).toBe('ready')
  })
  it('keeps the visibility predicate valid after rebasing with a pending finer tile',()=>{
    const s=setup(), coarse=s.want(7,20,49), fine=s.want(13,1308,3174)
    s.ready(coarse)
    s.frame.anchor={lat:38,lon:-123};s.manager.onRebase()
    expect(s.visible(coarse,fine.latC,fine.lonC)).toBe(true)
    s.ready(fine)
    expect(s.visible(coarse,fine.latC,fine.lonC)).toBe(false)
    s.frame.anchor={lat:39,lon:-124};s.manager.onRebase()
    expect(s.visible(coarse,fine.latC,fine.lonC)).toBe(false)
  })
  it('does not upload unrelated coverage textures when a fine tile becomes ready',()=>{
    const s=setup(), ancestor=s.want(7,20,49), unrelated=s.want(7,21,49),fine=s.want(13,1308,3174)
    s.ready(ancestor);s.ready(unrelated)
    const version=unrelated.coverageTexture.version
    s.ready(fine)
    expect(unrelated.coverageTexture.version).toBe(version)
  })
  it('compensates normals for nonuniform horizontal rebase scaling',()=>{
    const s=setup(), tile=s.want(7,20,49);s.ready(tile)
    s.frame.anchor={lat:50,lon:-123};s.manager.onRebase()
    const correction=tile.baseMat.uniforms.uNormalScale?.value as THREE.Vector2|undefined
    expect(correction?.x).toBeCloseTo(1/tile.mesh.scale.x**2,8)
    expect(correction?.y).toBeCloseTo(1/tile.mesh.scale.z**2,8)
  })
  it('disposes terrain geometry, coverage, materials and workers when inspection stops',()=>{
    const s=setup(), tile=s.want(7,20,49);s.ready(tile)
    const coverageDispose=vi.spyOn(tile.coverageTexture,'dispose')
    const materialDispose=vi.spyOn(tile.baseMat,'dispose')
    const geometryDispose=vi.spyOn(tile.mesh.geometry,'dispose')
    s.internal.dispose?.()
    expect(s.scene.children).toHaveLength(0)
    expect(coverageDispose).toHaveBeenCalledOnce()
    expect(materialDispose).toHaveBeenCalledOnce()
    expect(geometryDispose).toHaveBeenCalledOnce()
    for(const worker of s.internal.workers)expect(worker.terminate).toHaveBeenCalledOnce()
    expect(s.internal.tiles.size).toBe(0)
  })
  it('keeps tile coverage owned per material through imagery on/off',async()=>{
    const s=setup(), coarse=s.want(11,327,793), other=s.want(11,328,793),fine=s.want(13,1308,3174)
    s.ready(coarse);s.ready(other);s.ready(fine)
    expect(coarse.mesh.material).not.toBe(other.mesh.material)
    const coverage=coarse.mesh.material.uniforms.uCoverage
    expect(coverage).toBeDefined()
    s.internal.loadImageryTexture=async()=>new THREE.Texture()
    s.manager.setImagery(true);await Promise.resolve();await Promise.resolve()
    expect(coarse.mesh.material.uniforms.uCoverage).toBe(coverage)
    s.manager.setImagery(false)
    expect(coarse.mesh.material.uniforms.uCoverage).toBe(coverage)
    expect(s.visible(coarse,fine.latC,fine.lonC)).toBe(false)
  })
})
