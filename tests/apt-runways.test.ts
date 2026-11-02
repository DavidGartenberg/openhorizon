import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterAll, describe, expect, it, vi } from 'vitest'
// @ts-expect-error plain ES module without types (server code)
import { scanAptRunways } from '../server/apt.mjs'

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'apt-runways-'))
afterAll(() => fs.rmSync(dir, { recursive: true, force: true }))

const rwy = (a: string, oa: number, b: string, ob: number) =>
  `100 45.72 1 1 0.25 1 3 1 ${a} 37.5000000 -122.2600000 100 ${oa} 3 0 0 0 ${b} 37.5000000 -122.2400000 0 ${ob} 3 2 1 1`
const FILE = [
  '1     13 0 0 KAAA Alpha Field',
  rwy('10L', 250, '28R', 100),
  rwy('10R', 0, '28L', 0),
  '1302 datum_lat 37.5',
  '1     20 0 0 KBBB Bravo Field',
  rwy('9', 0, '27', 61.4),
  '16     5 0 0 KCCC Seaplane',
  '100 short row',
  '17     5 0 0 KDDD Heliport',
  '',
].join('\n')
type AptModule = { aptRunwayExtras: (c?: string, f?: string[]) => string | null; aptExtents: (c?: string, f?: string[]) => string | null }
/** The tables are memoised per process: each test gets a fresh copy of the module. */
const fresh = async (): Promise<AptModule> => { vi.resetModules(); return (await import(/* @vite-ignore */ '../server/' + 'apt.mjs')) as AptModule }
const write = (name: string, text: string): string => { const f = path.join(dir, name); fs.writeFileSync(f, text); return f }

describe('apt.dat runway scan', () => {
  const rows = scanAptRunways(write('apt.dat', FILE)) as Map<string, Array<[string, string, number, number]>>
  it('reads both end designators and the overrun beyond each, per airport', () => {
    expect(rows.get('KAAA')).toEqual([['10L', '28R', 250, 100, 37.5, -122.26, 37.5, -122.24, 45.72, 1, 3], ['10R', '28L', 0, 0, 37.5, -122.26, 37.5, -122.24, 45.72, 1, 3]])
    expect(rows.get('KBBB')!.map((r) => r.slice(0, 4))).toEqual([['9', '27', 0, 61]])
  })
  it('lists airports with no (or malformed) runway rows as empty, never attributing rows to the wrong airport', () => {
    expect(rows.get('KCCC')).toEqual([]); expect(rows.get('KDDD')).toEqual([])
  })
})

describe('the pavement box of an airport', () => {
  const NODES = `1     13 0 0 KEXT Extent Field
${rwy('10', 0, '28', 0)}
110 1 0.25 360.0000 Taxiway A
111 37.4990000 -122.2700000
111 37.4990000 -122.2300000
113 37.5100000 -122.2300000
111 40.0000000 -100.0000000
1     20 0 0 KSML Small Field
${rwy('9', 0, '27', 0)}
110 1 0.25 360.0000 Apron
111 37.5000000 -122.2500000
111 37.5002000 -122.2500000
113 37.5002000 -122.2498000
`
  it('covers the nodes near the airport and ignores a far-off stray one', () => {
    const rows = scanAptRunways(write('ext.dat', NODES)) as Map<string, unknown> & { extents: Map<string, { box: number[] }> }
    const b = rows.extents.get('KEXT')!.box
    expect(b[0]).toBeCloseTo(37.4990, 4); expect(b[2]).toBeCloseTo(37.51, 4); expect(b[1]).toBeCloseTo(-122.27, 4); expect(b[3]).toBeCloseTo(-122.23, 4)
  })
  it('lists only airports more than about 1.5 km across', async () => {
    const cache = fs.mkdtempSync(path.join(dir, 'cache-'))
    const json = JSON.parse((await fresh()).aptExtents(cache, [write('ext2.dat', NODES)]) as string)
    expect(Object.keys(json)).toEqual(['KEXT'])
  })
})

