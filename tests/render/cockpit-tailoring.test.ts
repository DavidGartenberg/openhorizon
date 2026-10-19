import * as THREE from 'three'
import { beforeAll, describe, expect, it } from 'vitest'
import { installCanvasStub } from './canvas-stub'
import { animate737, build737Deck, DEFAULT_DECK_STYLE, type Deck737Controls, type DeckStyle } from '../../src/render/cockpit-737'
import { deckLayout, duGlass, MIP } from '../../src/render/cockpit-737-paint'
import { buildCockpit, updateCockpitControls } from '../../src/render/cockpit'
import { cockpitProfile } from '../../src/render/cockpit-profile'
import { EYE_BY_LAYOUT } from '../../src/render/cockpit-camera'
import { ROSTER, rosterParams } from '../../src/sim/aircraft/roster'
import { C172S } from '../../src/sim/aircraft/c172s'
import { J3CUB } from '../../src/sim/aircraft/j3cub'

const DET = [0, 1, 2, 5, 10, 15, 25, 30, 40]
const tex = (): THREE.Texture => new THREE.Texture()
const screens = () => ({ pfd: tex(), nd: tex(), eicas: tex(), isfd: tex() })
const rest: Deck737Controls = { pitch: 0, roll: 0, yaw: 0, throttle: 0, reverse: 0, flapsDeg: 0, speedbrake: 0, speedbrakeArmed: false, trim: 0, gearDown: true, parkingBrake: false, enginesRunning: [true, true] }
const deck = (over: Partial<DeckStyle>, engines = 2) => { const g = new THREE.Group(); return { g, d: build737Deck(g, screens(), DET, engines, { ...DEFAULT_DECK_STYLE, ...over }) } }
const profileOf = (d: string) => { const e = ROSTER.find(r => r.spec.designator === d)!; return cockpitProfile(d, rosterParams(d)!, { label: e.spec.label, powerplant: e.spec.powerplant as { kind: string; count?: number } }) }

beforeAll(() => installCanvasStub())

describe('display layouts fit the panel', () => {
  it.each(['six', 'fourWide', 'fiveWide', 'threeWide'] as const)('%s: displays inside the panel, apart, below the hood, ISFD and gear panel clear of them', name => {
    const L = deckLayout(name)
    const rects = L.dus.map(s => ({ x0: s.lat - s.w / 2, x1: s.lat + s.w / 2, y0: s.up - s.h / 2, y1: s.up + s.h / 2 }))
    for (const r of rects) { expect(r.x0).toBeGreaterThan(MIP.left); expect(r.x1).toBeLessThan(MIP.right); expect(r.y1).toBeLessThan(0.812) }
    const overlap = (a: typeof rects[0], b: typeof rects[0]) => a.x0 < b.x1 && b.x0 < a.x1 && a.y0 < b.y1 && b.y0 < a.y1
    for (let i = 0; i < rects.length; i++) for (let j = i + 1; j < rects.length; j++) expect(overlap(rects[i]!, rects[j]!), `${i}/${j}`).toBe(false)
    const isfd = { x0: L.isfd.lat - L.isfd.size / 2 - 0.01, x1: L.isfd.lat + L.isfd.size / 2 + 0.01, y0: L.isfd.up - L.isfd.size / 2, y1: L.isfd.up + L.isfd.size / 2 }
    const gear = { x0: L.gear.lat - 0.065 * L.gear.scale, x1: L.gear.lat + 0.065 * L.gear.scale, y0: L.gear.up - 0.115 * L.gear.scale, y1: L.gear.up + 0.115 * L.gear.scale }
    for (const r of rects) { expect(overlap(isfd, r)).toBe(false); expect(overlap(gear, r)).toBe(false) }
    expect(overlap(isfd, gear)).toBe(false)
    expect(L.dus.filter(d => d.kind === 'pfd')).toHaveLength(2)
    for (const s of L.dus) expect(duGlass(s).w).toBeGreaterThan(0.1)
  })
  it('every built deck puts a live screen on each display (lower DU blank)', () => {
    for (const name of ['six', 'fourWide', 'fiveWide', 'threeWide'] as const) {
      const { g } = deck({ layout: deckLayout(name) })
      const screensBuilt = g.children.filter(o => o instanceof THREE.Mesh && (o.material as THREE.MeshBasicMaterial).map instanceof THREE.Texture && !(o.material as THREE.MeshBasicMaterial).map!.image)
      const expected = deckLayout(name).dus.filter(d => d.kind !== 'lower').length + 1 // + ISFD
      expect(screensBuilt.length, name).toBe(expected)
    }
  })
})

