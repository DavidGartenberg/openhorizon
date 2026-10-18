import {existsSync,readFileSync} from 'node:fs'
import * as THREE from 'three'
import {DDSLoader} from 'three/examples/jsm/loaders/DDSLoader.js'
import {afterEach,expect,it,vi} from 'vitest'
import {loadLocalAircraft} from '../../src/render/local-aircraft'
import {PLAYER_AIRCRAFT} from '../../src/render/player-aircraft'
import {XP_MODELS,XP_PLACEMENT} from '../../src/render/xplane-manifest'
const base='/Users/davidgartenberg/X-Plane 12/Aircraft/Laminar Research/'
afterEach(()=>{vi.restoreAllMocks();vi.unstubAllGlobals()})
it.skipIf(!existsSync(base))('loads every exact selectable installed exterior at native scale with clean transforms',async()=>{
 vi.stubGlobal('fetch',async(url:string)=> url==='/xp/manifest.json' ? {ok:true,json:async()=>({available:true})} : {ok:existsSync(base+decodeURIComponent(url.slice('/xp/aircraft/'.length))),text:async()=>readFileSync(base+decodeURIComponent(url.slice('/xp/aircraft/'.length)),'utf8')})
 const texture = async(url:string)=>{
  const path=base+decodeURIComponent(url.slice('/xp/aircraft/'.length))
  if(!existsSync(path))throw new Error('missing')
  return new THREE.Texture()
 }
 vi.spyOn(THREE.TextureLoader.prototype,'loadAsync').mockImplementation(texture)
 vi.spyOn(DDSLoader.prototype,'loadAsync').mockImplementation(texture as never)
 for(const entry of PLAYER_AIRCRAFT){
  const modelKey=entry.key==='172'?'C172':entry.key==='737'?'B738':entry.key
  if(!XP_MODELS[modelKey])continue
  const visual=(await loadLocalAircraft(entry.key))!
  expect(visual,entry.key).not.toBeNull()
  expect(visual.group.scale.toArray()).toEqual([1,1,1])
  const evidence=visual.group.userData.assetEvidence
  expect(evidence.triangles,entry.key).toBeGreaterThan(10000)
  expect(evidence.warnings.filter((s:string)=>/malformed|ANIM_(?:rotate|trans) outside|left open/.test(s)),entry.key).toEqual([])
  const box=new THREE.Box3().setFromObject(visual.group),size=box.getSize(new THREE.Vector3())
  expect(size.x,entry.key).toBeGreaterThan(entry.spanM*.85)
  expect(size.x,entry.key).toBeLessThan(entry.spanM*1.15)
  expect(size.z,entry.key).toBeGreaterThan(entry.lengthM*.85)
  expect(size.z,entry.key).toBeLessThan(entry.lengthM*1.15)
  expect(Math.abs(box.getCenter(new THREE.Vector3()).z),entry.key).toBeLessThan(entry.lengthM*.4)
  console.log(entry.key,JSON.stringify({size:size.toArray(),position:visual.group.position.toArray(),...evidence,warnings:undefined}))
  visual.surfaces({flapFrac:1,gearPos:0,spoilerFrac:1,roll:.5,reverseFrac:1});visual.updateProp(1200,.1)
  visual.dispose();visual.dispose()
  expect(XP_PLACEMENT[modelKey]).toBeDefined()
 }
},120000)