describe('the overrun table for the client', () => {
  it('lists only airports and runways that have an overrun, and is cached on disk against the file', async () => {
    const f = write('apt2.dat', FILE)
    const cache = fs.mkdtempSync(path.join(dir, 'cache-'))
    const text = (await fresh()).aptRunwayExtras(cache, [f]) as string
    expect(JSON.parse(text)).toEqual({ KAAA: [['10L', '28R', 250, 100]], KBBB: [['9', '27', 0, 61]] })
    const cached = JSON.parse(fs.readFileSync(path.join(cache, 'apt-runways.json'), 'utf8'))
    expect(Object.keys(cached.runways).sort()).toEqual(['KAAA', 'KBBB'])               // the full scan is what is cached
  })
  it('is null without any X-Plane apt.dat, and an empty file scans to nothing', async () => {
    expect((await fresh()).aptRunwayExtras(undefined, [])).toBeNull()
    expect(scanAptRunways(write('empty.dat', '')).size).toBe(0)
  })
})

// @ts-expect-error plain ES module without types (server code)
import { runwayExtras, MAX_RUNWAY_FIX_M, aptOnlyAirports, aptAirportsNear, landMaskRuns, aptLandMasks } from '../server/apt.mjs'
describe('correcting the old database with X-Plane\'s runways', () => {
  const rows = { KAAA: [['10L', '28R', 250, 100, 37.5, -122.26, 37.5, -122.24, 45.7], ['10R', '28L', 0, 0, 37.51, -122.26, 37.51, -122.24, 45.7]] }
  const dbRwy = (li: string, hi: string, la1: number, lo1: number, la2: number, lo2: number, wFt: number) => ({ li, hi, la1, lo1, la2, lo2, w: wFt, s: 0, lt: 0 })
  it('sends the overrun alone for a runway that is where the database puts it, and X-Plane\'s ends and width when it is not', () => {
    const db = [{ i: 'KAAA', r: [dbRwy('10L', '28R', 37.5, -122.26, 37.5, -122.24, 150), dbRwy('10R', '28L', 37.5115, -122.2602, 37.5115, -122.2402, 150)] }]
    const out = runwayExtras(rows, db) as Record<string, unknown[][]>
    expect(out.KAAA![0]).toEqual(['10L', '28R', 250, 100])                       // within 3 m and 0.1 m of width: no correction
    expect(out.KAAA![1]).toEqual(['10R', '28L', 0, 0, 37.51, -122.26, 37.51, -122.24, 45.7])   // ≈ 170 m off: X-Plane's position
  })
  it('matches ends in either order with or without a leading zero, and orients the corrected ends to the database\'s', () => {
    const db = [{ i: 'KAAA', r: [dbRwy('28L', '10R', 37.5, -122.24, 37.5, -122.26, 150)] }]            // stored the other way round, 170 m off
    const out = runwayExtras({ KAAA: [['10R', '28L', 0, 0, 37.51, -122.26, 37.51, -122.24, 45.7]] }, db) as Record<string, unknown[][]>
    expect(out.KAAA![0]!.length).toBe(9)
  })
  it('leaves a database runway alone when X-Plane\'s is implausibly far (a different runway or a database error) and without a database sends overruns only', () => {
    const far = [{ i: 'KAAA', r: [dbRwy('10L', '28R', 37.5 + (MAX_RUNWAY_FIX_M + 1000) / 111_320, -122.26, 37.5, -122.24, 150)] }]
    expect((runwayExtras(rows, far) as Record<string, unknown[][]>).KAAA![0]).toEqual(['10L', '28R', 250, 100])
    const none = runwayExtras(rows, null) as Record<string, unknown[][]>
    expect(none.KAAA).toEqual([['10L', '28R', 250, 100]])
  })
})

