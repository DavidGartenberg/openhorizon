import { describe, expect, it } from 'vitest'
import {
  lonToTileX, latToTileY, tileXToLon, tileYToLat, toNedMeters, fromNedMeters,
  terrariumDecode, curvatureDrop, sampleGrid, flattenForRunway, distanceM, bearingDeg,
  windDirFromNed,
} from '../src/math/geo'
// @ts-expect-error — plain .mjs module without type declarations
import { splitCsvLine, buildUsAirports, buildUsNavaids } from '../server/parse.mjs'
import { WindModel } from '../src/sim/wind'

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

  it('windDirFromNed: recovers the "blowing FROM" direction a wind box shows', () => {
    // North wind (blowing FROM the north, i.e. TOWARD the south) → NED
    // vector points south (negative north component) → wind box reads 0/360.
    expect(windDirFromNed({ x: -1, y: 0 })).toBeCloseTo(0, 6)
    // East wind (FROM the east, blowing toward the west) → vector points
    // west (negative east component) → wind box reads 090.
    expect(windDirFromNed({ x: 0, y: -1 })).toBeCloseTo(90, 6)
    // South wind (FROM the south, blowing toward the north) → vector points
    // north → wind box reads 180.
    expect(windDirFromNed({ x: 1, y: 0 })).toBeCloseTo(180, 6)
    // West wind (FROM the west, blowing toward the east) → vector points
    // east → wind box reads 270.
    expect(windDirFromNed({ x: 0, y: 1 })).toBeCloseTo(270, 6)
  })

  it('windDirFromNed round-trips through WindModel.setSteady', () => {
    const wind = new WindModel()
    wind.setSteady(230, 15)
    const out = { x: 0, y: 0, z: 0 }
    wind.step(0, out) // dt=0: no turbulence growth, pure steady component
    expect(windDirFromNed(out)).toBeCloseTo(230, 3)
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

  it('builds compact US navaids: VOR-DME, plain VOR, and NDB', () => {
    const header =
      'id,filename,ident,name,type,frequency_khz,latitude_deg,longitude_deg,elevation_ft,iso_country,' +
      'dme_frequency_khz,dme_channel,dme_latitude_deg,dme_longitude_deg,dme_elevation_ft,' +
      'slaved_variation_deg,magnetic_variation_deg,usageType,power,associated_airport\n'
    // Real-world-shaped rows (SFO VOR-DME numbers match the actual live
    // OurAirports data fetched during this task).
    const rows =
      '93531,"San_Francisco_VOR-DME_US","SFO","San Francisco","VOR-DME",115800,37.6195,-122.374,13,"US",' +
      '115800,"105X",,,,17.001,14.423,"BOTH","MEDIUM","KSFO"\n' +
      '85399,"Allendale_VOR_US","ALD","Allendale","VOR",116700,33.0125,-81.2922,190,"US",,,,,,-1.001,-6.129,"LO","MEDIUM",\n' +
      '85050,"Williams_Harbour_NDB_CA","1A","Williams Harbour","NDB",373,52.5589,-55.7822,70,"CA",,,,,,,-23.072,"LO","MEDIUM","CCA6"\n' +
      '85264,"Mount_Moffett_NDB-DME_US","ADK","Mount Moffett","NDB-DME",530,51.8719,-176.676,332,"US",' +
      '114000,"087X",51.8713,-176.674,379,,6.285,"BOTH","MEDIUM","PADK"\n'
    const out = buildUsNavaids(header + rows)
    // The CA row (Williams Harbour) must be filtered out — US only.
    expect(out.map((n: any) => n.i).sort()).toEqual(['ADK', 'ALD', 'SFO'])

    const sfo = out.find((n: any) => n.i === 'SFO')
    expect(sfo.t).toBe(1) // VOR-DME
    expect(sfo.f).toBe(115800) // stored kHz == real 115.800 MHz VOR freq
    expect(sfo.la).toBeCloseTo(37.6195, 4)
    // DME co-located (blank dme_lat/lon in the source) falls back to the
    // station's own position rather than being dropped.
    expect(sfo.dla).toBeCloseTo(sfo.la, 5)
    expect(sfo.dlo).toBeCloseTo(sfo.lo, 5)

    const ald = out.find((n: any) => n.i === 'ALD')
    expect(ald.t).toBe(0) // plain VOR
    expect(ald.dla).toBeUndefined() // no DME component at all

    const adk = out.find((n: any) => n.i === 'ADK')
    expect(adk.t).toBe(6) // NDB-DME
    expect(adk.f).toBe(530) // NDB frequency stays real kHz, not scaled
    // ADK has a genuinely distinct DME antenna position in the source data.
    expect(adk.dla).toBeCloseTo(51.8713, 4)
    expect(adk.dla).not.toBeCloseTo(adk.la, 3)
  })
})
