import {afterEach,describe,expect,it,vi} from 'vitest'
import * as THREE from 'three'
import {enhanceAirportWithOsm,osmIdentSegs} from '../src/world/osm-layout'
import {Airports,type AirportData} from '../src/world/airports'
import type {WorldFrame} from '../src/world/tiles'
vi.mock('../src/render/light-glow',()=>({lightGlowTexture:()=>null}))
const ap:AirportData={i:'TEST',n:'Test',la:0,lo:0,e:100,t:0,r:[{li:'18',hi:'36',la1:-.002,lo1:0,la2:.002,lo2:0,e1:100,e2:100,l:1400,w:50,s:1,lt:0}]}
afterEach(()=>{vi.unstubAllGlobals();osmIdentSegs.clear()})
describe('OSM partial data and lifecycle',()=>{
  it('creates short/soft facilities once and disposes/removes registry on eviction',()=>{
    vi.stubGlobal('fetch',()=>new Promise(()=>{}))
    const scene=new THREE.Scene(),airports=new Airports(scene,{toLocal:()=>({e:0,n:0})} as unknown as WorldFrame)
    airports.loaded=true;const near=vi.spyOn(airports,'near').mockReturnValue([ap]);airports.updateVisuals(0,0)
    expect(scene.getObjectByName('FBO')).toBeTruthy()
    expect(scene.getObjectByName('airportServices')).toBeTruthy()
    osmIdentSegs.set('TEST',[{ref:'A',x:1,z:1}]);near.mockReturnValue([]);airports.updateVisuals(1,1)
    expect(scene.children.length).toBe(0);expect(osmIdentSegs.has('TEST')).toBe(false)
  })
  it('retains facilities with taxiway-only OSM and replaces only pavement',async()=>{
    const group=new THREE.Group(),proc=new THREE.Group(),fac=new THREE.Group()
    proc.name='proceduralTaxi';fac.name='airportFacilities';group.add(proc,fac)
    vi.stubGlobal('fetch',async()=>({ok:true,json:async()=>({tw:[{r:'',p:[[0,.003],[.001,.003]]}],ap:[],tm:[],st:[]})}))
    await enhanceAirportWithOsm(group,'TEST',0,0,0)
    expect(group.getObjectByName('airportFacilities')).toBe(fac);expect(group.getObjectByName('proceduralTaxi')).toBeUndefined()
  })
  it('keeps taxiway fallback when only real terminal footprints exist',async()=>{
    const group=new THREE.Group(),proc=new THREE.Group();proc.name='proceduralTaxi';group.add(proc)
    vi.stubGlobal('fetch',async()=>({ok:true,json:async()=>({tm:[[[0,.003],[.001,.003],[.001,.004],[0,.004]]],ap:[],tw:[],st:[]})}))
    await enhanceAirportWithOsm(group,'TEST',0,0,0)
    expect(group.getObjectByName('proceduralTaxi')).toBe(proc)
    expect(group.getObjectByName('mappedTerminalFacade')).toBeTruthy()
  })
  it('retains a nonoverlapping taxi fallback with apron-only data',async()=>{
    const group=new THREE.Group(),proc=new THREE.Group();proc.name='proceduralTaxi'
    proc.add(new THREE.Mesh(new THREE.BoxGeometry(10,1,40),new THREE.MeshBasicMaterial()));group.add(proc)
    vi.stubGlobal('fetch',async()=>({ok:true,json:async()=>({ap:[[[0,.003],[.001,.003],[.001,.004],[0,.004]]],tm:[],tw:[],st:[]})}))
    await enhanceAirportWithOsm(group,'TEST',0,0,0)
    expect(group.getObjectByName('proceduralTaxi')).toBe(proc)
  })
  it('rebuilds apron-only airports with one mapped fleet and a separate building pad',async()=>{
    // Exercise the real Airports callback, not a standalone OSM placeholder.
    const polygon=[[200,-100],[400,-100],[400,100],[200,100]].map(([x,z])=>[-z!/111_320,x!/111_320])
    vi.stubGlobal('fetch',async()=>({ok:true,json:async()=>({ap:[polygon],tm:[],tw:[],st:[]})}))
    const scene=new THREE.Scene(),airports=new Airports(scene,{toLocal:()=>({e:0,n:0})} as unknown as WorldFrame)
    airports.loaded=true;vi.spyOn(airports,'near').mockReturnValue([ap]);airports.updateVisuals(0,0)
    await vi.waitFor(()=>expect(scene.getObjectByName('osmLayout')).toBeTruthy())
    const group=scene.children[0]!
    const fallback=group.children.find(o=>o.name==='airportFacilities')!
    const mapped=group.getObjectByName('mappedAirportServices')!.children[0]!
    expect(fallback.getObjectByName('FBO')).toBeTruthy()
    expect(fallback.getObjectByName('hangar')).toBeTruthy()
    expect(fallback.getObjectByName('airportServices')).toBeUndefined()
    const fleets:THREE.Object3D[]=[]
    group.traverse(o=>{if(o.name==='airportServices')fleets.push(o)})
    expect(fleets).toHaveLength(1)
    expect(fleets[0]!.parent).toBe(mapped)
    expect(fleets[0]!.children).toHaveLength(2)
    // No extra pavement overlay was generated under the mapped fleet.
    expect(mapped.children.some(o=>o instanceof THREE.Mesh)).toBe(false)
    group.updateMatrixWorld(true)
    const padBounds=new THREE.Box3().setFromObject(fallback)
    const overlapsMappedApron=padBounds.max.x>200&&padBounds.min.x<400&&padBounds.max.z>-100&&padBounds.min.z<100
    expect(overlapsMappedApron).toBe(false)
    // The fallback pad still supports its missing FBO/hangar, rather than
    // deleting the pad and leaving those buildings stranded on arbitrary ground.
    expect(fallback.children.some(o=>{
      if(!(o instanceof THREE.Mesh))return false
      o.geometry.computeBoundingBox()
      const size=o.geometry.boundingBox!.getSize(new THREE.Vector3())
      return size.x>=55&&size.z>=79&&size.y<1
    })).toBe(true)
    for(const vehicle of fleets[0]!.children){
      const p=vehicle.getWorldPosition(new THREE.Vector3())
      expect(p.x).toBeGreaterThan(200);expect(p.x).toBeLessThan(400)
      expect(p.z).toBeGreaterThan(-100);expect(p.z).toBeLessThan(100)
    }
  })
  it('ignores empty and malformed layouts without removing fallback',async()=>{
    for(const data of [null,{}, {tw:null}, {tw:[{p:[[NaN,2]]}],ap:['bad'],tm:[[[0,0]]]}]){
      const group=new THREE.Group(),proc=new THREE.Group();proc.name='proceduralTaxi';group.add(proc)
      vi.stubGlobal('fetch',async()=>({ok:true,json:async()=>data}))
      await expect(enhanceAirportWithOsm(group,'TEST',0,0,0)).resolves.toBeUndefined()
      expect(group.getObjectByName('proceduralTaxi')).toBe(proc)
    }
  })
  it('does not resurrect geometry or overwrite a new registry after an evicted fetch resolves',async()=>{
    let resolve!:(x:unknown)=>void
    vi.stubGlobal('fetch',()=>new Promise(r=>{resolve=r}))
    const group=new THREE.Group(),pending=enhanceAirportWithOsm(group,'TEST',0,0,0)
    group.userData.airportDisposed=true;osmIdentSegs.set('TEST',[{ref:'NEW',x:1,z:2}])
    resolve({ok:true,json:async()=>({tw:[{r:'OLD',p:[[0,.003],[.001,.003]]}],ap:[],tm:[],st:[]})})
    await pending;expect(group.children).toHaveLength(0);expect(osmIdentSegs.get('TEST')![0]!.ref).toBe('NEW')
  })
})
