/** Night-sky geometry: sidereal rotation, the Moon's place and phase. */
import { describe, expect, it } from 'vitest'
import { equatorialMatrix, gmstRad, julianDay, moonDirection, moonEquatorial, moonIlluminatedFraction } from '../src/math/lunar'
import { sunPosition, sunDirectionENU } from '../src/math/solar'

const sunDir = (date: Date, lat: number, lon: number) => sunDirectionENU(sunPosition(date, lat, lon))
const deg = (r: number): number => (r * 180) / Math.PI

describe('night sky geometry', () => {
  it('Julian day and sidereal time match the J2000 epoch', () => {
    expect(julianDay(new Date(Date.UTC(2000, 0, 1, 12)))).toBeCloseTo(2_451_545.0, 6)
    expect(deg(gmstRad(new Date(Date.UTC(2000, 0, 1, 12))))).toBeCloseTo(280.46, 1)
  })

  it('the rotation is orthonormal and puts the celestial pole at the latitude, due north', () => {
    const m = equatorialMatrix(new Date('2026-11-03T06:00:00Z'), 37.5, -122.4)
    for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) {
      const dot = m[i * 3]! * m[j * 3]! + m[i * 3 + 1]! * m[j * 3 + 1]! + m[i * 3 + 2]! * m[j * 3 + 2]!
      expect(dot).toBeCloseTo(i === j ? 1 : 0, 9)
    }
    // Render frame: north is −z. The pole stands 37.5° up toward the north.
    const el = (37.5 * Math.PI) / 180
    const pole = [0, Math.sin(el), -Math.cos(el)]
    expect(m[6]! * pole[0]! + m[7]! * pole[1]! + m[8]! * pole[2]!).toBeCloseTo(1, 9)
  })

  it('phases: new, first quarter and full moon of January 2024', () => {
    const f = (iso: string): number => {
      const d = new Date(iso)
      return moonIlluminatedFraction(sunDir(d, 0, 0), moonDirection(d, 0, 0))
    }
    expect(f('2024-01-11T11:57:00Z')).toBeLessThan(0.02) // new moon
    expect(f('2024-01-18T03:53:00Z')).toBeCloseTo(0.5, 1) // first quarter
    expect(f('2024-01-25T17:54:00Z')).toBeGreaterThan(0.98) // full moon
  })

  it('stays within the ecliptic band and the lunar distance range', () => {
    for (let k = 0; k < 400; k++) {
      const m = moonEquatorial(new Date(Date.UTC(2020, 0, 1) + k * 86_400_000 * 2.3))
      expect(Math.abs(deg(m.decRad))).toBeLessThan(29)
      expect(m.distanceKm).toBeGreaterThan(356_000)
      expect(m.distanceKm).toBeLessThan(407_000)
    }
  })

  it('the full moon rises as the sun sets (opposite in the sky)', () => {
    const d = new Date('2024-01-25T17:54:00Z')
    const s = sunDir(d, 37.5, -122.4), mo = moonDirection(d, 37.5, -122.4)
    expect(s.x * mo.x + s.y * mo.y + s.z * mo.z).toBeLessThan(-0.97)
  })
})
