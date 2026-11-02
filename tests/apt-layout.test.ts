import { describe, expect, it, vi } from 'vitest'

// The glow sprite needs a canvas; geometry and styling are what these tests are about.
vi.mock('../src/render/light-glow', () => ({ lightGlowTexture: () => ({ isTexture: true }) }))
// Marking meshes paint a wear texture on a canvas; the redraw logic is what these tests are about.
vi.mock('../src/world/airport-detail', async (importActual) => { const T = await import('three'); return { ...(await importActual<typeof import('../src/world/airport-detail')>()), buildRunwayMarkings: () => new T.Group() } })
import * as THREE from 'three'
import {
  sockDirection, sockDroop, buildAptWindsocks, gateLabel, runwayRects, insideRunway, groundGrid, densify, subdivideTriangles, normalizeApt, lineStyle, surfaceStyle, dashRuns, offsetLine, taxiIdentSegments, buildAptMeshes, buildAptPavement, lightStyle, samplePolyline, buildAptLights, type AptLayout, type XZ,
} from '../src/world/apt-layout'

const toLocal = (lat: number, lon: number): XZ => ({ x: lon * 100_000, z: -lat * 111_320 })

describe('apt layout validation', () => {
  it('keeps good features and drops malformed ones as units', () => {
    const l = normalizeApt({
      icao: 'KXYZ', name: 'Test', elevFt: 13,
      pav: [{ surf: 1, name: 'A', rings: [[[1, 1], [1, 2], [2, 2]], [[Infinity, 1], [1, 2], [2, 2]]] }, { surf: 1, rings: [[[1, 1]]] }],
      lines: [{ t: 1, p: [[1, 1], [1, 2]] }, { t: 1, p: [[1, 1], ['x', 2]] }, { t: 'a', p: [[1, 1], [1, 2]] }, { t: 2, p: [[95, 1], [1, 2]] }],
      ramps: [{ lat: 1, lon: 2, hdg: 90, kind: 'gate', cats: ['jets'], name: 'A1' }, { lat: 'q' }],
      taxi: { nodes: [{ id: 0, lat: 1, lon: 1 }, { id: 'z' }], edges: [{ a: 0, b: 1, kind: 'taxiway_A', name: 'A' }, { a: 'q' }] },
    })!
    expect(l.pav).toHaveLength(1); expect(l.pav[0]!.rings).toHaveLength(1)   // the hole with an infinite point is dropped, the outer ring kept
    expect(l.lines).toHaveLength(1)
    expect(l.ramps).toHaveLength(1); expect(l.taxi.nodes).toHaveLength(1); expect(l.taxi.edges).toHaveLength(1)
  })
  it('rejects non-objects and layouts with nothing drawable', () => {
    expect(normalizeApt(null)).toBeNull(); expect(normalizeApt('x')).toBeNull(); expect(normalizeApt({})).toBeNull()
  })
})

describe('paint', () => {
  it('maps the common apt.dat line types to their real markings', () => {
    expect(lineStyle(1)).toMatchObject({ color: 'yellow', lanes: [0], border: false })
    expect(lineStyle(2)!.dash).toBeTruthy()
    expect(lineStyle(3)!.lanes).toHaveLength(2)                                   // double solid yellow
    const hold = lineStyle(4)!
    expect(hold.lanes).toHaveLength(4); expect(hold.dashedLanes).toHaveLength(2)  // two solid, two broken
    expect(lineStyle(6)!.lanes.length).toBeGreaterThanOrEqual(3)                  // ILS ladder
  })
  it('the 5x/7x/8x/9x codes are the same lines with a black border', () => {
    const plain = lineStyle(1)!, bordered = lineStyle(51)!
    expect(bordered.border).toBe(true); expect(bordered.color).toBe(plain.color); expect(bordered.lanes).toEqual(plain.lanes)
    expect(lineStyle(61)!.border).toBe(true)
    expect(lineStyle(70)!.color).toBe('white')
    expect(lineStyle(90)!.color).toBe('orange')
  })
  it('road edges are white, service lines coloured, and light codes are not painted', () => {
    expect(lineStyle(20)!.color).toBe('white'); expect(lineStyle(30)!.color).toBe('red'); expect(lineStyle(41)!.color).toBe('blue'); expect(lineStyle(42)!.color).toBe('green')
    for (const c of [0, 101, 110, 999, -3]) expect(lineStyle(c)).toBeNull()
  })
  it('surfaces: asphalt darker than concrete, turf green, nothing for water/snow/transparent', () => {
    const lum = (c: number): number => ((c >> 16) & 255) + ((c >> 8) & 255) + (c & 255)
    expect(lum(surfaceStyle(1)!.color)).toBeLessThan(lum(surfaceStyle(2)!.color))
    const turf = surfaceStyle(3)!.color; expect((turf >> 8) & 255).toBeGreaterThan((turf >> 16) & 255)
    for (const s of [13, 14, 15]) expect(surfaceStyle(s)).toBeNull()
    expect(lum(surfaceStyle(22)!.color)).toBe(lum(surfaceStyle(1)!.color))     // weathered asphalt variants
    expect(lum(surfaceStyle(33)!.color)).toBe(lum(surfaceStyle(2)!.color))     // weathered concrete variants
  })
})

