import fs from 'node:fs'
import { describe, expect, it } from 'vitest'
import { XP_GA_COCKPITS, gaCockpitFor } from '../src/render/xplane-ga-cockpits'
import { XP_MODELS, XP_PLACEMENT } from '../src/render/xplane-manifest'
import { eyeFromObj } from '../src/render/xplane-cockpit'
import { cockpitProfile } from '../src/render/cockpit-profile'
import { parseObj8 } from '../src/render/xplane-obj8'
import { ROSTER, rosterParams } from '../src/sim/aircraft/roster'
import { C172S } from '../src/sim/aircraft/c172s'
import { J3CUB } from '../src/sim/aircraft/j3cub'

const MODELS = Object.keys(XP_GA_COCKPITS)
const path = (o: string | { path: string }): string => (typeof o === 'string' ? o : o.path)

/** Every light airplane of the fleet, as the cockpit chooser sees it. */
const gaFleet = (): Array<{ key: string; ga: NonNullable<ReturnType<typeof cockpitProfile>['ga']> }> => {
  const out: Array<{ key: string; ga: NonNullable<ReturnType<typeof cockpitProfile>['ga']> }> = []
  const add = (key: string, P: Parameters<typeof cockpitProfile>[1], label: string, powerplant: { kind: string; count?: number }): void => {
    const c = cockpitProfile(key, P, { label, powerplant })
    if (c.ga) out.push({ key, ga: c.ga })
  }
  add('172', C172S, 'Cessna 172S', { kind: 'piston', count: 1 })
  add('CUB', J3CUB, 'Piper J-3 Cub', { kind: 'piston', count: 1 })
  for (const r of ROSTER) { const P = rosterParams(r.spec.designator); if (P) add(r.spec.designator, P, r.spec.label, r.spec.powerplant) }
  return out
}

describe('which X-Plane cockpit each light airplane flies', () => {
  it('the six X-Plane airplanes fly their own', () => {
    const own = { '172': 'C172', SR22: 'SR22', BE58: 'BE58', PA18: 'PA18', AS21: 'AS21', BE9L: 'BE9L' }
    for (const { key, ga } of gaFleet()) if (key in own) expect(gaCockpitFor(key, ga), key).toBe(own[key as keyof typeof own])
  })

  it('every other light airplane flies the closest one, by how it is flown', () => {
    const want: Record<string, string> = {
      CUB: 'PA18', E300: 'PA18', DA40: 'PA18', P51: 'PA18',   // stick singles
      SR20: 'SR22',                                           // the side-yoke Cirrus
      PA44: 'BE58', C310: 'BE58', DA42: 'BE58', PA34: 'BE58', // piston twins
      TBM9: 'BE9L', PC12: 'BE9L', C208: 'BE9L', B350: 'BE9L', DHC6: 'BE9L', // turboprops
      DG80: 'AS21', LS8: 'AS21', DISC: 'AS21',                 // gliders
      P28A: 'C172', C182: 'C172', BE36: 'C172', DHC2: 'C172', AN2: 'C172', // yoke singles
    }
    const fleet = new Map(gaFleet().map((f) => [f.key, f.ga]))
    for (const [key, model] of Object.entries(want)) expect(gaCockpitFor(key, fleet.get(key)!), key).toBe(model)
  })

  it('covers the whole light fleet with one of the six', () => {
    const fleet = gaFleet()
    expect(fleet.length).toBeGreaterThan(40)
    for (const { key, ga } of fleet) expect(MODELS, key).toContain(gaCockpitFor(key, ga))
  })
})

describe('the light-airplane cockpit manifest', () => {
  it('places each cockpit by the same CG as its exterior model', () => {
    for (const k of MODELS) {
      expect(XP_MODELS[k]?.folder, k).toBe(XP_GA_COCKPITS[k]!.folder)
      expect(XP_GA_COCKPITS[k]!.cgFt, k).toEqual(XP_PLACEMENT[k]!.cgFt)
    }
  })

  it('lists unique interior objects, glass last, and never the pilot figures, pre-fill or wrecks', () => {
    for (const k of MODELS) {
      const m = XP_GA_COCKPITS[k]!, paths = m.objs.map(path)
      expect(new Set(paths).size, k).toBe(paths.length)
      const glass = m.objs.map((o) => typeof o !== 'string' && !!o.glass)
      expect(glass.indexOf(true) === -1 || glass.slice(glass.indexOf(true)).every(Boolean), k).toBe(true)
      for (const p of paths) expect(p, k).not.toMatch(/pilot|prefill|broken|wreck/i)
      expect(m.panelObj, k).toMatch(/_cockpit\.obj$/)
      expect(m.ga, k).toBeDefined()
    }
  })

  it('puts the pilot\'s eye in the cabin: a metre or two above and near the CG', () => {
    for (const k of MODELS) {
      const e = eyeFromObj(XP_GA_COCKPITS[k]!)
      expect(Math.abs(e.x), k).toBeLessThan(2)
      expect(Math.abs(e.y), k).toBeLessThan(0.5)
      expect(e.up, k).toBeGreaterThan(0.1); expect(e.up, k).toBeLessThan(1.5)
    }
  })
})

const XP = process.env.XPLANE_DIR ?? '/Users/davidgartenberg/X-Plane 12/Aircraft/Laminar Research'
describe.skipIf(!fs.existsSync(XP))('the manifest matches the X-Plane install', () => {
  it('every object, click map and panel art is there, and every object parses cleanly', () => {
    for (const k of MODELS) {
      const m = XP_GA_COCKPITS[k]!
      const files = [...m.objs.map(path), m.panelObj]
      for (const f of files) {
        const full = `${XP}/${m.folder}/${f}`
        expect(fs.existsSync(full), full).toBe(true)
        const p = parseObj8(fs.readFileSync(full, 'latin1'), { hitBoxes: true })
        expect(p.draws.length, f).toBeGreaterThan(0)
        expect(p.warnings.filter((w) => /malformed|invalid index|exceeds/.test(w)), f).toEqual([])
      }
      if (m.ga!.panelBackground) expect(fs.existsSync(`${XP}/${m.folder}/${m.ga!.panelBackground}`), k).toBe(true)
    }
  })

  it('names the screens that show this simulator\'s displays', () => {
    const devices = new Set<string>()
    for (const k of MODELS) {
      const m = XP_GA_COCKPITS[k]!
      for (const f of m.objs.map(path)) for (const d of parseObj8(fs.readFileSync(`${XP}/${m.folder}/${f}`, 'latin1')).draws) if (d.device) devices.add(d.device)
    }
    for (const d of ['G1000_PFD1', 'G1000_MFD', 'GNS530_1', 'GNS430_2']) expect(devices).toContain(d)
  })
})
