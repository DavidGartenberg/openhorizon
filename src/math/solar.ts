/**
 * Solar position from date/time and geodetic position, using the NOAA
 * (Spencer/Fourier-series) approximation. Accurate to well under a degree —
 * plenty for lighting. Pure module.
 */

export interface SunAngles {
  /** Degrees above the horizon (negative = below). */
  elevationDeg: number
  /** Degrees clockwise from true north. */
  azimuthDeg: number
}

const RAD = Math.PI / 180

export function sunPosition(date: Date, latDeg: number, lonDeg: number): SunAngles {
  const startOfYearMs = Date.UTC(date.getUTCFullYear(), 0, 1)
  const dayOfYear = (date.getTime() - startOfYearMs) / 86_400_000
  const hoursUTC =
    date.getUTCHours() + date.getUTCMinutes() / 60 + date.getUTCSeconds() / 3600

  // Fractional year, radians.
  const g = ((2 * Math.PI) / 365) * (dayOfYear + (hoursUTC - 12) / 24)

  // Equation of time (minutes) and solar declination (radians).
  const eqTimeMin =
    229.18 *
    (0.000075 +
      0.001868 * Math.cos(g) -
      0.032077 * Math.sin(g) -
      0.014615 * Math.cos(2 * g) -
      0.040849 * Math.sin(2 * g))
  const decl =
    0.006918 -
    0.399912 * Math.cos(g) +
    0.070257 * Math.sin(g) -
    0.006758 * Math.cos(2 * g) +
    0.000907 * Math.sin(2 * g) -
    0.002697 * Math.cos(3 * g) +
    0.00148 * Math.sin(3 * g)

  // True solar time (minutes), lon east-positive.
  const trueSolarMin = hoursUTC * 60 + eqTimeMin + 4 * lonDeg
  const hourAngle = (trueSolarMin / 4 - 180) * RAD

  const lat = latDeg * RAD
  const cosZenith =
    Math.sin(lat) * Math.sin(decl) + Math.cos(lat) * Math.cos(decl) * Math.cos(hourAngle)
  const zenith = Math.acos(clamp(cosZenith, -1, 1))
  const elevationDeg = 90 - zenith / RAD

  // Azimuth from north, clockwise (east positive).
  const sinZenith = Math.sin(zenith)
  let azimuthDeg = 180
  if (sinZenith > 1e-9) {
    const sinAz = (-Math.sin(hourAngle) * Math.cos(decl)) / sinZenith
    const cosAz = (Math.sin(decl) - Math.sin(lat) * cosZenith) / (Math.cos(lat) * sinZenith)
    azimuthDeg = (Math.atan2(sinAz, cosAz) / RAD + 360) % 360
  }

  return { elevationDeg, azimuthDeg }
}

/**
 * Unit direction vector pointing from the observer toward the sun in a local
 * east/up/south frame matching the three.js scene (x = east, y = up,
 * z = south i.e. -north).
 */
export function sunDirectionENU(angles: SunAngles): { x: number; y: number; z: number } {
  const el = angles.elevationDeg * RAD
  const az = angles.azimuthDeg * RAD
  const cosEl = Math.cos(el)
  return {
    x: Math.sin(az) * cosEl,
    y: Math.sin(el),
    z: -Math.cos(az) * cosEl,
  }
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, v))
}