describe('dashes and offsets', () => {
  const line: XZ[] = [{ x: 0, z: 0 }, { x: 10, z: 0 }]
  it('splits a line into paint runs and gaps of the right lengths', () => {
    const runs = dashRuns(line, 2, 1)
    expect(runs).toHaveLength(4)                         // 0–2, 3–5, 6–8, 9–10
    expect(runs[0]).toEqual([{ x: 0, z: 0 }, { x: 2, z: 0 }])
    expect(runs[1]![0]!.x).toBeCloseTo(3); expect(runs[1]![1]!.x).toBeCloseTo(5)
    expect(runs[3]![0]!.x).toBeCloseTo(9); expect(runs[3]!.at(-1)!.x).toBeCloseTo(10)
    const painted = runs.reduce((n, r) => n + Math.hypot(r.at(-1)!.x - r[0]!.x, r.at(-1)!.z - r[0]!.z), 0)
    expect(painted).toBeCloseTo(7)
  })
  it('keeps the pattern running around corners', () => {
    const bent: XZ[] = [{ x: 0, z: 0 }, { x: 3, z: 0 }, { x: 3, z: 3 }]
    const runs = dashRuns(bent, 2, 1)
    const total = runs.reduce((n, r) => n + r.slice(1).reduce((m, p, i) => m + Math.hypot(p.x - r[i]!.x, p.z - r[i]!.z), 0), 0)
    expect(total).toBeCloseTo(4)                          // 0–2 painted, 2–3 gap, 3–5 painted, 5–6 gap
  })
  it('a line shorter than one dash is one run; an empty line has none', () => {
    expect(dashRuns([{ x: 0, z: 0 }, { x: 1, z: 0 }], 5, 5)).toHaveLength(1)
    expect(dashRuns([], 1, 1)).toEqual([])
  })
  it('offsets to the right of travel', () => {
    const o = offsetLine([{ x: 0, z: 0 }, { x: 10, z: 0 }], 1)
    expect(o[0]!.z).toBeCloseTo(1); expect(o[1]!.z).toBeCloseTo(1); expect(o[0]!.x).toBeCloseTo(0)
    expect(offsetLine([{ x: 0, z: 0 }, { x: 10, z: 0 }], 0)[0]).toEqual({ x: 0, z: 0 })
  })
})

describe('the taxi network names real taxiways', () => {
  it('uses the midpoints of named taxiway edges only', () => {
    const l: AptLayout = {
      icao: 'K', name: '', elevFt: 0, pav: [], lines: [], signs: [], rwy: [], lights: [], ramps: [],
      taxi: {
        nodes: [{ id: 0, lat: 0, lon: 0, use: 'both', name: '' }, { id: 1, lat: 0, lon: 0.001, use: 'both', name: '' }],
        edges: [{ a: 0, b: 1, oneway: false, kind: 'taxiway_A', name: 'A' }, { a: 0, b: 1, oneway: false, kind: 'runway', name: '10L/28R' }, { a: 0, b: 1, oneway: false, kind: 'taxiway_B', name: '' }, { a: 0, b: 9, oneway: false, kind: 'taxiway_C', name: 'C' }],
      },
    }
    const segs = taxiIdentSegments(l, toLocal)
    expect(segs).toHaveLength(1)
    expect(segs[0]).toMatchObject({ ref: 'A' }); expect(segs[0]!.x).toBeCloseTo(50, 0)
  })
})

