/**
 * ADS-B provider normalization (14a) — pure. Three free feeds, one
 * wire shape: {ac:[{id, cs, t, lat, lon, altFt, gnd, gsKt, trk,
 * vsFpm, ageS}], ts(ms)}. Fixtures follow each provider's documented
 * response shape (readsb/tar1090 for adsb.lol + adsb.fi; the states
 * array for OpenSky). Rows without a position are dropped — a target
 * you can't place is display noise, not data.
 */
import { describe, expect, it } from 'vitest'
// @ts-expect-error untyped .mjs module (precedent: aircraft-types-parse)
import { normalizeAdsb } from '../../server/parse.mjs'

const TAR1090 = {
  ac: [
    {
      hex: 'a1b2c3', type: 'adsb_icao', flight: 'UAL123  ', t: 'B738',
      alt_baro: 12000, alt_geom: 12300, gs: 285.6, track: 271.3,
      baro_rate: -1200, lat: 37.65, lon: -122.4, seen_pos: 0.4, seen: 0.1,
    },
    {
      hex: 'abc001', alt_baro: 'ground', gs: 12.1, track: 90,
      lat: 37.62, lon: -122.38, seen_pos: 1.2, seen: 0.2,
    },
    { hex: 'nolat1', flight: 'GHOST', alt_baro: 5000, seen: 3.0 },
  ],
  total: 3,
  now: 1721830000.5, // readsb: seconds (float)
  msg: 'No error',
}

const OPENSKY = {
  time: 1721830000,
  states: [
    // icao24, callsign, country, time_position, last_contact, lon, lat,
    // baro_alt(m), on_ground, velocity(m/s), track, vert_rate(m/s), ...
    ['a1b2c3', 'UAL123  ', 'United States', 1721829998, 1721829999, -122.4, 37.65, 3657.6, false, 146.94, 271.3, -6.1, null, 3810.0, '1200', false, 0],
    ['bbb002', 'N123AB', 'United States', 1721829999, 1721830000, -122.38, 37.62, null, true, 6.2, 90, null, null, null, null, false, 0],
    ['ccc003', 'NOPOS', 'United States', null, 1721830000, null, null, 3000, false, 100, 180, 0, null, null, null, false, 0],
  ],
}

describe('normalizeAdsb — tar1090 family (adsb.lol / adsb.fi)', () => {
  it('maps fields, trims callsigns, keeps the type designator', () => {
    const out = normalizeAdsb(TAR1090, 'adsblol')
    expect(out.ac).toHaveLength(2) // no-position row dropped
    const a = out.ac[0]
    expect(a).toMatchObject({ id: 'a1b2c3', cs: 'UAL123', t: 'B738', lat: 37.65, lon: -122.4, altFt: 12000, gnd: false, gsKt: 286, trk: 271, vsFpm: -1200 })
    expect(a.ageS).toBeCloseTo(0.4, 5)
  })
  it('"ground" altitude becomes altFt 0 with gnd true', () => {
    const g = normalizeAdsb(TAR1090, 'adsbfi').ac[1]
    expect(g).toMatchObject({ id: 'abc001', altFt: 0, gnd: true, gsKt: 12 })
  })
  it('readsb seconds timestamp becomes epoch ms', () => {
    expect(normalizeAdsb(TAR1090, 'adsblol').ts).toBe(1721830000500)
  })
})

describe('normalizeAdsb — OpenSky states', () => {
  it('converts meters and m/s to feet, knots, fpm', () => {
    const out = normalizeAdsb(OPENSKY, 'opensky')
    const a = out.ac[0]
    expect(a.id).toBe('a1b2c3')
    expect(a.cs).toBe('UAL123')
    expect(a.t).toBe('') // OpenSky carries no type designator
    expect(a.altFt).toBe(12000)
    expect(Math.abs(a.gsKt - 286)).toBeLessThanOrEqual(1)
    expect(Math.abs(a.vsFpm - -1201)).toBeLessThanOrEqual(2)
    expect(a.ageS).toBeCloseTo(2, 5) // time - time_position
    expect(out.ts).toBe(1721830000000)
  })
  it('on-ground with null altitude reads altFt 0 / gnd true; no-position rows drop', () => {
    const out = normalizeAdsb(OPENSKY, 'opensky')
    expect(out.ac).toHaveLength(2)
    expect(out.ac[1]).toMatchObject({ id: 'bbb002', altFt: 0, gnd: true })
  })
})

describe('normalizeAdsb — malformed payloads', () => {
  it('never throws; returns an empty list', () => {
    for (const bad of [null, undefined, {}, { ac: null }, { states: 'x' }, 42]) {
      const out = normalizeAdsb(bad, 'adsblol')
      expect(out.ac).toEqual([])
      expect(typeof out.ts).toBe('number')
    }
  })
})
