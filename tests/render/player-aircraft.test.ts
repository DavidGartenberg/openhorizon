import * as THREE from 'three'
import { expect, it } from 'vitest'
import { PLAYER_AIRCRAFT, buildPlayerAircraft } from '../../src/render/player-aircraft'
import { ROSTER } from '../../src/sim/aircraft/roster'
import { updateProp } from '../../src/render/aircraft-mesh'
import { liveryMaterial } from '../../src/render/livery'

it('offers a player model for every selectable aircraft, with finite geometry', () => {
  expect(PLAYER_AIRCRAFT).toHaveLength(ROSTER.length + 3)
  for (const entry of PLAYER_AIRCRAFT) {
    const ship = buildPlayerAircraft(entry.key)
    expect(ship.group.userData.playerAircraft, entry.key).toBe(entry.key)
    const bounds = new THREE.Box3().setFromObject(ship.group)
    const size = bounds.getSize(new THREE.Vector3())
    expect(size.toArray().every(Number.isFinite), entry.key).toBe(true)
    expect(size.x, entry.key).toBeGreaterThan(entry.spanM * .9)
    expect(size.x, entry.key).toBeLessThan(entry.spanM * 1.15)
    expect(size.z, entry.key).toBeGreaterThan(entry.lengthM * .975)
    expect(size.z, entry.key).toBeLessThan(entry.lengthM * 1.025)
    ship.surfaces?.({ flapFrac: 1, spoilerFrac: 1, gearPos: 0, reverseFrac: 1 })
    const materials = new Set<THREE.Material>()
    ship.group.traverse(o => { if (o instanceof THREE.Mesh) {
      o.geometry.dispose()
      for(const m of Array.isArray(o.material)?o.material:[o.material]) materials.add(m)
    } })
    materials.forEach(m=>m.dispose())
  }
}, 60000) // Entire 123-aircraft fleet, including CPU model construction.

it('animates every propeller of a four-engine aircraft and leaves gliders without blur discs', () => {
  const ship = buildPlayerAircraft('C130')
  const discs=ship.group.userData.propDiscs as THREE.Mesh[]
  expect(discs).toHaveLength(4)
  const initial=discs.map(d=>(d.userData.blade as THREE.Mesh).rotation.z)
  updateProp(ship,1200,.1)
  discs.forEach((d,i)=>{
    expect(d.visible).toBe(true)
    expect((d.userData.blade as THREE.Mesh).rotation.z-initial[i]!).toBeCloseTo(Math.PI*4)
  })
  const glider=buildPlayerAircraft('AS21')
  updateProp(glider,0,.1)
  expect(glider.group.userData.propDiscs).toHaveLength(0)
})

it('retires uncached livery textures when their last material is disposed', () => {
  const material=liveryMaterial('C25A',9,.825)
  let disposed=0
  for(const map of [material.map,material.roughnessMap,material.bumpMap])map!.addEventListener('dispose',()=>disposed++)
  material.dispose();material.dispose()
  expect(disposed).toBe(3)
})

it('gives the Skyhawk its published overall length without moving the propeller datum', () => {
  const ship = buildPlayerAircraft('172')
  const bounds = new THREE.Box3().setFromObject(ship.group)
  expect(bounds.max.z - bounds.min.z).toBeCloseTo(8.28, 1)
  expect(ship.propDisc.position.toArray()).toEqual([0, .05, -2.32])
})
