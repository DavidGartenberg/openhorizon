import { existsSync, readFileSync } from 'node:fs'
import { expect, it } from 'vitest'
import { A333_FCU_ART, drawAirbusFcu, type AirbusFcuArt } from '../../src/cockpit/airbus-fcu'

function recorder() {
  const calls: unknown[][] = []
  const context = { fillStyle: '', fillRect() {}, drawImage(...args: unknown[]) { calls.push(args) } } as unknown as CanvasRenderingContext2D
  const art = Object.fromEntries(Object.keys(A333_FCU_ART).map(key => [key, { name: key }])) as unknown as AirbusFcuArt
  return { calls, context, art }
}

it('renders source FCU glyphs in authored digit rows and positions from actual selected values', () => {
  const { calls, context, art } = recorder()
  drawAirbusFcu(context, { iasKt: 153, hdgDeg: 362, altFt: 32000, vsFpm: -1300, vsActive: true }, art)
  // The ACF gen_LED VVI uses four 26x34 rows, with fixed zeros in rows 2/3.
  const vvi = calls.filter(c => c[0] === art.vs)
  expect(vvi.map(c => c.slice(1))).toEqual([
    [26, 0, 26, 34, 1664, 914, 26, 34],
    [78, 34, 26, 34, 1690, 914, 26, 34],
    [0, 68, 26, 34, 1716, 914, 26, 34],
    [0, 102, 26, 34, 1742, 914, 26, 34],
  ])
  expect(calls.find(c => c[0] === art.sign)?.slice(1)).toEqual([20, 0, 20, 22, 1645, 920, 20, 22])
  expect(calls.filter(c => c[0] === art.digits).map(c => c[1])).toEqual([26, 130, 78, 0, 0, 52])
  expect(calls.filter(c => c[0] === art.altitude).map(c => c[1])).toEqual([69, 46, 0, 0, 0])
})

it('restores inactive VS to the authored dashes instead of stale digits', () => {
  const { calls, context, art } = recorder()
  drawAirbusFcu(context, { iasKt: 180, hdgDeg: 90, altFt: 8000, vsFpm: 900, vsActive: false }, art)
  expect(calls.some(c => c[0] === art.vs || c[0] === art.sign)).toBe(false)
  expect(calls.find(c => c[0] === art.dashes)?.slice(1)).toEqual([0, 0, 122, 12, 1644, 925, 122, 12])
})

it('keeps negative altitude and missing-asset fallback values readable', () => {
  const { calls, context, art } = recorder()
  drawAirbusFcu(context, { iasKt: 140, hdgDeg: -1, altFt: -500, vsFpm: 0, vsActive: false }, art)
  expect(calls.filter(c => c[0] === art.altitude).map(c => c[1])).toEqual([276, 0, 115, 0, 0])
  const text: string[] = []
  const fallback = { fillRect() {}, fillText(value: string) { text.push(value) } } as unknown as CanvasRenderingContext2D
  drawAirbusFcu(fallback, { iasKt: 140, hdgDeg: -1, altFt: -500, vsFpm: -1300, vsActive: true }, {})
  expect(text).toEqual(expect.arrayContaining(['140', '359', '-0500', '1300', '−']))
  drawAirbusFcu(fallback, { iasKt: 140, hdgDeg: 90, altFt: 500, vsFpm: 0, vsActive: false }, {})
  expect(text).toContain('----')
})

const root = process.env.XPLANE_DIR ?? '/Users/davidgartenberg/X-Plane 12/Aircraft/Laminar Research'
const folder = `${root}/Airbus A330-300`
it.skipIf(!existsSync(`${folder}/A330.acf`))('matches installed FCU bitmap dimensions and ACF control positions', () => {
  const acf = readFileSync(`${folder}/A330.acf`, 'utf8')
  for (const a of Object.values(A333_FCU_ART)) {
    const png = readFileSync(`${folder}/${a.path}`)
    expect([png.readUInt32BE(16), png.readUInt32BE(20)], a.path).toEqual([a.width, a.height])
  }
  for (const [name, x, y] of [['Airspeed KTS', 1088, -163], ['Heading', 1231, -163], ['Altitude positive', 1559.5, -163], ['VVI', 1716, -163]] as const) {
    expect(acf).toMatch(new RegExp(`gen_LED ${name}\\s+POS ${x.toFixed(6)} ${y.toFixed(6)}`))
  }
})
