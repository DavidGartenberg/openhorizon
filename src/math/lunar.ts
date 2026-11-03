/**
 * The night sky's geometry: Julian day, sidereal time, the rotation from the
 * render frame (x east, y up, z south) to equatorial coordinates, and the
 * Moon's place from the Astronomical Almanac's low-precision series
 * (≈0.3–1° — far below the 0.5° disc for a sky view).
 */
const RAD = Math.PI / 180

/** Julian day (UT) of a date. */
export function julianDay(date: Date): number {
  return date.getTime() / 86_400_000 + 2_440_587.5
}

/** Greenwich mean sidereal time, rad in [0, 2π). */
export function gmstRad(date: Date): number {
  const d = julianDay(date) - 2_451_545.0
  const deg = (280.46061837 + 360.98564736629 * d) % 360
  return ((deg + 360) % 360) * RAD
}

/**
 * Row-major 3×3 rotation taking a render-frame direction (x east, y up,
 * z south) to equatorial Cartesian coordinates (x → RA 0h, y → RA 6h,
 * z → the north celestial pole) at a local sidereal time and latitude.
 */
export function equatorialMatrix(date: Date, latDeg: number, lonDeg: number): number[] {
  const th = gmstRad(date) + lonDeg * RAD, ph = latDeg * RAD
  const ct = Math.cos(th), st = Math.sin(th), cp = Math.cos(ph), sp = Math.sin(ph)
  return [
    -st, ct * cp, ct * sp,
    ct, st * cp, st * sp,
    0, sp, -cp,
  ]
}

/** The Moon's geocentric right ascension and declination (rad) and distance (km). */
export function moonEquatorial(date: Date): { raRad: number; decRad: number; distanceKm: number } {
  const d = julianDay(date) - 2_451_545.0
  const L = (218.316 + 13.176396 * d) * RAD // mean longitude
  const M = (134.963 + 13.064993 * d) * RAD // mean anomaly
  const F = (93.272 + 13.22935 * d) * RAD // argument of latitude
  const lon = L + 6.289 * RAD * Math.sin(M)
  const lat = 5.128 * RAD * Math.sin(F)
  const distanceKm = 385_001 - 20_905 * Math.cos(M)
  const eps = (23.439 - 0.0000004 * d) * RAD
  const x = Math.cos(lat) * Math.cos(lon)
  const y = Math.cos(eps) * Math.cos(lat) * Math.sin(lon) - Math.sin(eps) * Math.sin(lat)
  const z = Math.sin(eps) * Math.cos(lat) * Math.sin(lon) + Math.cos(eps) * Math.sin(lat)
  return { raRad: Math.atan2(y, x), decRad: Math.asin(z), distanceKm }
}

/** The Moon's direction in the render frame (unit vector). */
export function moonDirection(date: Date, latDeg: number, lonDeg: number): { x: number; y: number; z: number } {
  const m = equatorialMatrix(date, latDeg, lonDeg)
  const { raRad, decRad } = moonEquatorial(date)
  const e = [Math.cos(decRad) * Math.cos(raRad), Math.cos(decRad) * Math.sin(raRad), Math.sin(decRad)]
  // Inverse rotation = transpose.
  return {
    x: m[0]! * e[0]! + m[3]! * e[1]! + m[6]! * e[2]!,
    y: m[1]! * e[0]! + m[4]! * e[1]! + m[7]! * e[2]!,
    z: m[2]! * e[0]! + m[5]! * e[1]! + m[8]! * e[2]!,
  }
}

/** Illuminated fraction of the Moon's disc (0 new … 1 full) from the
 *  sun and moon directions (unit vectors, any common frame). */
export function moonIlluminatedFraction(sun: { x: number; y: number; z: number }, moon: { x: number; y: number; z: number }): number {
  const cosElong = sun.x * moon.x + sun.y * moon.y + sun.z * moon.z
  return (1 - cosElong) / 2
}