describe('family hardware', () => {
  it('sidestick decks have no control columns; the sticks tilt with pitch and roll', () => {
    const { g, d } = deck({ control: 'sidestick', panel: 'airbus', maker: 'airbus' })
    expect(d.rig.capt.pivot.userData.sidestick).toBe(true)
    g.updateMatrixWorld(true)
    const p0 = d.rig.capt.pivot.position.clone()
    expect(Math.abs(p0.x)).toBeGreaterThan(0.65) // on the outboard console
    animate737(d, { ...rest, pitch: 1, roll: 1 })
    expect(d.rig.capt.pivot.rotation.x).toBeGreaterThan(0.2)
    expect(d.rig.capt.pivot.rotation.z).toBeLessThan(-0.2)
  })
  it('no trim wheels where trim is electric; no piggyback reversers on Airbus / turboprops', () => {
    expect(deck({ trimWheels: false }).d.rig.trimWheels).toHaveLength(0)
    expect(deck({}).d.rig.trimWheels).toHaveLength(2)
    expect(deck({ reversers: false }).d.rig.reversers).toHaveLength(0)
    const tp = deck({ turboprop: true, reversers: false, autothrottle: false, panel: 'generic' }, 4).d
    expect(tp.rig.thrust).toHaveLength(4); expect(tp.rig.reversers).toHaveLength(0)
    expect(tp.interactive.some(o => o.userData.controlId === 'engStart')).toBe(true)
    expect(tp.interactive.some(o => o.userData.controlId === 'atDisconnect')).toBe(false)
    expect(tp.interactive.some(o => o.userData.controlId === 'mcpAtArm')).toBe(false)
  })
  it('a business-jet cabin is scaled down and its scaled eye keeps the same clear view over the glareshield', () => {
    const prof = profileOf('C25C')
    const parent = new THREE.Group()
    const meshes = buildCockpit(parent, prof, rosterParams('C25C')!.flapDetentsDeg, { speedbrake: true })
    const inner = meshes.group.children.find(o => o instanceof THREE.Group && o.scale.x < 1)!
    expect(inner.scale.x).toBeCloseTo(prof.deck!.scale)
    const e = EYE_BY_LAYOUT.boeing737, k = prof.deck!.scale
    const origin = new THREE.Vector3(e.y * k, e.up * k, -e.x * k)
    const opaque: THREE.Object3D[] = []
    parent.updateMatrixWorld(true)
    meshes.group.traverse(o => { if (o instanceof THREE.Mesh && o.visible && !(o.material as THREE.Material).transparent && (o.material as THREE.MeshBasicMaterial).visible !== false) opaque.push(o) })
    const ray = new THREE.Raycaster()
    for (let el = -4; el <= 18; el += 2) {
      ray.set(origin, new THREE.Vector3(0, Math.sin((el * Math.PI) / 180), -Math.cos((el * Math.PI) / 180)))
      expect(ray.intersectObjects(opaque, false)[0], `el ${el}`).toBeUndefined()
    }
  })
})

describe('GA cockpits get their own controls and hardware', () => {
  const ga = (designator: string, P = rosterParams(designator)!, label?: string, kind = 'piston') => {
    const e = ROSTER.find(r => r.spec.designator === designator)
    const prof = cockpitProfile(designator, P, { label: label ?? e!.spec.label, powerplant: (e?.spec.powerplant as { kind: string; count?: number }) ?? { kind, count: 1 } })
    return buildCockpit(new THREE.Group(), prof, P.flapDetentsDeg)
  }
  it('stick types fly a floor stick that tilts with input; yoke types keep the yoke', () => {
    const cub = ga('CUB', J3CUB, 'Piper J-3 Cub')
    expect(cub.gaStick).toBeDefined()
    expect(cub.yokeWheel.visible).toBe(false)
    updateCockpitControls(cub, { masterBattery: true, masterAlternator: true, avionicsSwitch: true, pitotHeat: false, apMaster: false, boostPump: false }, 0.5, 1, 0, 0, 1, -1)
    expect(cub.gaStick!.rotation.x).toBeGreaterThan(0.2)
    expect(cub.gaStick!.rotation.z).toBeGreaterThan(0.2)
    const c172 = ga('172', C172S, 'Cessna 172S')
    expect(c172.gaStick).toBeUndefined()
    expect(c172.yokeWheel.visible).toBe(true)
  })
  it('hardware an airplane lacks is not in the cockpit: Cub (no flaps, no electrics), glider (no engine)', () => {
    const cub = ga('CUB', J3CUB, 'Piper J-3 Cub')
    expect(cub.flapLever.visible).toBe(false)
    expect(cub.starterButton.visible).toBe(false)
    expect(cub.switches.masterBattery.visible).toBe(false)
    expect(cub.interactive.includes(cub.flapLever)).toBe(false)
    expect(cub.throttleKnob.visible).toBe(true)
    const glider = ga('LS8')
    for (const m of [glider.throttleKnob, glider.mixtureKnob, glider.ignitionKey, glider.fuelSelectorKnob]) {
      expect(m.visible).toBe(false); expect(glider.interactive.includes(m)).toBe(false)
    }
    const c172 = ga('172', C172S, 'Cessna 172S')
    expect(c172.flapLever.visible).toBe(true); expect(c172.starterButton.visible).toBe(true)
  })
})
