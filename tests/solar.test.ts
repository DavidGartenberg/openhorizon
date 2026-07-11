import { describe, expect, it } from 'vitest'
import { sunPosition, sunDirectionENU } from '../src/math/solar'

// KSFO-ish
const LAT = 37.6
const LON = -122.4

describe('sunPosition', () => {
  it('puts the summer solstice midday sun high and roughly south', () => {
    // 2026-06-21 20:10 UTC ≈ 13:10 PDT ≈ solar noon at lon -122.4.
    const { elevationDeg, azimuthDeg } = sunPosition(
      new Date(Date.UTC(2026, 5, 21, 20, 10)),
      LAT,
      LON,
    )
    // Max elevation ≈ 90 - lat + declination = 90 - 37.6 + 23.4 ≈ 75.8°.
    expect(elevationDeg).toBeGreaterThan(72)
    expect(elevationDeg).toBeLessThan(79)
    expect(Math.abs(azimuthDeg - 180)).toBeLessThan(25) // near due south at noon
  })

  it('puts the sun below the horizon at local 1am', () => {
    const { elevationDeg } = sunPosition(new Date(Date.UTC(2026, 5, 21, 8, 0)), LAT, LON)
    expect(elevationDeg).toBeLessThan(-15)
  })

  it('has the morning sun in the east and evening sun in the west', () => {
    const morning = sunPosition(new Date(Date.UTC(2026, 5, 21, 15, 0)), LAT, LON) // 8am PDT
    const evening = sunPosition(new Date(Date.UTC(2026, 6, 22, 1, 30)), LAT, LON) // 6:30pm PDT
    expect(morning.azimuthDeg).toBeGreaterThan(45)
    expect(morning.azimuthDeg).toBeLessThan(135)
    expect(evening.azimuthDeg).toBeGreaterThan(225)
    expect(evening.azimuthDeg).toBeLessThan(315)
  })

  it('winter noon sun is much lower than summer noon sun', () => {
    const summer = sunPosition(new Date(Date.UTC(2026, 5, 21, 20, 10)), LAT, LON)
    const winter = sunPosition(new Date(Date.UTC(2026, 11, 21, 20, 10)), LAT, LON)
    expect(summer.elevationDeg - winter.elevationDeg).toBeGreaterThan(40)
  })
})

describe('sunDirectionENU', () => {
  it('maps elevation/azimuth into the east/up/south frame', () => {
    // Sun due east at the horizon → +x.
    const east = sunDirectionENU({ elevationDeg: 0, azimuthDeg: 90 })
    expect(east.x).toBeCloseTo(1, 6)
    expect(east.y).toBeCloseTo(0, 6)
    expect(east.z).toBeCloseTo(0, 6)

    // Sun straight up → +y.
    const up = sunDirectionENU({ elevationDeg: 90, azimuthDeg: 0 })
    expect(up.y).toBeCloseTo(1, 6)

    // Sun due south at 45° elevation → +z (south) and +y components.
    const south = sunDirectionENU({ elevationDeg: 45, azimuthDeg: 180 })
    expect(south.z).toBeGreaterThan(0.7)
    expect(south.y).toBeCloseTo(Math.SQRT1_2, 4)
  })
})