describe('meshes', () => {
  const square = (x0: number, z0: number, s: number): [number, number][] => [[z0, x0], [z0, x0 + s], [z0 + s, x0 + s], [z0 + s, x0]].map(([la, lo]) => [la!, lo!] as [number, number])
  const area = (m: THREE.Mesh): number => {
    const g = m.geometry, p = g.getAttribute('position'), idx = g.index!
    let a = 0
    for (let i = 0; i < idx.count; i += 3) {
      const [i0, i1, i2] = [idx.getX(i), idx.getX(i + 1), idx.getX(i + 2)]
      a += Math.abs((p.getX(i1) - p.getX(i0)) * (p.getZ(i2) - p.getZ(i0)) - (p.getX(i2) - p.getX(i0)) * (p.getZ(i1) - p.getZ(i0))) / 2
    }
    return a
  }
  it('pavement with a hole covers outer minus hole, merged per surface', () => {
    // toLocal: 1° lon = 100 km, 1° lat = 111.32 km  →  use tiny degrees
    const outer = square(0, 0, 0.001), hole = square(0.0003, 0.0003, 0.0002)
    const layout: AptLayout = { icao: 'K', name: '', elevFt: 0, ramps: [], lines: [], signs: [], rwy: [], lights: [], taxi: { nodes: [], edges: [] }, pav: [{ surf: 1, name: '', rings: [outer, hole] }, { surf: 1, name: '', rings: [square(0.002, 0, 0.0005)] }, { surf: 15, name: '', rings: [square(0.003, 0, 0.001)] }] }
    const g = buildAptMeshes(layout, toLocal, 10)
    const pav = g.children.filter((c) => c.name.startsWith('aptPavement')) as THREE.Mesh[]
    expect(pav).toHaveLength(1)                           // asphalt merged; the transparent surface draws nothing
    const outerArea = (0.001 * 100_000) * (0.001 * 111_320), holeArea = (0.0002 * 100_000) * (0.0002 * 111_320), secondArea = (0.0005 * 100_000) * (0.0005 * 111_320)
    expect(area(pav[0]!)).toBeCloseTo(outerArea - holeArea + secondArea, 0)
    expect(pav[0]!.geometry.getAttribute('position').getY(0)).toBeCloseTo(10 + surfaceStyle(1)!.lift, 5)
  })
  it('paints one mesh per colour and a border mesh only for bordered types', () => {
    const l = (t: number): AptLayout['lines'][number] => ({ t, p: [[0, 0], [0, 0.001]] })
    const base: AptLayout = { icao: 'K', name: '', elevFt: 0, pav: [], lights: [], signs: [], rwy: [], ramps: [], taxi: { nodes: [], edges: [] }, lines: [l(1), l(2), l(3), l(20)] }
    const g = buildAptMeshes(base, toLocal, 0)
    expect(g.children.map((c) => c.name).sort()).toEqual(['aptPaint-white', 'aptPaint-yellow'])
    const g2 = buildAptMeshes({ ...base, lines: [l(51)] }, toLocal, 0)
    expect(g2.children.map((c) => c.name)).toContain('aptLineBorders')
    // lines sit above the pavement ladder, borders just under the paint
    const yellow = g.children.find((c) => c.name === 'aptPaint-yellow') as THREE.Mesh
    expect(yellow.geometry.getAttribute('position').getY(0)).toBeGreaterThan(0.06)
  })
  it('a degenerate polygon is dropped without failing the airport', () => {
    const layout: AptLayout = { icao: 'K', name: '', elevFt: 0, ramps: [], lines: [], signs: [], rwy: [], lights: [], taxi: { nodes: [], edges: [] }, pav: [{ surf: 1, name: '', rings: [[[0, 0], [0, 0], [0, 0]]] }, { surf: 2, name: '', rings: [square(0, 0, 0.001)] }] }
    const g = buildAptMeshes(layout, toLocal, 0)
    expect(g.children.some((c) => c.name === 'aptPavement2')).toBe(true)
  })
})

describe('taxiway lights', () => {
  it('colours follow the light type: green centreline, blue edge, amber otherwise', () => {
    expect(lightStyle(101).color[1]).toBeGreaterThan(lightStyle(101).color[0])
    expect(lightStyle(102).color[2]).toBeGreaterThan(lightStyle(102).color[0])
    expect(lightStyle(104).color[0]).toBeGreaterThan(lightStyle(104).color[2])
    expect(lightStyle(101).spacingM).toBeLessThan(lightStyle(102).spacingM)
  })
  it('samples a polyline at an even spacing, continuing around corners', () => {
    const pts = samplePolyline([{ x: 0, z: 0 }, { x: 10, z: 0 }], 4)
    expect(pts.map((p) => p.x)).toEqual([0, 4, 8])
    const bent = samplePolyline([{ x: 0, z: 0 }, { x: 5, z: 0 }, { x: 5, z: 5 }], 4)
    expect(bent.map((p) => [p.x, p.z])).toEqual([[0, 0], [4, 0], [5, 3]])    // 4 m along, then 4 m of path later: 1 m to the corner + 3 m up the second leg
    expect(samplePolyline([], 4)).toEqual([])
  })
  it('builds one Points cloud, dark until the airport fades it in, capped', () => {
    const l: AptLayout = { icao: 'K', name: '', elevFt: 0, pav: [], lines: [], ramps: [], taxi: { nodes: [], edges: [] }, signs: [], rwy: [], lights: [{ l: 101, p: [[0, 0], [0, 0.001]] }, { l: 102, p: [[0, 0], [0.001, 0]] }] }
    const pts = buildAptLights(l, toLocal, 3)!
    expect(pts.name).toBe('aptLights')
    expect((pts.material as THREE.PointsMaterial).opacity).toBe(0)
    expect(pts.geometry.getAttribute('position').count).toBeGreaterThan(5)
    expect(pts.geometry.getAttribute('position').getY(0)).toBeGreaterThan(3)
    expect(buildAptLights({ ...l, lights: [] }, toLocal, 0)).toBeNull()
  })
})

