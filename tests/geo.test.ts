import { describe, expect, it } from 'vitest'
import {
  lonToTileX, latToTileY, tileXToLon, tileYToLat, toNedMeters, fromNedMeters,
  terrariumDecode, curvatureDrop, sampleGrid, flattenForRunway, distanceM, bearingDeg,
} from '../src/math/geo'
// @ts-expect-error — plain .mjs module without type declarations
import { splitCsvLine, buildUsAirports } from '../server/parse.mjs'

describe('geo math', () => {
  it('tile ↔ lat/lon roundtrips', () => {
    const lat = 37.5134
    const lon = -122.5011
    expect(tileXToLon(lonToTileX(lon, 13), 13)).toBeCloseTo(lon, 8)
    expect(tileYToLat(latToTileY(lat, 13), 13)).toBeCloseTo(lat, 8)
  })

  it('ENU roundtrips near the anchor', () => {
    const anchor = { lat: 37.5, lon: -122.5 }
    const p = toNedMeters(37.55, -122.42, anchor)
    const back = fromNedMeters(p.north, p.east, anchor)
    expect(back.lat).toBeCloseTo(37.55, 8)
    expect(back.lon).toBeCloseTo(-122.42, 8)
    expect(p.north).toBeGreaterThan(5000)
    expect(p.east).toBeGreaterThan(6000)
  })

  it('decodes terrarium elevations', () => {
    expect(terrariumDecode(128, 0, 0)).toBeCloseTo(0, 5) // sea level
    expect(terrariumDecode(128, 100, 0)).toBeCloseTo(100, 5)
  })

  it('curvature drop ≈ 78 m at 1 km... 31.4 m at 20 km', () => {
    expect(curvatureDrop(1000)).toBeCloseTo(0.0785, 3)
    expect(curvatureDrop(20_000)).toBeCloseTo(31.39, 1)
  })

  it('bilinear grid sampling interpolates', () => {
    const g = new Float32Array([0, 10, 20, 30]) // 2x2
    expect(sampleGrid(g, 2, 0.5, 0.5)).toBeCloseTo(15)
    expect(sampleGrid(g, 2, 0, 0)).toBe(0)
    expect(sampleGrid(g, 2, 1, 1)).toBe(30)
  })

  it('runway flattening is flat inside, blends outside', () => {
    const flat = flattenForRunway(100, 0, 0, -500, 0, 500, 0, 20, 20, 25)
    expect(flat).toBe(20) // on centerline → runway plane
    const far = flattenForRunway(100, 0, 5000, -500, 0, 500, 0, 20, 20, 25)
    expect(far).toBe(100) // untouched far away
    const mid = flattenForRunway(100, 0, 130, -500, 0, 500, 0, 20, 20, 25)
    expect(mid).toBeGreaterThan(20)
    expect(mid).toBeLessThan(100)
  })

  it('distance/bearing sanity: KHAF→KSFO ≈ 9 nm, NE-ish', () => {
    const khaf = { lat: 37.5134, lon: -122.5011 }
    const ksfo = { lat: 37.6188, lon: -122.375 }
    const d = distanceM(khaf, ksfo)
    expect(d / 1852).toBeGreaterThan(7)
    expect(d / 1852).toBeLessThan(11)
    const b = bearingDeg(khaf, ksfo)
    expect(b).toBeGreaterThan(20)
    expect(b).toBeLessThan(70)
  })
})

describe('OurAirports parsing', () => {
  it('splits quoted CSV', () => {
    expect(splitCsvLine('a,"b, c",d')).toEqual(['a', 'b, c', 'd'])
  })

  it('builds compact US airports with runways', () => {
    const airports =
      'id,ident,type,name,latitude_deg,longitude_deg,elevation_ft,continent,iso_country,iso_region,municipality,scheduled_service,gps_code,iata_code,local_code,home_link,wikipedia_link,keywords\n' +
      '1,KHAF,small_airport,"Half Moon Bay Airport",37.5134,-122.5011,66,NA,US,US-CA,Half Moon Bay,no,KHAF,HAF,HAF,,,\n' +
      '2,EGLL,large_airport,"Heathrow",51.47,-0.46,83,EU,GB,GB-ENG,London,yes,EGLL,LHR,,,,\n'
    const runways =
      'id,airport_ref,airport_ident,length_ft,width_ft,surface,lighted,closed,le_ident,le_latitude_deg,le_longitude_deg,le_elevation_ft,le_heading_degT,le_displaced_threshold_ft,he_ident,he_latitude_deg,he_longitude_deg,he_elevation_ft,he_heading_degT,he_displaced_threshold_ft\n' +
      '10,1,KHAF,5000,150,ASP,1,0,12,37.5205,-122.5123,60,133,0,30,37.5109,-122.4989,66,313,0\n'
    const out = buildUsAirports(airports, runways)
    expect(out).toHaveLength(1)
    const ap = out[0]!
    expect(ap.i).toBe('KHAF')
    expect(ap.r).toHaveLength(1)
    expect(ap.r[0].s).toBe(0) // asphalt = hard
    expect(ap.r[0].lt).toBe(1)
    expect(ap.r[0].li).toBe('12')
  })
})
