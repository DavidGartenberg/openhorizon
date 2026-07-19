import { describe, expect, it } from 'vitest'
import { parseMetar } from '../../src/sim/weather/metar'
import { blendWeather, type StationWeather } from '../../src/sim/weather/weather'
import { Aircraft } from '../../src/sim/aircraft'
import { C172S } from '../../src/sim/aircraft/c172s'
import { FT } from '../../src/sim/atmosphere'

function station(raw: string, lat: number, lon: number, elevFt = 0): StationWeather {
  return { metar: parseMetar(raw), lat, lon, elevFt }
}

describe('blendWeather', () => {
  it('uses the nearest station for discrete fields, IDW for wind/QNH', () => {
    const b = blendWeather(
      [
        station('KSFO 191956Z 28010KT 10SM FEW008 17/11 A3001', 37.62, -122.37),
        station('KOAK 191953Z 28020KT 5SM BKN010 16/12 A2995', 37.72, -122.22),
      ],
      37.63, -122.36, // right next to KSFO
    )!
    expect(b.nearestStation).toBe('KSFO')
    expect(b.clouds).toEqual([{ cover: 'FEW', baseFt: 800 }])
    expect(b.visibilitySm).toBe(10)
    expect(b.windDirDeg).toBeGreaterThan(270)
    expect(b.windDirDeg).toBeLessThan(290)
    expect(b.windKt).toBeGreaterThan(9)
    expect(b.windKt).toBeLessThan(15)
    expect(b.qnhInHg).toBeGreaterThan(29.95)
    expect(b.qnhInHg).toBeLessThan(30.01)
  })

  it('computes the ISA temperature offset from station elevation', () => {
    // KDEN at 5434 ft: ISA there ≈ 15 − 1.98·5.434 ≈ +4.2 °C; a 30 °C
    // report is ≈ +25.8 °C over ISA.
    const b = blendWeather([station('KDEN 192053Z 00000KT 10SM CLR 30/05 A3005', 39.85, -104.65, 5434)], 39.85, -104.66)!
    expect(b.isaTempOffsetC).toBeGreaterThan(23)
    expect(b.isaTempOffsetC).toBeLessThan(29)
  })

  it('returns null with no stations and never fabricates', () => {
    expect(blendWeather([], 37, -122)).toBeNull()
  })

  it('refuses to blend stations from another region (stale-set race guard)', () => {
    // Coastal fog stations applied at Denver mid-refetch — must be null,
    // not fabricated calm/OVC004 at KDEN (found live in Phase 5 step 1).
    const coastal = [station('KHAF 191935Z 00000KT 2 1/2SM BR OVC004 14/13 A3010', 37.51, -122.5)]
    expect(blendWeather(coastal, 39.85, -104.67)).toBeNull()
  })

  it('strips the live-feed METAR/SPECI report-type prefix', () => {
    const m = parseMetar('METAR KDEN 191253Z 27007KT 10SM FEW180 22/11 A3016 RMK AO2')
    expect(m.station).toBe('KDEN')
    expect(m.windDirDeg).toBe(270)
    expect(m.windKt).toBe(7)
    expect(m.clouds).toEqual([{ cover: 'FEW', baseFt: 18000 }])
  })
})

describe('density altitude physics (§24: hot-high takeoff measurably longer)', () => {
  function groundRollFt(elevFt: number, isaOffsetC: number): number {
    const ac = new Aircraft()
    ac.fuelKg = C172S.fuelCapacityKg
    ac.payloadKg = C172S.mtowKg - C172S.emptyMassKg - ac.fuelKg
    ac.isaTempOffsetC = isaOffsetC
    const elevM = elevFt * FT
    ac.groundElevAt = () => elevM
    ac.spawnOnGround(0, 0, 0, elevM)
    for (let i = 0; i < 240; i++) ac.step(1 / 120) // settle
    const startN = ac.posNed.x
    let liftoff = 0
    for (let i = 0; i < 120 * 60 && liftoff === 0; i++) {
      ac.controls.throttle = 1
      ac.controls.pitch = ac.data.kias >= 55 ? 0.35 : 0.05
      const hdgErr = ac.data.headingDeg > 180 ? ac.data.headingDeg - 360 : ac.data.headingDeg
      ac.controls.yaw = Math.min(Math.max(-0.04 * hdgErr - 6 * ac.rates.z, -0.6), 0.6)
      ac.step(1 / 120)
      if (!ac.data.onGround && ac.data.kias > 40) liftoff = (ac.posNed.x - startN) / FT
    }
    return liftoff
  }

  it('a +25 °C day at 5400 ft lengthens the ground roll well over 15%', () => {
    const isaRoll = groundRollFt(5400, 0)
    const hotRoll = groundRollFt(5400, 25)
    expect(isaRoll).toBeGreaterThan(0)
    expect(hotRoll).toBeGreaterThan(isaRoll * 1.15)
  })

  it('ISA offset zero leaves the sea-level POH takeoff untouched', () => {
    const roll = groundRollFt(0, 0)
    expect(roll).toBeGreaterThanOrEqual(816)
    expect(roll).toBeLessThanOrEqual(1104)
  })
})
