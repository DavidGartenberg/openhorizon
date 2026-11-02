import fs from 'node:fs'
import { describe, expect, it } from 'vitest'
// @ts-expect-error plain ES module without types (server code)
import { parseAptAirport, flattenNodes, paintedRuns, airportHeader } from '../server/apt-parse.mjs'

const AIRPORT = `1     13 0 0 KXYZ Test Field
1302 datum_lat 37.5
1302 datum_lon -122.25
100 45.72 1 1 0.25 1 3 1 10 37.5000000 -122.2600000 100 0 3 0 0 0 28 37.5000000 -122.2400000 0 50 3 2 1 1
102 H1 37.5010000 -122.2500000 90 20 20 2 1 0 0.25 0
110 1 0.25 360.0000 Taxiway A
111 37.4990000 -122.2500000 1
111 37.4990000 -122.2490000 1
111 37.4980000 -122.2490000
113 37.4980000 -122.2500000 3
111 37.49850 -122.24950
111 37.49850 -122.24920
113 37.49820 -122.24920
120 Centerline A
111 37.5000000 -122.2500000 1
111 37.5000000 -122.2490000 2
115 37.5000000 -122.2480000
130 Airport Boundary
111 37.5100000 -122.2600000
111 37.5100000 -122.2400000
113 37.4900000 -122.2400000
1300 37.4995000 -122.2495000 180.00 gate heavy|jets|turboprops A1 Gate
20 37.4991000 -122.2497000 90.0 0 2 {@Y}A
19 37.5002000 -122.2470000 1 WS
21 37.5000000 -122.2410000 2 280.00 3.00 28 PAPI-4L
1054 118700 TWR
1053 121800 GND
1201 37.4990000 -122.2500000 both 0 A1
1201 37.4990000 -122.2490000 junction 1 A2
1202 0 1 twoway taxiway_A A
`

describe('apt.dat airport parser', () => {
  const a = parseAptAirport(AIRPORT)
  it('reads the header and datum', () => {
    expect(a.icao).toBe('KXYZ'); expect(a.name).toBe('Test Field'); expect(a.elevFt).toBe(13)
    expect(a.datum).toEqual({ lat: 37.5, lon: -122.25 })
  })
  it('reads a runway with both ends, markings, lights and displaced thresholds', () => {
    expect(a.rwy).toHaveLength(1)
    const r = a.rwy[0]
    expect(r.w).toBeCloseTo(45.72); expect(r.surf).toBe(1); expect(r.edgeLights).toBe(3); expect(r.centreLights).toBe(1)
    expect(r.ends.map((e: { id: string }) => e.id)).toEqual(['10', '28'])
    expect(r.ends[0]).toMatchObject({ lat: 37.5, lon: -122.26, dthr: 100, over: 0, mark: 3 })
    expect(r.ends[1]).toMatchObject({ dthr: 0, over: 50, mark: 3, app: 2, tdz: 1, reil: 1 })
  })
  it('reads helipads', () => {
    expect(a.heli[0]).toMatchObject({ id: 'H1', hdg: 90, len: 20, wid: 20 })
  })
  it('reads a pavement polygon with its hole', () => {
    expect(a.pav).toHaveLength(1)
    const p = a.pav[0]
    expect(p.name).toBe('Taxiway A'); expect(p.surf).toBe(1)
    expect(p.rings).toHaveLength(2)          // outer boundary + a hole
    expect(p.rings[0]).toHaveLength(4); expect(p.rings[1]).toHaveLength(3)
  })
  it('paints only the pavement edges that carry a line type, and the linear features', () => {
    const edge = a.lines.filter((l: { edge?: boolean }) => l.edge)
    expect(edge.length).toBeGreaterThan(0)
    for (const l of edge) expect(l.t).toBeGreaterThan(0)
    const feature = a.lines.filter((l: { edge?: boolean }) => !l.edge)
    expect(feature.map((l: { t: number }) => l.t)).toEqual([1, 2])         // solid, then broken, split where the type changes
    expect(feature[0].p).toHaveLength(2); expect(feature[1].p).toHaveLength(2)
  })
  it('reads the boundary, ramp starts, signs, windsocks, PAPI, frequencies and the taxi network', () => {
    expect(a.bound[0]).toHaveLength(3)
    expect(a.ramps[0]).toMatchObject({ hdg: 180, kind: 'gate', cats: ['heavy', 'jets', 'turboprops'], name: 'A1 Gate' })
    expect(a.signs[0]).toMatchObject({ hdg: 90, size: 2, text: '{@Y}A' })
    expect(a.wind).toHaveLength(1)
    expect(a.papi[0]).toMatchObject({ type: 2, hdg: 280, gs: 3, rwy: '28' })
    expect(a.freqs).toEqual([{ kind: 'tower', mhz: 118.7, name: 'TWR' }, { kind: 'ground', mhz: 121.8, name: 'GND' }])
    expect(a.taxi.nodes).toHaveLength(2); expect(a.taxi.edges[0]).toMatchObject({ a: 0, b: 1, oneway: false, kind: 'taxiway_A', name: 'A' })
  })
  it('never throws on junk rows', () => {
    expect(() => parseAptAirport('1 5 0 0 K\nbogus row\n111 x y\n100 1 2\n')).not.toThrow()
  })
})

