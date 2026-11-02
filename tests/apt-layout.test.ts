import { describe, expect, it, vi } from 'vitest'

// The glow sprite needs a canvas; geometry and styling are what these tests are about.
vi.mock('../src/render/light-glow', () => ({ lightGlowTexture: () => ({ isTexture: true }) }))
import * as THREE from 'three'
import {
  normalizeApt, lineStyle, surfaceStyle, dashRuns, offsetLine, taxiIdentSegments, buildAptMeshes, lightStyle, samplePolyline, buildAptLights, type AptLayout, type XZ,
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
      icao: 'K', name: '', elevFt: 0, pav: [], lines: [], lights: [], ramps: [],
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
    const layout: AptLayout = { icao: 'K', name: '', elevFt: 0, ramps: [], lines: [], lights: [], taxi: { nodes: [], edges: [] }, pav: [{ surf: 1, name: '', rings: [outer, hole] }, { surf: 1, name: '', rings: [square(0.002, 0, 0.0005)] }, { surf: 15, name: '', rings: [square(0.003, 0, 0.001)] }] }
    const g = buildAptMeshes(layout, toLocal, 10)
    const pav = g.children.filter((c) => c.name.startsWith('aptPavement')) as THREE.Mesh[]
    expect(pav).toHaveLength(1)                           // asphalt merged; the transparent surface draws nothing
    const outerArea = (0.001 * 100_000) * (0.001 * 111_320), holeArea = (0.0002 * 100_000) * (0.0002 * 111_320), secondArea = (0.0005 * 100_000) * (0.0005 * 111_320)
    expect(area(pav[0]!)).toBeCloseTo(outerArea - holeArea + secondArea, 0)
    expect(pav[0]!.geometry.getAttribute('position').getY(0)).toBeCloseTo(10 + surfaceStyle(1)!.lift, 5)
  })
  it('paints one mesh per colour and a border mesh only for bordered types', () => {
    const l = (t: number): AptLayout['lines'][number] => ({ t, p: [[0, 0], [0, 0.001]] })
    const base: AptLayout = { icao: 'K', name: '', elevFt: 0, pav: [], lights: [], ramps: [], taxi: { nodes: [], edges: [] }, lines: [l(1), l(2), l(3), l(20)] }
    const g = buildAptMeshes(base, toLocal, 0)
    expect(g.children.map((c) => c.name).sort()).toEqual(['aptPaint-white', 'aptPaint-yellow'])
    const g2 = buildAptMeshes({ ...base, lines: [l(51)] }, toLocal, 0)
    expect(g2.children.map((c) => c.name)).toContain('aptLineBorders')
    // lines sit above the pavement ladder, borders just under the paint
    const yellow = g.children.find((c) => c.name === 'aptPaint-yellow') as THREE.Mesh
    expect(yellow.geometry.getAttribute('position').getY(0)).toBeGreaterThan(0.06)
  })
  it('a degenerate polygon is dropped without failing the airport', () => {
    const layout: AptLayout = { icao: 'K', name: '', elevFt: 0, ramps: [], lines: [], lights: [], taxi: { nodes: [], edges: [] }, pav: [{ surf: 1, name: '', rings: [[[0, 0], [0, 0], [0, 0]]] }, { surf: 2, name: '', rings: [square(0, 0, 0.001)] }] }
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
    const l: AptLayout = { icao: 'K', name: '', elevFt: 0, pav: [], lines: [], ramps: [], taxi: { nodes: [], edges: [] }, lights: [{ l: 101, p: [[0, 0], [0, 0.001]] }, { l: 102, p: [[0, 0], [0.001, 0]] }] }
    const pts = buildAptLights(l, toLocal, 3)!
    expect(pts.name).toBe('aptLights')
    expect((pts.material as THREE.PointsMaterial).opacity).toBe(0)
    expect(pts.geometry.getAttribute('position').count).toBeGreaterThan(5)
    expect(pts.geometry.getAttribute('position').getY(0)).toBeGreaterThan(3)
    expect(buildAptLights({ ...l, lights: [] }, toLocal, 0)).toBeNull()
  })
})
