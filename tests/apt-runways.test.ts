import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterAll, describe, expect, it, vi } from 'vitest'
// @ts-expect-error plain ES module without types (server code)
import { scanAptRunways, aptRunwayExtras } from '../server/apt.mjs'

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

describe('the overrun table for the client', () => {
  it('lists only airports and runways that have an overrun, and is cached on disk against the file', () => {
    const f = write('apt2.dat', FILE)
    const cache = fs.mkdtempSync(path.join(dir, 'cache-'))
    const text = aptRunwayExtras(cache, [f]) as string
    expect(JSON.parse(text)).toEqual({ KAAA: [['10L', '28R', 250, 100]], KBBB: [['9', '27', 0, 61]] })
    expect(JSON.parse(fs.readFileSync(path.join(cache, 'apt-runways.json'), 'utf8')).extras).toEqual(JSON.parse(text))
  })
  it('is null without any X-Plane apt.dat, and an empty file scans to nothing', async () => {
    vi.resetModules()                                     // the table is memoised per process
    const fresh = (await import(/* @vite-ignore */ '../server/' + 'apt.mjs')) as { aptRunwayExtras: (c?: string, f?: string[]) => string | null }
    expect(fresh.aptRunwayExtras(undefined, [])).toBeNull()
    expect(scanAptRunways(write('empty.dat', '')).size).toBe(0)
  })
})
