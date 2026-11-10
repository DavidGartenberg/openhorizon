import { describe, expect, it } from 'vitest'
import {
  BuildingMeshBuilder, FOUNDATION_M, Occupancy, ROOF_STYLE, buildingSeed, buildingStyle, footprintMetres, hash01, orientedBox, ringArea, type Pt,
} from '../src/world/buildings'
import { plantCell } from '../src/world/scenery'
import { COVER, coverCode } from '../src/world/nlcd-palette'
// @ts-expect-error plain ES module (server code)
import { buildingsFromLayer, clipRingToTile, decodeVectorLayer, roadsFromLayer, tileBounds } from '../server/osm-buildings.mjs'

const rect = (w: number, d: number, cx = 0, cy = 0): Pt[] => [[cx - w / 2, cy - d / 2], [cx + w / 2, cy - d / 2], [cx + w / 2, cy + d / 2], [cx - w / 2, cy + d / 2]]

describe('footprint measures', () => {
  it('signed area is positive counter-clockwise and negative clockwise', () => {
    expect(ringArea(rect(10, 6))).toBeCloseTo(60)
    expect(ringArea(rect(10, 6).reverse())).toBeCloseTo(-60)
  })

  it('finds the rectangle around a rotated outline: long axis, half sizes, centre', () => {
    const a = Math.PI / 6, c = Math.cos(a), s = Math.sin(a)
    const pts = rect(20, 8, 0, 0).map(([x, y]): Pt => [x * c - y * s + 5, x * s + y * c - 3])
    const box = orientedBox(pts)
    expect(box.halfL).toBeCloseTo(10, 5); expect(box.halfW).toBeCloseTo(4, 5)
    expect(box.cx).toBeCloseTo(5, 5); expect(box.cy).toBeCloseTo(-3, 5)
    expect(Math.abs(box.ax * c + box.ay * s)).toBeCloseTo(1, 5)   // along the long side
    expect(box.area).toBeCloseTo(160, 4)
  })

  it('hash01 is deterministic, in [0, 1) and differs by salt', () => {
    expect(hash01(42, 1)).toBe(hash01(42, 1))
    expect(hash01(42, 1)).not.toBe(hash01(42, 2))
    for (let i = 0; i < 200; i++) { const h = hash01(i * 7919, i); expect(h).toBeGreaterThanOrEqual(0); expect(h).toBeLessThan(1) }
  })
})

describe('how a building is dressed', () => {
  it('a small rectangular outline is a house with a pitched roof; a given height includes the roof', () => {
    const s = buildingStyle(120, null, 7, 0.98, 4.5)
    expect(['gable', 'hip']).toContain(s.roof)
    expect(s.windows).toBe(1)
    expect(s.rise).toBeCloseTo(0.47 * 4.5, 5)
    const tall = buildingStyle(120, 8, 7, 0.98, 4.5)
    expect(tall.wallH + tall.rise).toBeCloseTo(8, 5)
  })

  it('an L-shaped or tiny outline keeps a flat roof, and a shed has no windows', () => {
    expect(buildingStyle(200, null, 3, 0.6, 5).roof).toBe('flat')
    const shed = buildingStyle(20, null, 3, 1, 2)
    expect(shed.windows).toBe(0); expect(shed.wallH).toBeLessThan(3.6)
  })

  it('big outlines are low blocks, tall ones glass towers, and cut pieces never depend on their own size', () => {
    const store = buildingStyle(4000, null, 5, 0.95, 30)
    expect(store.roof).toBe('flat'); expect(store.windows).toBe(2); expect(store.wallH).toBeGreaterThan(7); expect(store.wallH).toBeLessThan(12.1)
    const tower = buildingStyle(900, 120, 5, 0.95, 15)
    expect(tower.windows).toBe(3); expect(tower.wallH).toBe(120)
    const a = buildingStyle(40, null, 99, 1, 3, true), b = buildingStyle(3000, null, 99, 0.5, 20, true)
    expect(a).toEqual(b)
    expect(a.roof).toBe('flat'); expect(a.wallH).toBe(6)
  })
})