import { parseSignText, signHeightM, signPanelWidth, layoutSignAtlas, normalizeApt as normalize } from '../src/world/apt-layout'

describe('taxi signs', () => {
  it('parses styles, text and arrows, one panel per "|"', () => {
    expect(parseSignText('{@Y}{^l}B3|{@L}A')).toEqual([
      { style: 'Y', items: [{ arrow: 'l' }, { text: 'B3' }] },
      { style: 'L', items: [{ text: 'A' }] },
    ])
    expect(parseSignText('{@R}28L-10R')).toEqual([{ style: 'R', items: [{ text: '28L-10R' }] }])
    expect(parseSignText('{@L}A{^r}|{@Y}B{^ld}')[1]!.items).toEqual([{ text: 'B' }, { arrow: 'ld' }])
  })
  it('a style change starts a new panel, as real signs combine location, mandatory and direction boards', () => {
    expect(parseSignText('{@L}F2{@R}28L{@@,@L}F2')).toEqual([
      { style: 'L', items: [{ text: 'F2' }] }, { style: 'R', items: [{ text: '28L' }] }, { style: 'L', items: [{ text: 'F2' }] },
    ])
    expect(parseSignText('{@Y}A|B')).toEqual([{ style: 'Y', items: [{ text: 'A' }] }, { style: 'Y', items: [{ text: 'B' }] }])
  })
  it('a sign with no style is a location sign; junk codes are ignored', () => {
    expect(parseSignText('K')[0]!.style).toBe('L')
    expect(parseSignText('{@Z}{^q}K')).toEqual([{ style: 'L', items: [{ text: 'K' }] }])
    expect(parseSignText('')).toEqual([])
  })
  it('size 1…6 is the face height; width follows the content', () => {
    expect(signHeightM(1)).toBeLessThan(signHeightM(3)); expect(signHeightM(3)).toBeLessThan(signHeightM(6))
    expect(signHeightM(99)).toBe(signHeightM(6)); expect(signHeightM(0)).toBe(signHeightM(1))
    const one = parseSignText('{@L}A')[0]!, longer = parseSignText('{@L}A12')[0]!, arrow = parseSignText('{@Y}{^l}A')[0]!
    expect(signPanelWidth(longer, 1)).toBeGreaterThan(signPanelWidth(one, 1))
    expect(signPanelWidth(arrow, 1)).toBeGreaterThan(signPanelWidth(one, 1))
    expect(signPanelWidth(one, 2)).toBeCloseTo((signPanelWidth(one, 1) * signHeightM(2)) / signHeightM(1))
  })
  it('lays the signs on an atlas of fixed cells, in order, and says when it is full', () => {
    const a = layoutSignAtlas(5, { cols: 2, cellW: 256, cellH: 64 })
    expect(a.map((c) => [c.x, c.y])).toEqual([[0, 0], [256, 0], [0, 64], [256, 64], [0, 128]])
    expect(layoutSignAtlas(10, { cols: 2, cellW: 256, cellH: 64, rows: 2 })).toHaveLength(4)
  })
  it('keeps the signs the airport lists (position, heading, text), dropping malformed ones', () => {
    const l = normalize({ pav: [{ surf: 1, rings: [[[0, 0], [0, 1], [1, 1]]] }], signs: [{ lat: 1, lon: 2, hdg: 90, size: 2, text: '{@L}A' }, { lat: 'x' }, { lat: 1, lon: 2, hdg: 0, size: 1, text: '' }] })!
    expect(l.signs).toEqual([{ lat: 1, lon: 2, hdg: 90, size: 2, text: '{@L}A' }])
  })
})