describe("airports X-Plane has and the old database lacks", () => {
  const runways = {
    KNEW: [['9', '27', 0, 0, 37.5, -122.26, 37.5, -122.24, 30, 1, 3], ['1', '19', 0, 0, 37.49, -122.25, 37.51, -122.25, 20, 3, 0]],
    KOLD: [['10', '28', 0, 0, 40, -100, 40, -99.98, 40, 1, 3]],
    HELI: [['H1', 'H1', 0, 0, 40, -100, 40, -100, 10, 1, 0]],
    KTINY: [['9', '27', 0, 0, 10, 10, 10, 10.0005, 10, 1, 0]],
  }
  const meta = { KNEW: { name: 'New Field', elevFt: 120, code: 1 }, KOLD: { name: 'Old', elevFt: 5, code: 1 }, HELI: { name: 'Heli', elevFt: 5, code: 17 }, KTINY: { name: 'Tiny', elevFt: 5, code: 1 } }
  it('builds database-shaped entries for airports the database lacks, skipping known ones, heliports and tiny strips', () => {
    const out = aptOnlyAirports(runways, meta, [{ i: 'KOLD', r: [] }]) as Array<Record<string, any>>
    expect(out.map((a) => a.i)).toEqual(['KNEW'])
    const a = out[0]!
    expect(a).toMatchObject({ n: 'New Field', e: 120, t: 0, xo: true })
    expect(a.r).toHaveLength(2); expect(a.r[0]).toMatchObject({ li: '9', hi: '27', s: 0, lt: 1, e1: 120, e2: 120 })
    expect(a.r[0].l).toBeGreaterThan(5000); expect(a.r[0].w).toBeCloseTo(98.4, 0)          // 30 m in feet
    expect(a.r[1]).toMatchObject({ s: 1, lt: 0 })                                           // a turf runway is not hard
    expect(a.la).toBeCloseTo(37.5, 2); expect(a.lo).toBeCloseTo(-122.25, 2)
  })
  it('selects the airports within a radius of a point, and all of them without one', () => {
    const list = [{ la: 37.5, lo: -122.25 }, { la: 41, lo: -100 }]
    expect(aptAirportsNear(list, 37.5, -122.2, 20_000)).toHaveLength(1)
    expect(aptAirportsNear(list, NaN, 0, 1)).toHaveLength(2)
  })
})

describe("runways X-Plane has that a database airport lacks", () => {
  const db = [{ i: 'KDB', r: [{ li: '9', hi: '27', la1: 40, lo1: -100.02, la2: 40, lo2: -99.98, e1: 0, e2: 0, l: 11000, w: 100, s: 0, lt: 1 }] }]
  const row = (a: string, b: string, la1: number, lo1: number, la2: number, lo2: number): Array<string | number> => [a, b, 0, 0, la1, lo1, la2, lo2, 30, 3, 0]
  it('adds a runway on no database runway, with its surface and lights, but not a renumbered or shifted copy of one', () => {
    const out = runwayExtras({
      KDB: [
        row('10', '28', 40.0001, -100.02, 40.0001, -99.98),          // the same runway renumbered
        row('4', '22', 39.99, -100.01, 40.01, -99.99),               // crosses it at a different heading: a new runway
        row('1', '19', 40.2, -100, 40.2002, -100),                   // 22 m: too short
      ],
    }, db as never) as Record<string, unknown[][]>
    expect(out.KDB).toHaveLength(1)
    expect(out.KDB![0]!.slice(0, 2)).toEqual(['4', '22']); expect(out.KDB![0]).toHaveLength(11); expect(out.KDB![0]!.slice(9)).toEqual([1, 0])
  })
  it('sends X-Plane\'s finish (soft, edge-lit) for a runway the database has wrong, with its ends, and nothing for one it has right', () => {
    const wrong = runwayExtras({ KDB: [['9', '27', 0, 0, 40, -100.02, 40, -99.98, 30, 3, 0]] }, db as never) as Record<string, unknown[][]>
    expect(wrong.KDB![0]).toHaveLength(11); expect(wrong.KDB![0]!.slice(9)).toEqual([1, 0])          // turf, unlit; the database says hard and lit
    const right = runwayExtras({ KDB: [['9', '27', 0, 0, 40, -100.02, 40, -99.98, 30, 1, 3]] }, db as never) as Record<string, unknown[][]>
    expect(right.KDB).toBeUndefined()
  })
  it('flags a database runway that no X-Plane runway confirms by designators or within 1.5 km, and never the airport\'s last one', () => {
    const two = [{ i: 'KDB', r: [db[0]!.r[0], { li: '15', hi: '33', la1: 41, lo1: -100.02, la2: 41, lo2: -99.98, e1: 0, e2: 0, l: 7000, w: 100, s: 0, lt: 0 }] }]
    const out = runwayExtras({ KDB: [['9', '27', 0, 0, 40, -100.02, 40, -99.98, 30, 1, 3]] }, two as never) as Record<string, unknown[][]>
    expect(out.KDB).toEqual([['15', '33', -1, -1]])                                       // 111 km from X-Plane's runway
    const one = runwayExtras({ KDB: [['16', '34', 0, 0, 45, -100.02, 45, -99.98, 30, 1, 3]] }, db as never) as Record<string, unknown[][]>
    expect((one.KDB ?? []).filter((r) => r[2] === -1)).toEqual([])                              // the only database runway stays
  })
})