describe('Bézier edges', () => {
  it('a node with a handle samples a curve; the incoming handle is the mirror image', () => {
    const nodes = [{ lat: 0, lon: 0, bz: { lat: 0, lon: 1 } }, { lat: 0, lon: 4, bz: { lat: 0, lon: 5 } }]
    const open = flattenNodes(nodes, false)
    expect(open.length).toBeGreaterThan(2)
    expect(open[0]).toEqual([0, 0]); expect(open.at(-1)).toEqual([0, 4])
    // both handles lie on the axis, so the curve stays on it and runs from 0 to 4
    for (const [lat] of open) expect(Math.abs(lat)).toBeLessThan(1e-9)
    const lons = open.map((p: number[]) => p[1]); expect(lons).toEqual([...lons].sort((x, y) => x - y))
  })
  it('straight nodes are not subdivided', () => {
    expect(flattenNodes([{ lat: 0, lon: 0 }, { lat: 0, lon: 1 }, { lat: 1, lon: 1 }], true)).toHaveLength(3)
  })
  it('painted runs split where the line type changes and skip unpainted segments', () => {
    const runs = paintedRuns([{ lat: 0, lon: 0, type: 1 }, { lat: 0, lon: 1, type: 1 }, { lat: 0, lon: 2 }, { lat: 0, lon: 3, type: 3 }, { lat: 0, lon: 4 }], false)
    expect(runs.map((r: { t: number }) => r.t)).toEqual([1, 3])
    expect(runs[0].p).toHaveLength(3)
  })
})

describe('airport header rows', () => {
  it('recognises land airports, seaplane bases and heliports', () => {
    expect(airportHeader('1     13 0 0 KSFO San Francisco Intl')).toEqual({ code: 1, elevFt: 13, icao: 'KSFO', name: 'San Francisco Intl' })
    expect(airportHeader('17  100 0 0 XH1 Heli pad')).toMatchObject({ code: 17, icao: 'XH1' })
    expect(airportHeader('100 61.00 33')).toBeNull()
  })
})

const APT = '/Users/davidgartenberg/X-Plane 12/Global Scenery/Global Airports/Earth nav data/apt.dat'
describe.skipIf(!fs.existsSync(APT))('the real X-Plane apt.dat (KSFO)', () => {
  it('parses San Francisco: four runways, dozens of pavements, thousands of painted segments', () => {
    const fd = fs.openSync(APT, 'r')
    try {
      // Read the airport's rows without loading the 380 MB file: find the header by scanning 8 MB windows.
      const win = Buffer.alloc(8 * 1024 * 1024)
      let pos = 0, text = ''
      for (;;) {
        const n = fs.readSync(fd, win, 0, win.length, pos)
        if (n <= 0) break
        const s = win.toString('latin1', 0, n)
        const i = s.search(/\n1\s+13\s+0\s+0\s+KSFO\s/)
        if (i >= 0) { text = s.slice(i + 1); break }
        pos += n - 200
      }
      expect(text).not.toBe('')
      const next = text.search(/\n1\s+-?\d+\s+\d+\s+\d+\s+\S+\s/, ) // header of the following airport (search from after our own header)
      const own = text.slice(text.indexOf('\n') + 1)
      const end = own.search(/\n1\s+-?\d+\s+\d+\s+\d+\s+\S+\s/)
      void next
      const a = parseAptAirport(text.slice(0, text.indexOf('\n') + 1) + (end >= 0 ? own.slice(0, end) : own))
      expect(a.icao).toBe('KSFO')
      expect(a.rwy).toHaveLength(4)
      expect(a.pav.length).toBeGreaterThan(30)
      expect(a.lines.length).toBeGreaterThan(500)
      expect(a.ramps.length).toBeGreaterThan(50)
      expect(a.taxi.edges.length).toBeGreaterThan(300)
    } finally { fs.closeSync(fd) }
  })
})
