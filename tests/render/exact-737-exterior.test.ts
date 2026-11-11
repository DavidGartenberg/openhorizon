import * as THREE from 'three'
import { describe, expect, it, vi } from 'vitest'
import { PLAYER_AIRCRAFT, buildPlayerAircraft } from '../../src/render/player-aircraft'
import { exactLocalModel, localModelFor, upgradePlayerAircraft, type LocalAircraftVisual } from '../../src/render/local-aircraft'
import { XP_MODELS } from '../../src/render/xplane-manifest'

/**
 * The player's 737-800 is the installed X-Plane 737-800: its own geometry and its own textures (paint, lit and normal maps),
 * drawn whole, not the procedural airplane with texture detail projected onto it. Nothing else in the exterior path may
 * route it away from that load (an earlier change sent every Boeing, this one included, to a texture-fit path and the
 * airplane came back looking procedural).
 */
describe('the 737-800 is drawn from the installed X-Plane model', () => {
  const visual = (): LocalAircraftVisual => {
    const group = new THREE.Group(), propDisc = new THREE.Mesh()
    group.add(propDisc)
    return { group, propDisc, surfaces: vi.fn(), updateProp: vi.fn(), dispose: vi.fn() }
  }

  it('is an exact match for the installed model, with its textures in the same folder', () => {
    expect(exactLocalModel('737')?.folder).toBe('Boeing 737-800')
    expect(localModelFor('737')).toMatchObject({ model: 'B738', exact: true, scale: 1 })
    expect(XP_MODELS.B738!.objs.some((o) => /738fuselage\.obj$/.test(o))).toBe(true)
  })

  it('requests that model, swaps the procedural body for it and ends as a local X-Plane exterior', async () => {
    expect(PLAYER_AIRCRAFT.some((e) => e.key === '737')).toBe(true)
    const ship = buildPlayerAircraft('737')
    const procedural = [...ship.group.children]
    const loaded = visual()
    const load = vi.fn(async () => loaded)
    await upgradePlayerAircraft(ship, '737', load)
    expect(load).toHaveBeenCalledTimes(1)
    expect(ship.group.userData.visualSource).toBe('local-xplane')
    expect(procedural.every((o) => o.parent !== ship.group)).toBe(true)   // moved under the exterior wrapper, then removed with the swap
    expect(procedural.every((o) => o.parent === null)).toBe(true)
    expect(loaded.group.parent).not.toBeNull()
    expect(ship.propDisc).toBe(loaded.propDisc)
  })

  it('keeps the procedural airplane when the install cannot be read (no X-Plane), and says so', async () => {
    const ship = buildPlayerAircraft('737')
    const body = ship.group.children[0]
    await upgradePlayerAircraft(ship, '737', async () => null)
    expect(ship.group.userData.visualSource).toBe('procedural')
    expect(body!.parent).not.toBeNull()
  })
})