describe('building meshes', () => {
  const bounds = (b: BuildingMeshBuilder): { minY: number; maxY: number } => {
    let minY = Infinity, maxY = -Infinity
    for (let i = 1; i < b.positions.length; i += 3) { minY = Math.min(minY, b.positions[i]!); maxY = Math.max(maxY, b.positions[i]!) }
    return { minY, maxY }
  }

  it('a flat-roofed block: four walls and a roof, standing in the ground, outward normals, counter-clockwise faces', () => {
    const b = new BuildingMeshBuilder()
    expect(b.add(rect(40, 30), 100, 101, { h: 12, m: 0, t: 0 }, 1)).toBe(true)
    expect(b.buildings).toBe(1)
    expect(b.triangleCount).toBe(4 * 2 + 2)
    const { minY, maxY } = bounds(b)
    expect(minY).toBeCloseTo(100 - FOUNDATION_M); expect(maxY).toBeCloseTo(101 + 12)
    // Every triangle's geometric normal agrees with its stored one (so nothing is drawn inside-out).
    for (let t = 0; t < b.indices.length; t += 3) {
      const [i0, i1, i2] = [b.indices[t]!, b.indices[t + 1]!, b.indices[t + 2]!]
      const p = (i: number): [number, number, number] => [b.positions[i * 3]!, b.positions[i * 3 + 1]!, b.positions[i * 3 + 2]!]
      const [a, c, d] = [p(i0), p(i1), p(i2)]
      const u = [c[0] - a[0], c[1] - a[1], c[2] - a[2]], v = [d[0] - a[0], d[1] - a[1], d[2] - a[2]]
      const n = [u[1]! * v[2]! - u[2]! * v[1]!, u[2]! * v[0]! - u[0]! * v[2]!, u[0]! * v[1]! - u[1]! * v[0]!]
      const dot = n[0]! * b.normals[i0 * 3]! + n[1]! * b.normals[i0 * 3 + 1]! + n[2]! * b.normals[i0 * 3 + 2]!
      expect(dot).toBeGreaterThan(0)
    }
    // Wall normals point away from the centre.
    for (let i = 0; i < b.vertexCount; i++) {
      if (b.facade[i * 4 + 3] === ROOF_STYLE) { expect(b.normals[i * 3 + 1]).toBeCloseTo(1); continue }
      expect(b.positions[i * 3]! * b.normals[i * 3]! + b.positions[i * 3 + 2]! * b.normals[i * 3 + 2]!).toBeGreaterThan(0)
    }
  })

  it('a clockwise outline builds the same building', () => {
    const a = new BuildingMeshBuilder(), b = new BuildingMeshBuilder()
    a.add(rect(40, 30), 0, 0, { h: 12, m: 0, t: 0 }, 1); b.add(rect(40, 30).reverse(), 0, 0, { h: 12, m: 0, t: 0 }, 1)
    expect(b.triangleCount).toBe(a.triangleCount)
    expect(bounds(b)).toEqual(bounds(a))
  })

  it('walls carry their window layout: whole cells across, storeys up to the wall top, none below the lowest floor', () => {
    const b = new BuildingMeshBuilder()
    b.add(rect(30, 30), 50, 50, { h: 13.6, m: 0, t: 0 }, 1)            // a block: 3.4 m storeys → 4 floors, 3 m cells → 10 across
    const wall = [...Array(b.vertexCount).keys()].filter((i) => b.facade[i * 4 + 3]! > 0)
    expect(wall.length).toBe(16)
    expect(Math.max(...wall.map((i) => b.facade[i * 4]!))).toBe(10)
    expect(Math.max(...wall.map((i) => b.facade[i * 4 + 1]!))).toBeCloseTo(4)
    expect(Math.min(...wall.map((i) => b.facade[i * 4 + 1]!))).toBeLessThan(0)     // the foundation, below the first floor
  })

  it('a house gets a pitched roof above its walls, and its ridge is the highest point', () => {
    const b = new BuildingMeshBuilder()
    b.add(rect(14, 9), 20, 20, { h: null, m: 0, t: 0 }, 11)
    const style = buildingStyle(126, null, 11, 1, 4.5)
    expect(style.roof).not.toBe('flat')
    expect(bounds(b).maxY).toBeCloseTo(20 + style.wallH + style.rise, 4)
  })

  it('rejects slivers, degenerate outlines and non-finite ground', () => {
    const b = new BuildingMeshBuilder()
    expect(b.add(rect(2, 2), 0, 0, { h: 5, m: 0, t: 0 }, 1)).toBe(false)
    expect(b.add([[0, 0], [10, 0], [20, 0]], 0, 0, { h: 5, m: 0, t: 0 }, 1)).toBe(false)
    expect(b.add(rect(20, 20), NaN, 0, { h: 5, m: 0, t: 0 }, 1)).toBe(false)
    expect(b.buildings).toBe(0); expect(b.vertexCount).toBe(0)
  })

  it('a part that starts above the street keeps its base there', () => {
    const b = new BuildingMeshBuilder()
    b.add(rect(20, 20), 10, 10, { h: 40, m: 30, t: 0 }, 1)
    expect(bounds(b).minY).toBeCloseTo(40)
  })
})