import { applyDisplacedThresholds, applyRunwayOverruns, isConcreteSurface } from '../src/world/apt-layout'
describe('displaced thresholds from the airport data', () => {
  const holder = (li: string, hi: string): { group: THREE.Group; detail: THREE.Group } => {
    const group = new THREE.Group(), detail = new THREE.Group()
    const old = new THREE.Group(); old.name = 'runwayMarkings'; detail.add(old)
    group.userData.runwayDetails = [{ li, hi, rl: { lenM: 3000, widM: 45, liIdent: li, hiIdent: hi, elevAt: () => 0 }, detail }]
    return { group, detail }
  }
  const rwy = (a: string, da: number, b: string, db: number) => [{ w: 45, surf: 1, ends: [{ id: a, dthr: da, over: 0, mark: 3 }, { id: b, dthr: db, over: 0, mark: 3 }] as never }]
  it('redraws the markings of a runway that has a displaced threshold', () => {
    const { group, detail } = holder('10L', '28R')
    const before = detail.getObjectByName('runwayMarkings')
    expect(applyDisplacedThresholds(group, rwy('10L', 0, '28R', 90))).toBe(1)
    const after = detail.getObjectByName('runwayMarkings')
    expect(after).toBeTruthy(); expect(after).not.toBe(before)
    expect(detail.children.filter((c) => c.name === 'runwayMarkings')).toHaveLength(1)
  })
  it('matches the ends whichever way round and with or without a leading zero', () => {
    expect(applyDisplacedThresholds(holder('9L', '27R').group, rwy('27R', 100, '09L', 0))).toBe(1)
  })
  it('leaves runways with no displacement, and runways X-Plane does not list, alone', () => {
    const a = holder('10L', '28R')
    expect(applyDisplacedThresholds(a.group, rwy('10L', 0, '28R', 0))).toBe(0)
    expect(applyDisplacedThresholds(a.group, rwy('1L', 50, '19R', 0))).toBe(0)
    expect(applyDisplacedThresholds(new THREE.Group(), rwy('10L', 90, '28R', 0))).toBe(0)
  })
  it('keeps the runway list from the airport data, dropping a malformed one', () => {
    const l = normalizeApt({ pav: [{ surf: 1, rings: [[[0, 0], [0, 1], [1, 1]]] }], rwy: [{ w: 45, surf: 1, ends: [{ id: '10L', dthr: 0, over: 0, mark: 3 }, { id: '28R', dthr: 90, over: 50, mark: 3 }] }, { ends: [{ id: 5 }] }] })!
    expect(l.rwy).toHaveLength(1); expect(l.rwy[0]!.ends[1]).toEqual({ id: '28R', dthr: 90, over: 50, mark: 3 })
  })
})

describe('blast pads / overruns from the airport data', () => {
  const holder = (li: string, hi: string): { group: THREE.Group; detail: THREE.Group } => {
    const group = new THREE.Group(), detail = new THREE.Group()
    group.userData.runwayDetails = [{ li, hi, rl: { lenM: 3000, widM: 45, liIdent: li, hiIdent: hi, elevAt: () => 0 }, detail }]
    return { group, detail }
  }
  const rwy = (a: string, oa: number, b: string, ob: number, surf = 1) => [{ w: 45, surf, ends: [{ id: a, dthr: 0, over: oa, mark: 3 }, { id: b, dthr: 0, over: ob, mark: 3 }] as never }]
  it('adds a paved, chevron-marked overrun group to a runway that has one, replacing it on a second pass', () => {
    const { group, detail } = holder('10L', '28R')
    expect(applyRunwayOverruns(group, rwy('10L', 0, '28R', 120))).toBe(1)
    const first = detail.getObjectByName('runwayOverruns') as THREE.Group
    expect(first).toBeTruthy(); expect(first.children).toHaveLength(2)             // pavement + chevron paint
    expect(applyRunwayOverruns(group, rwy('10L', 0, '28R', 120))).toBe(1)
    expect(detail.children.filter((c) => c.name === 'runwayOverruns')).toHaveLength(1)
    expect(detail.getObjectByName('runwayOverruns')).not.toBe(first)
  })
  it('matches ends whichever way round, and takes each overrun from its own end', () => {
    const { group, detail } = holder('9L', '27R')
    expect(applyRunwayOverruns(group, rwy('27R', 100, '09L', 0))).toBe(1)
    const mesh = (detail.getObjectByName('runwayOverruns') as THREE.Group).children[0] as THREE.Mesh
    const pos = mesh.geometry.getAttribute('position')
    const ys = Array.from({ length: pos.count }, (_, i) => -pos.getZ(i))              // runway-local y is −z
    expect(Math.min(...ys)).toBeGreaterThanOrEqual(1500 - 1e-6)                        // only the high (27R) end is paved
  })
  it('lays the overrun on the runway\'s own slope rather than flat at the end height', () => {
    const group = new THREE.Group(), detail = new THREE.Group()
    group.userData.runwayDetails = [{ li: '10L', hi: '28R', rl: { lenM: 3000, widM: 45, liIdent: '10L', hiIdent: '28R', elevAt: (t: number) => 2 * Math.max(-0.5, Math.min(0.5, t)) }, detail }]
    applyRunwayOverruns(group, rwy('10L', 0, '28R', 150))
    const mesh = (detail.getObjectByName('runwayOverruns') as THREE.Group).children[0] as THREE.Mesh
    const pos = mesh.geometry.getAttribute('position')
    const ys = Array.from({ length: pos.count }, (_, i) => pos.getY(i))
    // At the runway end (t = 0.5) the ground is 1 m; 150 m farther (t = 0.55) it is 1.1 m — plus the 0.05 m lift.
    expect(Math.min(...ys)).toBeCloseTo(1 + 0.05, 5); expect(Math.max(...ys)).toBeCloseTo(1.1 + 0.05, 5)
  })
  it('does nothing for no overrun, an unlisted runway or a group without runway details', () => {
    const a = holder('10L', '28R')
    expect(applyRunwayOverruns(a.group, rwy('10L', 0, '28R', 0))).toBe(0)
    expect(a.detail.getObjectByName('runwayOverruns')).toBeUndefined()
    expect(applyRunwayOverruns(a.group, rwy('1L', 80, '19R', 0))).toBe(0)
    expect(applyRunwayOverruns(new THREE.Group(), rwy('10L', 80, '28R', 0))).toBe(0)
  })
  it('removes a stale overrun when the airport data no longer has one', () => {
    const { group, detail } = holder('10L', '28R')
    applyRunwayOverruns(group, rwy('10L', 0, '28R', 120))
    expect(applyRunwayOverruns(group, rwy('10L', 0, '28R', 0))).toBe(0)
    expect(detail.getObjectByName('runwayOverruns')).toBeUndefined()
  })
})

