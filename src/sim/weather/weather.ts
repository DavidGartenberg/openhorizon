/**
 * Live-weather blending (§11, Phase 5): given parsed METARs with station
 * coordinates, produce the weather at the aircraft — wind vector, gusts,
 * visibility, cloud layers, QNH, and the ISA temperature offset that drives
 * density altitude. Pure module.
 *
 * Blending rules: continuous quantities (wind vector, QNH, temp offset) are
 * inverse-distance-weighted over the nearest ≤3 stations; discrete ones
 * (cloud layers, visibility, present weather) come from the nearest station
 * — interpolating "BKN012 here, CLR there" would fabricate layers neither
 * station reported (§1). VRB winds contribute speed to the gust floor but
 * no direction vector.
 */
import type { ParsedMetar, CloudLayer } from './metar'
import { distanceM } from '../../math/geo'
import { T0, LAPSE } from '../atmosphere'

export interface StationWeather {
  metar: ParsedMetar
  lat: number
  lon: number
  elevFt?: number
}

export interface BlendedWeather {
  windDirDeg: number
  windKt: number
  gustKt: number
  visibilitySm: number
  weather: string[]
  clouds: CloudLayer[]
  qnhInHg: number
  /** Sea-level-equivalent ISA temperature offset, °C (drives density alt). */
  isaTempOffsetC: number
  nearestStation: string
  nearestDistanceM: number
  /** Elevation of the nearest station, ft — cloud bases are AGL there. */
  stationElevFt: number
}

export function blendWeather(
  stations: StationWeather[],
  lat: number,
  lon: number,
): BlendedWeather | null {
  const usable = stations.filter((s) => s.metar.station.length >= 3)
  if (usable.length === 0) return null
  const ranked = usable
    .map((s) => ({ s, d: distanceM({ lat, lon }, { lat: s.lat, lon: s.lon }) }))
    .sort((a, b) => a.d - b.d)
    // Never blend weather from another region: a stale/mismatched station
    // set (e.g. coastal fog applied at Denver during an async refetch) must
    // yield "no weather" rather than fabricated conditions (§1).
    .filter((r) => r.d <= 150_000)
  if (ranked.length === 0) return null
  const top = ranked.slice(0, 3)

  let wSum = 0
  let windN = 0
  let windE = 0
  let gustFloorKt = 0
  let qnhSum = 0
  let qnhW = 0
  let offSum = 0
  let offW = 0
  for (const { s, d } of top) {
    const w = 1 / Math.max(d, 500) ** 2
    wSum += w
    const m = s.metar
    if (typeof m.windDirDeg === 'number' && m.windKt !== undefined) {
      const rad = (m.windDirDeg * Math.PI) / 180
      // Wind FROM dir → vector it blows TOWARD is the reciprocal.
      windN += -Math.cos(rad) * m.windKt * w
      windE += -Math.sin(rad) * m.windKt * w
    } else if (m.windDirDeg === 'VRB' && m.windKt !== undefined) {
      gustFloorKt = Math.max(gustFloorKt, m.windKt)
    }
    if (m.gustKt !== undefined) gustFloorKt = Math.max(gustFloorKt, m.gustKt)
    if (m.altimeterInHg !== undefined) {
      qnhSum += m.altimeterInHg * w
      qnhW += w
    }
    if (m.tempC !== undefined) {
      const elevM = (s.elevFt ?? 0) * 0.3048
      const isaC = T0 - 273.15 - LAPSE * elevM
      offSum += (m.tempC - isaC) * w
      offW += w
    }
  }
  const wn = windN / wSum
  const we = windE / wSum
  const speedKt = Math.hypot(wn, we)
  // Direction the wind blows FROM.
  const dirDeg = speedKt > 0.5 ? ((Math.atan2(-we, -wn) * 180) / Math.PI + 360) % 360 : 0

  const near = top[0]!.s.metar
  return {
    windDirDeg: Math.round(dirDeg),
    windKt: speedKt,
    gustKt: Math.max(gustFloorKt, speedKt),
    visibilitySm: near.visibilitySm ?? 10,
    weather: near.weather,
    clouds: near.clouds,
    qnhInHg: qnhW > 0 ? qnhSum / qnhW : 29.92,
    isaTempOffsetC: offW > 0 ? offSum / offW : 0,
    nearestStation: near.station,
    nearestDistanceM: top[0]!.d,
    stationElevFt: top[0]!.s.elevFt ?? 0,
  }
}