describe('what stands on the ground', () => {
  it('marks buildings with a margin and roads at their width; outside the tile counts as taken', () => {
    const o = new Occupancy(100, 1000, 1000)                      // 10 m cells
    expect(o.occupied(500, 500)).toBe(false)
    o.markBox([[200, 200], [240, 200], [240, 230], [200, 230]], 5)
    expect(o.occupied(220, 215)).toBe(true); expect(o.occupied(196, 215)).toBe(true); expect(o.occupied(260, 215)).toBe(false)
    o.markLine([[0, 800], [1000, 800]], 6)
    expect(o.occupied(503, 803)).toBe(true); expect(o.occupied(503, 830)).toBe(false)
    expect(o.occupied(-5, 500)).toBe(true); expect(o.occupied(500, 1001)).toBe(true)
  })
})

describe('placing records', () => {
  const tile = { s: 37.4, w: -122.5 }
  it('converts micro-degree offsets to metres from the tile centre', () => {
    const pts = footprintMetres({ h: null, m: 0, t: 0, p: [1000, 2000, 1000, 3000, 2000, 3000] }, tile, { lat: 37.4015, lon: -122.4975 }, { north: 111_000, east: 88_000 })
    expect(pts).toHaveLength(3)
    expect(pts[0]![0]).toBeCloseTo((-122.498 + 122.4975) * 88_000, 3)
    expect(pts[0]![1]).toBeCloseTo((37.401 - 37.4015) * 111_000, 3)
  })
  it('a whole building is seeded by where it stands; a cut piece by its height, so both pieces match', () => {
    const a = { h: null, m: 0, t: 0, p: [1000, 2000, 1000, 3000, 2000, 3000] }
    expect(buildingSeed(a, tile)).toBe(buildingSeed({ ...a }, tile))
    expect(buildingSeed(a, tile)).not.toBe(buildingSeed({ ...a, p: [5000, 2000, 1000, 3000, 2000, 3000] }, tile))
    expect(buildingSeed({ ...a, t: 1, h: 12 }, tile)).toBe(buildingSeed({ h: 12, m: 0, t: 1, p: [9, 9, 8, 8, 7, 7] }, { s: 10, w: 10 }))
  })
})