describe('runway surfaces', () => {
  it('concrete is surface 2 and the weathered 30–38; asphalt and the rest are not', () => {
    for (const c of [2, 30, 33, 38]) expect(isConcreteSurface(c), String(c)).toBe(true)
    for (const a of [1, 3, 20, 29, 39, 50]) expect(isConcreteSurface(a), String(a)).toBe(false)
  })
  it('a runway found in the airport data is switched to its own surface', () => {
    const group = new THREE.Group(), detail = new THREE.Group()
    const calls: boolean[] = []
    group.userData.runwayDetails = [{ li: '10L', hi: '28R', rl: { lenM: 3000, widM: 45, liIdent: '10L', hiIdent: '28R', elevAt: () => 0 }, detail, setConcrete: (on: boolean) => calls.push(on) }]
    const mk = (surf: number) => [{ w: 45, surf, ends: [{ id: '10L', dthr: 0, over: 0, mark: 3 }, { id: '28R', dthr: 0, over: 0, mark: 3 }] as never }]
    applyDisplacedThresholds(group, mk(2)); applyDisplacedThresholds(group, mk(1))
    expect(calls).toEqual([true, false])
  })
})

describe('following the ground', () => {
  it('a ground grid reproduces a slope (bilinear) and clamps outside its area', () => {
    const g = groundGrid({ minX: 0, maxX: 100, minZ: 0, maxZ: 100 }, 10, (x, z) => 3 + 0.01 * x - 0.02 * z)
    expect(g(35, 62)).toBeCloseTo(3 + 0.35 - 1.24, 4)
    expect(g(-50, 20)).toBeCloseTo(3 - 0.4, 4); expect(g(500, 500)).toBeCloseTo(3 + 1 - 2, 4)
  })
  it('a ground grid widens its spacing instead of exceeding the sample budget', () => {
    let calls = 0
    groundGrid({ minX: 0, maxX: 20_000, minZ: 0, maxZ: 20_000 }, 20, () => { calls++; return 0 }, 10_000)
    expect(calls).toBeLessThan(11_000)
  })
  it('densify adds points so no segment is longer than the limit and keeps the ends', () => {
    const pts = densify([{ x: 0, z: 0 }, { x: 100, z: 0 }, { x: 100, z: 5 }], 14)
    expect(pts[0]).toEqual({ x: 0, z: 0 }); expect(pts.at(-1)).toEqual({ x: 100, z: 5 })
    for (let i = 1; i < pts.length; i++) expect(Math.hypot(pts[i]!.x - pts[i - 1]!.x, pts[i]!.z - pts[i - 1]!.z)).toBeLessThanOrEqual(14 + 1e-9)
    expect(densify([], 10)).toEqual([]); expect(densify([{ x: 1, z: 2 }], 10)).toEqual([{ x: 1, z: 2 }])
  })
  it('subdividing triangles keeps their area, bounds every edge, and a small triangle is untouched', () => {
    const tri = [0, 0, 0, 100, 0, 0, 0, 0, 60]                       // x, y, z per vertex
    const out = subdivideTriangles(tri, null, 25)
    expect(out.length % 9).toBe(0)
    let area = 0, longest = 0
    for (let i = 0; i < out.length; i += 9) {
      const [x0, z0, x1, z1, x2, z2] = [out[i]!, out[i + 2]!, out[i + 3]!, out[i + 5]!, out[i + 6]!, out[i + 8]!]
      area += Math.abs((x1 - x0) * (z2 - z0) - (x2 - x0) * (z1 - z0)) / 2
      longest = Math.max(longest, Math.hypot(x1 - x0, z1 - z0), Math.hypot(x2 - x1, z2 - z1), Math.hypot(x0 - x2, z0 - z2))
    }
    expect(area).toBeCloseTo(3000, 3); expect(longest).toBeLessThanOrEqual(25 + 1e-9)
    expect(subdivideTriangles([0, 0, 0, 5, 0, 0, 0, 0, 5], null, 25)).toEqual([0, 0, 0, 5, 0, 0, 0, 0, 5])
  })
  it('level ground is not subdivided, sloped ground is, and a very long triangle always is', () => {
    const mid = [0, 0, 0, 60, 0, 0, 0, 0, 60]
    expect(subdivideTriangles(mid, null, 30, 400_000, () => 3).length / 9).toBe(1)
    expect(subdivideTriangles(mid, null, 30, 400_000, (x) => 3 + 0.01 * x).length / 9).toBeGreaterThan(4)
    expect(subdivideTriangles([0, 0, 0, 2000, 0, 0, 0, 0, 2000], null, 30, 400_000, () => 3).length / 9).toBeGreaterThan(1)   // too long to trust as level
  })
  it('a segment over level ground is left whole, over a slope it is densified', () => {
    const seg = [{ x: 0, z: 0 }, { x: 80, z: 0 }]
    expect(densify(seg, 14, () => 3)).toHaveLength(2)
    expect(densify(seg, 14, (x) => 3 + 0.01 * x).length).toBeGreaterThan(5)
    expect(densify([{ x: 0, z: 0 }, { x: 400, z: 0 }], 14, () => 3).length).toBeGreaterThan(20)
  })
  it('stops at the triangle budget rather than running away', () => {
    expect(subdivideTriangles([0, 0, 0, 1e6, 0, 0, 0, 0, 1e6], null, 1, 500).length / 9).toBeLessThan(1500)
  })
  it('pavement built with a ground function sits on it (plus its lift) vertex by vertex', () => {
    const ground = (x: number): number => 10 + 0.01 * x
    const layout = normalizeApt({ pav: [{ surf: 1, rings: [[[0, 0], [0, 0.002], [0.001, 0.002], [0.001, 0]]] }] })!
    const meshes = buildAptPavement(layout, toLocal, 0, (x) => ground(x))
    const pos = meshes[0]!.geometry.getAttribute('position')
    for (let i = 0; i < pos.count; i++) {
      const y = pos.getY(i), x = pos.getX(i)
      expect(y).toBeGreaterThan(ground(x)); expect(y - ground(x)).toBeLessThan(0.2)
    }
    expect(pos.count).toBeGreaterThan(6)                                         // subdivided
  })
})

