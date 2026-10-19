import * as THREE from 'three'
import {describe,expect,it} from 'vitest'
import {makeSurfaceSmoother,stepSurface} from '../src/render/surface-smoother'
import {buildC172} from '../src/render/aircraft-mesh'
import {buildCub} from '../src/render/aircraft-mesh'
import {buildAirliner,airlinerCfgFor} from '../src/render/airliner-mesh'

const base = {flapFrac:0,spoilerFrac:0,gearPos:1}
/** World-space X (starboard) of the rudder skin's aftmost point. */
function trailingEdgeX(root: THREE.Object3D, name: RegExp): number {
  root.updateMatrixWorld(true)
  let best = -Infinity, x = 0
  root.traverse(o => {
    if (!(o instanceof THREE.Mesh) || !name.test(o.name)) return
    const pos = o.geometry.getAttribute('position'), v = new THREE.Vector3()
    for (let i = 0; i < pos.count; i++) { v.fromBufferAttribute(pos, i).applyMatrix4(o.matrixWorld); if (v.z > best) { best = v.z; x = v.x } }
  })
  return x
}
/** Settle the visual follower: it integrates on wall-clock time. */
async function settle(ship: ReturnType<typeof buildC172>, yaw: number): Promise<void> {
  ship.surfaces?.({...base,yaw})
}

describe('surface smoother', () => {
  it('moves toward the target without overshoot and respects the slew limit', () => {
    let v = 0
    for (let i = 0; i < 200; i++) { const n = stepSurface(v, 0.4, 1 / 60); expect(n).toBeGreaterThanOrEqual(v); expect(n - v).toBeLessThanOrEqual(1.1 / 60 + 1e-9); expect(n).toBeLessThanOrEqual(0.4 + 1e-9); v = n }
    expect(v).toBeCloseTo(0.4, 2)
  })
  it('snaps on first use and after a long gap, ignores NaN', () => {
    let t = 0
    const f = makeSurfaceSmoother(1.1, 0.08, () => t)
    expect(f(0.3)).toBe(0.3)
    t += 16; expect(f(-0.3)).toBeGreaterThan(0.3 - 0.03) // slewing, not snapping
    t += 5000; expect(f(0.2)).toBe(0.2)
    expect(f(Number.NaN)).toBeGreaterThanOrEqual(0 - 1e-9)
  })
})

describe('rudder direction (+yaw = right pedal = trailing edge right)', () => {
  it('C172 rudder swings the right way and returns to neutral', async () => {
    const ship = buildC172()
    await settle(ship, 0); const n = trailingEdgeX(ship.group, /Rudder/i)
    await settle(ship, 1); expect(trailingEdgeX(ship.group, /Rudder/i) - n).toBeGreaterThan(0.05)
    await settle(ship, -1); expect(trailingEdgeX(ship.group, /Rudder/i) - n).toBeLessThan(-0.05)
    await settle(ship, 0); expect(Math.abs(trailingEdgeX(ship.group, /Rudder/i) - n)).toBeLessThan(0.02)
  })
  it('Cub rudder agrees', async () => {
    const ship = buildCub()
    await settle(ship, 0); const n = trailingEdgeX(ship.group, /rudder/i)
    await settle(ship, 1); expect(trailingEdgeX(ship.group, /rudder/i) - n).toBeGreaterThan(0.05)
  })
  it('airliner fin carries a real hinged rudder with the same sense', async () => {
    const ship = buildAirliner(airlinerCfgFor({designator:'B738',lengthM:39.5,spanM:35.8,wingAreaM2:125,powerplant:{kind:'turbofan',count:2}}))
    await settle(ship, 0); const n = trailingEdgeX(ship.group, /^rudder$/)
    await settle(ship, 1); expect(trailingEdgeX(ship.group, /^rudder$/) - n).toBeGreaterThan(0.05)
    const rudder = ship.group.getObjectByName('rudder') as THREE.Mesh
    expect(rudder.geometry.getAttribute('uv').count).toBe(rudder.geometry.getAttribute('position').count)
  })
})