describe('trees', () => {
  const box = { latS: 37.5, latN: 37.5045, lonW: -122.4, lonE: -122.3945 }   // about 500 m square
  it('fills forest, leaves open ground bare, and always grows the same trees', () => {
    const forest = plantCell(box, () => COVER.evergreen)
    expect(forest.length).toBeGreaterThan(1500)
    expect(forest.filter((t) => t.conifer).length / forest.length).toBeGreaterThan(0.8)
    expect(plantCell(box, () => 0)).toHaveLength(0)
    expect(plantCell(box, () => COVER.devHigh)).toHaveLength(0)
    expect(plantCell(box, () => COVER.evergreen)).toEqual(forest)
    for (const t of forest) {
      expect(t.lat).toBeGreaterThanOrEqual(box.latS); expect(t.lat).toBeLessThanOrEqual(box.latN)
      expect(t.lon).toBeGreaterThanOrEqual(box.lonW); expect(t.lon).toBeLessThanOrEqual(box.lonE)
      expect(t.heightM).toBeGreaterThan(7); expect(t.heightM).toBeLessThan(27)
    }
  })
  it('follows the land cover inside a cell: trees only on the forested half', () => {
    const mid = (box.lonW + box.lonE) / 2
    const half = plantCell(box, (_lat, lon) => (lon < mid ? COVER.deciduous : 0))
    expect(half.length).toBeGreaterThan(500)
    expect(half.every((t) => t.lon < mid)).toBe(true)
    expect(half.filter((t) => t.conifer).length / half.length).toBeLessThan(0.2)
  })
  it('plants built-up land thinly, garden-sized, and only where no building or road is known to stand', () => {
    expect(plantCell(box, () => COVER.devLow)).toHaveLength(0)                       // nothing known about the buildings: nothing planted
    const free = plantCell(box, () => COVER.devLow, 11, () => false)
    const forest = plantCell(box, () => COVER.deciduous)
    expect(free.length).toBeGreaterThan(200); expect(free.length).toBeLessThan(forest.length * 0.7)
    expect(Math.max(...free.map((t) => t.heightM))).toBeLessThan(19.5)
    expect(plantCell(box, () => COVER.devLow, 11, () => true)).toHaveLength(0)
    const mid = (box.latS + box.latN) / 2
    expect(plantCell(box, () => COVER.devLow, 11, (lat) => lat > mid).every((t) => t.lat <= mid)).toBe(true)
    // Forest does not ask.
    expect(plantCell(box, () => COVER.evergreen, 11, () => true).length).toBe(plantCell(box, () => COVER.evergreen).length)
  })
  it('reads the land-cover legend into codes', () => {
    expect(coverCode(28, 95, 44, 255)).toBe(COVER.evergreen)
    expect(coverCode(104, 171, 95, 255)).toBe(COVER.deciduous)
    expect(coverCode(235, 0, 0, 255)).toBe(COVER.devMed)
    expect(coverCode(70, 107, 159, 255)).toBe(0)     // water
    expect(coverCode(28, 95, 44, 0)).toBe(0)         // transparent
  })
})

// ---- the server's vector-tile reader, on a tile encoded here by hand ----

const varint = (n: number): number[] => { const out: number[] = []; while (n > 127) { out.push((n & 0x7f) | 0x80); n = Math.floor(n / 128) } out.push(n); return out }
const zig = (n: number): number => (n < 0 ? -n * 2 - 1 : n * 2)
const field = (tag: number, wire: number, body: number[]): number[] => [...varint(tag * 8 + wire), ...body]
const bytes = (tag: number, body: number[]): number[] => field(tag, 2, [...varint(body.length), ...body])
const str = (tag: number, s: string): number[] => bytes(tag, [...Buffer.from(s, 'utf8')])
/** MoveTo, LineTo…, ClosePath for one ring given as absolute points (`from` is where the cursor is). */
const ringCommands = (pts: Array<[number, number]>, from: [number, number]): number[] => {
  const out = [9, zig(pts[0]![0] - from[0]), zig(pts[0]![1] - from[1]), ((pts.length - 1) << 3) | 2]
  for (let i = 1; i < pts.length; i++) out.push(zig(pts[i]![0] - pts[i - 1]![0]), zig(pts[i]![1] - pts[i - 1]![1]))
  out.push(15)
  return out
}
const doubleValue = (v: number): number[] => { const b = Buffer.alloc(8); b.writeDoubleLE(v); return field(3, 1, [...b]) }