describe('pavement is cut out of runway footprints', () => {
  // toLocal: x = lon·100000 m, z = −lat·111320 m. A runway 2 km long due east along lat 0.0005, 60 m wide.
  const lat = 0.0005
  const rwy = [{ w: 60, surf: 1, ends: [{ id: '9', dthr: 0, over: 0, mark: 3, lat, lon: 0 }, { id: '27', dthr: 0, over: 0, mark: 3, lat, lon: 0.02 }] as never }]
  it('turns runway ends into footprints, skipping runways without coordinates or too short', () => {
    expect(runwayRects(rwy, toLocal)).toHaveLength(1)
    expect(runwayRects([{ w: 45, surf: 1, ends: [{ id: '1', dthr: 0, over: 0, mark: 0 }, { id: '19', dthr: 0, over: 0, mark: 0 }] as never }], toLocal)).toHaveLength(0)
    expect(runwayRects([{ w: 45, surf: 1, ends: [{ id: '1', dthr: 0, over: 0, mark: 0, lat: 0, lon: 0 }, { id: '19', dthr: 0, over: 0, mark: 0, lat: 0, lon: 0.0001 }] as never }], toLocal)).toHaveLength(0)
  })
  it('knows whether a point is inside a footprint, between the ends and inside the edges (less the inset)', () => {
    const r = runwayRects(rwy, toLocal), z = -lat * 111_320
    expect(insideRunway(1000, z, r)).toBe(true); expect(insideRunway(1000, z + 29, r)).toBe(true); expect(insideRunway(1000, z + 31, r)).toBe(false)
    expect(insideRunway(1000, z + 29, r, 1.5)).toBe(false); expect(insideRunway(-5, z, r)).toBe(false); expect(insideRunway(2005, z, r)).toBe(false)
  })
  it('a taxiway polygon crossing the runway keeps no pavement inside it, and all of it outside', () => {
    // A strip 20 m wide (x 990–1010) running north-south across the runway.
    const layout = normalizeApt({ pav: [{ surf: 1, rings: [[[-0.002, 0.0099], [0.003, 0.0099], [0.003, 0.0101], [-0.002, 0.0101]]] }], rwy })!
    const z = -lat * 111_320
    const mesh = (r?: ReturnType<typeof runwayRects>) => buildAptPavement(layout, toLocal, 0, () => 3, r)[0]!.geometry.getAttribute('position')
    const area = (pos: ReturnType<typeof mesh>): number => { let a = 0; for (let i = 0; i < pos.count; i += 3) a += Math.abs((pos.getX(i + 1) - pos.getX(i)) * (pos.getZ(i + 2) - pos.getZ(i)) - (pos.getX(i + 2) - pos.getX(i)) * (pos.getZ(i + 1) - pos.getZ(i))) / 2; return a }
    const whole = area(mesh()), cut = area(mesh(runwayRects(rwy, toLocal)))
    const crossing = 20 * 57                                               // strip width × (runway width − 2 × inset)
    expect(whole - cut).toBeGreaterThan(crossing * 0.9); expect(whole - cut).toBeLessThan(crossing * 1.15)
    const pos = mesh(runwayRects(rwy, toLocal))
    for (let i = 0; i < pos.count; i += 3) {
      const cx = (pos.getX(i) + pos.getX(i + 1) + pos.getX(i + 2)) / 3, cz = (pos.getZ(i) + pos.getZ(i + 1) + pos.getZ(i + 2)) / 3
      expect(Math.abs(cz - z) < 28.4 && cx > 900 && cx < 1100).toBe(false)
    }
  })
})