describe('the land mask of a low airport', () => {
  // A 1 km x 400 m apron east of the reference, and a 2 km runway along its north edge.
  const layout = {
    pav: [{ surf: 2, name: '', rings: [[[0, 0], [0, 0.009], [0.0036, 0.009], [0.0036, 0]]] }],
    rwy: [{ w: 45, surf: 1, ends: [{ id: '9', lat: 0.004, lon: 0 }, { id: '27', lat: 0.004, lon: 0.018 }] }],
  }
  it('covers the pavement and the runway, grown by a cell, as runs along rows', () => {
    const runs = landMaskRuns(layout, 0, 0) as number[][]
    expect(runs.length).toBeGreaterThan(4)
    const lons = runs.flatMap((r) => [r[1]!, r[3]!]), lats = runs.flatMap((r) => [r[0]!, r[2]!])
    expect(Math.min(...lons)).toBeLessThan(0.0005); expect(Math.max(...lons)).toBeGreaterThan(0.0165)    // the runway's far end, 2 km east
    expect(Math.min(...lats)).toBeLessThan(0.0005); expect(Math.max(...lats)).toBeGreaterThan(0.0035)
    for (const r of runs) { expect(r[0]).toBe(r[2]); expect(r[3]).toBeGreaterThanOrEqual(r[1]!) }         // a run lies along one row
  })
  it('is empty without a layout or a position, and for an airport that is too tall', () => {
    expect(landMaskRuns(null, 0, 0)).toEqual([])
    expect(landMaskRuns(layout, NaN, 0)).toEqual([])
    expect(aptLandMasks([{ i: 'HIGH', la: 0, lo: 0, e: 5000 }], undefined)).toEqual({})
  })
})

describe('heliports: airports with helipads and no runway', () => {
  const PADS = ['1     50 0 0 HHOS Hospital Heliport', '102 H1 40.0000000 -100.0000000 90.00 20.00 10.00 2 0 0 0.25 0', '102 H2 40.0010000 -100.0000000 0.00 1.00 1.00 2 0 0 0.25 0',
    '1    200 0 0 HRIG [H] Troll A Platform', '102 H1 60.0000000 3.0000000 0.00 39.00 39.00 1 0 0 0.25 0', ''].join('\n')
  it('reads the helipads of each airport (row 102)', () => {
    const scan = scanAptRunways(write('pads.dat', PADS)) as Map<string, unknown[]> & { pads: Map<string, unknown[][]> }
    expect(scan.pads.get('HHOS')).toEqual([['H1', 40, -100, 90, 20, 10, 2], ['H2', 40.001, -100, 0, 1, 1, 2]])
    expect(scan.get('HHOS')).toEqual([])                                                      // no runway row
  })
  it('become airports of short pad-flagged "runways", leaving out tiny pads, rigs and airports already known', () => {
    const pads = { HHOS: [['H1', 40, -100, 90, 20, 10, 2], ['H2', 40.001, -100, 0, 1, 1, 2]], HRIG: [['H1', 60, 3, 0, 39, 39, 1]], KOLD: [['H1', 41, -100, 0, 20, 20, 1]] }
    const meta = { HHOS: { name: 'Hospital Heliport', elevFt: 50, code: 1 }, HRIG: { name: '[H] Troll A Platform', elevFt: 200, code: 1 }, KOLD: { name: 'Old', elevFt: 5, code: 1 } }
    const out = aptOnlyAirports({}, meta, [{ i: 'KOLD', r: [] }], pads) as Array<Record<string, any>>
    expect(out.map((a) => a.i)).toEqual(['HHOS'])
    const a = out[0]!
    expect(a).toMatchObject({ n: 'Hospital Heliport', e: 50, xo: true })
    expect(a.r).toHaveLength(1)
    expect(a.r[0]).toMatchObject({ li: 'H1', hi: 'H1', pad: true, s: 0, lt: 0, e1: 50 })
    expect(a.r[0].l).toBeCloseTo(65.6, 0)                                                      // 20 m in feet
    expect(a.r[0].lo2).toBeGreaterThan(a.r[0].lo1)                                             // heading 90: the pad's length runs east
    expect(a.r[0].la1).toBeCloseTo(a.r[0].la2, 5)
  })
})