describe('vector tile → buildings', () => {
  // Clockwise on screen (y down) = an outer ring.
  const square: Array<[number, number]> = [[100, 100], [300, 100], [300, 300], [100, 300]]
  const crossing: Array<[number, number]> = [[4000, 1000], [4200, 1000], [4200, 1200], [4000, 1200]]
  const feature = (geometry: number[], tags: number[]): number[] => bytes(2, [...bytes(2, tags.flatMap(varint)), ...field(3, 0, [3]), ...bytes(4, geometry.flatMap(varint))])
  const layer = (name: string): number[] => bytes(3, [
    ...str(1, name),
    ...feature(ringCommands(square, [0, 0]), [0, 0]),
    ...feature(ringCommands(crossing, [0, 0]), [0, 1]),
    ...feature(ringCommands(square.map(([x, y]): [number, number] => [x + 1000, y]), [0, 0]), [0, 0, 1, 2]),
    ...str(3, 'render_height'), ...str(3, 'hide_3d'),
    ...bytes(4, doubleValue(24.5)), ...bytes(4, doubleValue(5)), ...bytes(4, field(7, 0, [1])),
    ...field(5, 0, varint(4096)),
  ])
  const tile = Uint8Array.from([...layer('water'), ...layer('building')])

  it('reads the named layer: features, properties and rings', () => {
    const l = decodeVectorLayer(tile, 'building')
    expect(l.extent).toBe(4096)
    expect(l.features).toHaveLength(3)
    expect(l.features[0].properties).toEqual({ render_height: 24.5 })
    expect(l.features[0].rings).toEqual([square])
    expect(l.features[2].properties.hide_3d).toBe(true)
    expect(decodeVectorLayer(tile, 'nothing')).toBeNull()
  })

  it('keeps real heights, treats the default 5 m as unknown, skips hidden outlines and cuts at the tile edge', () => {
    const b = tileBounds(14, 2620, 6350)
    const out = buildingsFromLayer(decodeVectorLayer(tile, 'building'), b, 14, 6350)
    expect(out).toHaveLength(2)
    expect(out[0]).toMatchObject({ h: 24.5, m: 0, t: 0 })
    expect(out[0].p).toHaveLength(8)
    // The first corner: 100/4096 of the way east and south of the tile's north-west corner.
    expect(out[0].p[1]).toBe(Math.round((100 / 4096) * (b.e - b.w) * 1e6))
    expect(out[0].p[0]).toBeGreaterThan(0); expect(out[0].p[0]).toBeLessThan(Math.round((b.n - b.s) * 1e6))
    expect(out[1]).toMatchObject({ h: null, t: 1 })
    const maxLon = Math.round((b.e - b.w) * 1e6)
    expect(Math.max(...out[1].p.filter((_: number, i: number) => i % 2 === 1))).toBe(maxLon)
  })

  it('roads come as centrelines with a half width by class; paths and tunnels are left out', () => {
    const b = tileBounds(14, 2620, 6350)
    const line = [[0, 2048], [4096, 2048]]
    const layer = { extent: 4096, features: [
      { type: 2, properties: { class: 'primary' }, rings: [line] },
      { type: 2, properties: { class: 'path' }, rings: [line] },
      { type: 2, properties: { class: 'minor', brunnel: 'tunnel' }, rings: [line] },
      { type: 3, properties: { class: 'minor' }, rings: [line] },
    ] }
    const roads = roadsFromLayer(layer, b, 14, 6350)
    expect(roads).toHaveLength(1)
    expect(roads[0].w).toBe(8.5)
    expect(roads[0].p).toHaveLength(4)
    expect(roads[0].p[1]).toBe(0); expect(roads[0].p[3]).toBe(Math.round((b.e - b.w) * 1e6))
    expect(roadsFromLayer(null, b, 14, 6350)).toEqual([])
  })

  it('clips a ring to the tile square and reports whether it cut', () => {
    expect(clipRingToTile(square, 4096)).toEqual({ ring: square, cut: false })
    const c = clipRingToTile(crossing, 4096)
    expect(c.cut).toBe(true)
    expect(Math.max(...c.ring.map((p: number[]) => p[0]!))).toBe(4096)
    expect(clipRingToTile([[5000, 0], [5100, 0], [5100, 100]], 4096)).toEqual({ ring: [], cut: true })
  })

  it('tile bounds are the slippy tile\'s box', () => {
    const b = tileBounds(14, 2620, 6350)
    expect(b.w).toBeCloseTo(-122.431641, 5); expect(b.e).toBeCloseTo(-122.409668, 5)
    expect(b.n).toBeGreaterThan(b.s); expect(b.n - b.s).toBeCloseTo(0.01744, 4)
  })
})