describe('gate numbers', () => {
  it('reads the number off a gate ramp start and nothing from the rest', () => {
    expect(gateLabel('Gate 54A', 'gate')).toBe('54A'); expect(gateLabel('A12', 'gate')).toBe('A12'); expect(gateLabel('gate g3', 'gate')).toBe('G3')
    expect(gateLabel('B7 Heavy', 'gate')).toBe('B7'); expect(gateLabel('Ramp', 'gate')).toBeNull()
    expect(gateLabel('Gate 54A', 'tie-down')).toBeNull(); expect(gateLabel('', 'gate')).toBeNull(); expect(gateLabel('Terminal Building 4 North', 'gate')).toBeNull()
  })
})

describe('windsocks', () => {
  it('point downwind and hang limp in calm air, level in a fresh wind', () => {
    const near = (a: { x: number; z: number }, x: number, z: number): void => { expect(a.x).toBeCloseTo(x, 6); expect(a.z).toBeCloseTo(z, 6) }
    near(sockDirection(0), 0, 1)                    // wind from the north blows toward the south (+z)
    near(sockDirection(90), -1, 0)                  // from the east → toward the west
    near(sockDirection(270), 1, 0); near(sockDirection(180), 0, -1)
    expect(sockDroop(0)).toBeGreaterThan(1); expect(sockDroop(15)).toBe(0); expect(sockDroop(40)).toBe(0); expect(sockDroop(NaN)).toBeGreaterThan(1)
    expect(sockDroop(5)).toBeLessThan(sockDroop(2))
  })
  it('builds one mast and one turning sock per listed windsock, none when there are none', () => {
    const base = { icao: 'X', name: 'x', elevFt: 0, pav: [], lines: [], signs: [], rwy: [], lights: [], ramps: [], taxi: { nodes: [], edges: [] } } as unknown as AptLayout
    expect(buildAptWindsocks(base, toLocal, 5)).toBeNull()
    const w = buildAptWindsocks({ ...base, wind: [{ lat: 0.001, lon: 0.001 }, { lat: 0.002, lon: 0.003 }] }, toLocal, 5, () => 7)!
    expect(w.pivots).toHaveLength(2); expect(w.group.children).toHaveLength(4)
    expect(w.pivots[0]!.position.y).toBeCloseTo(13)                       // ground 7 + a 6 m mast
    expect(w.pivots[0]!.getObjectByName('sock')).toBeTruthy()
  })
  it('keeps the listed windsocks through validation and drops malformed ones', () => {
    const l = normalizeApt({ pav: [{ surf: 1, rings: [[[0, 0], [0, 1], [1, 1]]] }], wind: [{ lat: 1, lon: 2 }, { lat: 'x' }, { lat: 95, lon: 0 }] })!
    expect(l.wind).toEqual([{ lat: 1, lon: 2 }])
  })
})
