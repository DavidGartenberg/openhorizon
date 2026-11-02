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
    expect(rows.get('KAAA')).toEqual([['10L', '28R', 250, 100], ['10R', '28L', 0, 0]])
    expect(rows.get('KBBB')).toEqual([['9', '27', 0, 61]])
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
    expect(JSON.parse(fs.readFileSync(path.join(cache, 'apt-runways.json'), 'utf8')).extras).toEqual(JSON.parse(text))
  })
  it('is null without any X-Plane apt.dat, and an empty file scans to nothing', async () => {
    expect((await fresh()).aptRunwayExtras(undefined, [])).toBeNull()
    expect(scanAptRunways(write('empty.dat', '')).size).toBe(0)
  })
})
