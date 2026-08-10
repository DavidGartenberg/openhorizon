/**
 * Radio navigation data + physics (Phase 4 Task 1, §24/§9/§10): VOR/NDB
 * station model, CDI (course-deviation) math, ILS localizer/glideslope beam
 * geometry, DME slant range, marker-beacon detection, and Morse-code ident
 * timelines. Pure module — no three.js/DOM (§4.1) — the caller (a later
 * task) fetches `/api/navaids.json` and hands the parsed array to
 * `NavaidsIndex.load()`, mirroring how `src/world/airports.ts` is *given*
 * data rather than fetching it itself (that file lives in `/world` and may
 * touch three.js; this one must not).
 *
 * All station types/fields mirror the compact JSON produced by
 * `server/parse.mjs#buildNavaids` — see that file's header comment for the
 * exact OurAirports `navaids.csv` schema this was built against.
 */
import { bearingDeg, distanceM, type LatLon } from '../../math/geo'
import { clamp } from '../../math/vec'

// ---- data model ----

/** Navaid type codes, matching `server/parse.mjs`'s `NAVAID_TYPE_CODE`. */
export const enum NavaidType {
  VOR = 0,
  VOR_DME = 1,
  VORTAC = 2,
  TACAN = 3,
  DME = 4,
  NDB = 5,
  NDB_DME = 6,
}

const DME_TYPES = new Set<NavaidType>([
  NavaidType.VOR_DME, NavaidType.VORTAC, NavaidType.TACAN, NavaidType.DME, NavaidType.NDB_DME,
])

/** One record from the compact `/api/navaids.json` payload. */
export interface NavaidData {
  i: string // ident
  n: string // name
  t: NavaidType
  la: number
  lo: number
  e: number // elevation, ft
  f: number // frequency_khz (VOR/TACAN: kHz of the MHz-scale VHF freq, e.g. 115800 = 115.800 MHz; NDB: real kHz)
  mv?: number // magnetic variation/declination at the station, deg (E positive per source convention)
  dla?: number // DME antenna lat, if this station carries a DME/TACAN component
  dlo?: number
  de?: number // DME antenna elevation, ft
}

/** Holds loaded navaid data and answers spatial queries. Mirrors the
 *  load()-then-query shape of `src/world/airports.ts`'s `Airports` class,
 *  minus anything three.js/DOM. */
export class NavaidsIndex {
  private all: NavaidData[] = []

  load(data: NavaidData[]): void {
    this.all = data
  }

  get count(): number {
    return this.all.length
  }

  find(ident: string): NavaidData | undefined {
    const q = ident.trim().toUpperCase()
    return this.all.find((n) => n.i === q)
  }

  /** All navaids within `radiusM` of a lat/lon (linear scan — the navaid
   *  table is ~2-3k US rows, far smaller than the airport table that
   *  justified `Airports`' grid-cell index, so a scan is plenty). */
  near(lat: number, lon: number, radiusM: number): NavaidData[] {
    const p: LatLon = { lat, lon }
    return this.all.filter((n) => distanceM(p, { lat: n.la, lon: n.lo }) <= radiusM)
  }

  hasDme(n: NavaidData): boolean {
    return DME_TYPES.has(n.t)
  }
}

// ---- angle helpers ----

/** Signed angular difference a-b, wrapped to (-180, 180]. */
export function angDiff(a: number, b: number): number {
  let d = (a - b) % 360
  if (d > 180) d -= 360
  if (d <= -180) d += 360
  return d
}

// ---- VOR CDI ----

/** Standard VOR CDI full-scale deflection: ±10°, 5-dot scale (2°/dot) — a
 *  standard avionics convention (e.g. King/Garmin VOR receiver design), not
 *  station-specific data. */
export const VOR_FULL_SCALE_DEG = 10

export type ToFrom = 'TO' | 'FROM'

export interface CdiResult {
  /** Needle deflection, degrees, clamped to ±fullScaleDeg (full-scale pin). */
  deflectionDeg: number
  toFrom: ToFrom
}

/**
 * VOR CDI deflection + TO/FROM flag for an OBS course selected on a VOR
 * receiver tuned to `station`, aircraft at `aircraft`.
 *
 * Convention: the "radial" is the bearing FROM the station TO the aircraft.
 * If the radial is within ±90° of the selected OBS course, the aircraft is
 * on the "FROM" side (flying the selected course takes you away from the
 * station); beyond ±90° it is on the "TO" side, measured against the
 * reciprocal course. Right at the ±90° boundary the needle flips sign
 * discontinuously between the two sides (both are clamped to full-scale
 * there) — this mirrors the real "cone of ambiguity" edge behavior of VOR
 * receivers abeam the station, not a bug in this model.
 *
 * `deflectionDeg` is the NEEDLE deflection (fly-toward): positive = the
 * selected course lies to the aircraft's RIGHT (aircraft left of course) —
 * the SAME sign on both TO and FROM sides, matching `localizerDeflection`'s
 * convention. (A prior revision returned the aircraft-offset sign on the
 * FROM side and the needle sign on the TO side — an AP tracking TO a
 * station steered away from the course; round-4 review finding.)
 */
export function vorCdi(station: LatLon, obsDeg: number, aircraft: LatLon, fullScaleDeg = VOR_FULL_SCALE_DEG): CdiResult {
  const radial = bearingDeg(station, aircraft)
  const diff = angDiff(radial, obsDeg)
  const toFrom: ToFrom = Math.abs(diff) <= 90 ? 'FROM' : 'TO'
  const raw = toFrom === 'FROM' ? -diff : angDiff(diff, 180)
  return { deflectionDeg: clamp(raw, -fullScaleDeg, fullScaleDeg), toFrom }
}

// ---- ILS beam geometry ----

/** Real-world localizer full-scale course width varies with runway length
 *  (FAA AIM 1-1-9): the beam is set so the full-scale width is ~700 ft at
 *  the runway threshold, which works out to roughly ±2.5° for a typical
 *  ~ 2 nm siting to threshold and up to ~±3° for shorter runways/closer
 *  antennas. This module does not model runway-length-dependent course
 *  width (flagged simplification) — it uses a single representative
 *  full-scale figure. */
export const LOC_FULL_SCALE_DEG = 2.5

/** Real-world glideslope full-scale fly-up/fly-down deflection is commonly
 *  cited as ±0.7° from the nominal glidepath angle (FAA AIM 1-1-9). */
export const GS_FULL_SCALE_DEG = 0.7

/** Standard/default ILS glidepath angle. Real installations vary (commonly
 *  2.5°-3.5°) but 3.0° is the textbook default absent a specific procedure. */
export const GS_STANDARD_ANGLE_DEG = 3.0

export interface IlsRef {
  /** Runway threshold lat/lon — the localizer course reference point and
   *  the point the glidepath is defined to cross at `tchFt` height. */
  threshold: LatLon
  /** Inbound front-course true bearing, deg (i.e. the runway heading an
   *  aircraft flies landing on this threshold). */
  courseDeg: number
  /** Threshold elevation, ft MSL. */
  thresholdElevFt: number
  /** Glideslope antenna position — real GS antennas sit ~1,000-1,500 ft
   *  down the runway from the threshold, offset to one side. Approximating
   *  it at the threshold (or a caller-supplied point) is fine for this
   *  module's angular-deviation math since the offset only shifts where
   *  the 0.0° reference point sits, not the deviation formula itself. */
  gsAntenna: LatLon
  gsAntennaElevFt: number
  gsAngleDeg?: number // defaults to GS_STANDARD_ANGLE_DEG
}

/** Localizer angular deflection off the extended runway centerline, deg,
 *  clamped to ±LOC_FULL_SCALE_DEG. Sign convention (verified against the
 *  geometry below): flying the front course inbound, positive = aircraft is
 *  left of course, negative = aircraft is right of course. */
export function localizerDeflection(ils: IlsRef, aircraft: LatLon, fullScaleDeg = LOC_FULL_SCALE_DEG): number {
  // Aircraft flying the front course inbound sits behind the threshold along
  // the extended centerline, i.e. its bearing *from* the threshold is
  // approximately the reciprocal of the front course. The localizer's
  // angular width is exactly the angle between that actual bearing and the
  // reciprocal course — no small-angle approximation needed, this is a true
  // bearing-based angle like a VOR radial.
  const bearingFromThreshold = bearingDeg(ils.threshold, aircraft)
  const reciprocalCourse = (ils.courseDeg + 180) % 360
  const off = angDiff(bearingFromThreshold, reciprocalCourse)
  return clamp(off, -fullScaleDeg, fullScaleDeg)
}

/** Glideslope angular deflection from the nominal glidepath, deg, clamped to
 *  ±GS_FULL_SCALE_DEG. Positive = aircraft above the glidepath (fly down). */
export function glideslopeDeflection(ils: IlsRef, aircraft: LatLon, aircraftAltFt: number, fullScaleDeg = GS_FULL_SCALE_DEG): number {
  const gsAngle = ils.gsAngleDeg ?? GS_STANDARD_ANGLE_DEG
  const groundDistM = distanceM(ils.gsAntenna, aircraft)
  const groundDistFt = groundDistM / 0.3048
  const heightAboveAntennaFt = aircraftAltFt - ils.gsAntennaElevFt
  const actualAngleDeg = (Math.atan2(heightAboveAntennaFt, Math.max(groundDistFt, 1)) * 180) / Math.PI
  return clamp(actualAngleDeg - gsAngle, -fullScaleDeg, fullScaleDeg)
}

// ---- DME slant range ----

const FT_PER_M = 1 / 0.3048

/** DME slant range (nm) — true line-of-sight distance, not ground distance:
 *  DME measures the direct path to the station, so directly overhead a
 *  station at altitude reads its own height as "range" rather than ~0. */
export function dmeSlantRangeNm(station: LatLon, stationElevFt: number, aircraft: LatLon, aircraftAltFt: number): number {
  const groundM = distanceM(station, aircraft)
  const heightDiffM = (aircraftAltFt - stationElevFt) / FT_PER_M
  const slantM = Math.hypot(groundM, heightDiffM)
  return slantM / 1852 // m → nm
}

// ---- service volume / terrain line-of-sight ----

/** FAA-published VOR/VORTAC/TACAN standard service volumes (AIM 1-1-8,
 *  well-known public figures — not an invented table):
 *   Terminal (T): 25 NM, 1,000-12,000 ft AGL
 *   Low (L):      40 NM, 1,000-18,000 ft AGL
 *   High (H):     40 NM up to 14,500 ft AGL; 100 NM 14,500-18,000;
 *                 130 NM 18,000-45,000; 100 NM above 45,000
 *  This module maps the CSV's `usageType` (TERMINAL/LO/HI/BOTH) to one of
 *  these classes at load time in the caller; below takes the class
 *  directly. Altitudes here are treated as AGL at the station for
 *  simplicity (real service volumes are defined relative to the station
 *  site elevation) — a flagged simplification, not a sourcing gap. */
export type ServiceVolumeClass = 'T' | 'L' | 'H'

export function vorServiceVolumeNm(cls: ServiceVolumeClass, altAglFt: number): number {
  if (cls === 'T') return altAglFt <= 12_000 ? 25 : 0
  if (cls === 'L') return altAglFt <= 18_000 ? 40 : 0
  // H
  if (altAglFt <= 14_500) return 40
  if (altAglFt <= 18_000) return 100
  if (altAglFt <= 45_000) return 130
  return 100
}

/** NDB service volumes are far less standardized than VOR's; this repo
 *  doesn't have an authoritative table for them, so a single flagged
 *  assumption stands in: 25 NM regardless of altitude for LOW/MEDIUM power
 *  stations, 50 NM for HIGH power (matches the CSV's `power` field). This
 *  is a placeholder engineering choice, not a sourced FAA figure. */
export function ndbServiceVolumeNm(power: 'LOW' | 'MEDIUM' | 'HIGH'): number {
  return power === 'HIGH' ? 50 : 25
}

/** Radio line-of-sight range (nm) by the standard VHF/UHF radio-horizon
 *  approximation d = 1.23·sqrt(h_ft) per end (4/3 effective-earth-radius
 *  model, a widely-cited aviation formula), summed for aircraft + station
 *  height. This is a simplified stand-in for real terrain occlusion — per
 *  the task's scope, reusing Phase 2's full terrain heightfield for radio
 *  propagation was judged unnecessary coupling for this task; a height-only
 *  radio-horizon check is the documented simplification. */
export function radioLineOfSightNm(aircraftAltFt: number, stationElevFt: number): number {
  return 1.23 * (Math.sqrt(Math.max(aircraftAltFt, 0)) + Math.sqrt(Math.max(stationElevFt, 0)))
}

/** Whether a station's signal reaches the aircraft: within both the
 *  published service volume and the radio line-of-sight range. */
export function signalReceivable(rangeNm: number, serviceVolumeNm: number, losNm: number): boolean {
  return rangeNm <= serviceVolumeNm && rangeNm <= losNm
}

// ---- marker beacons ----

export type MarkerName = 'OM' | 'MM' | 'IM'

export interface MarkerBeacon {
  name: MarkerName
  position: LatLon
}

/** Typical marker-beacon distances from threshold along the approach
 *  course. Real installations vary by procedure; navaids.csv carries no
 *  marker-beacon position data (checked: the CSV's `type` column has no
 *  OM/MM/IM rows), so these are flagged representative distances rather
 *  than sourced per-approach data:
 *   - Outer marker (OM): commonly 4-7 NM from threshold (5 NM used here).
 *   - Middle marker (MM): commonly ~3,500 ft from threshold.
 *   - Inner marker (IM), where installed: close to the threshold, ~1,000 ft.
 */
export const OUTER_MARKER_DIST_NM = 5
export const MIDDLE_MARKER_DIST_FT = 3500
export const INNER_MARKER_DIST_FT = 1000

const M_PER_NM = 1852

/** Project a point `distM` meters along `bearingDegFrom` from a lat/lon,
 *  using the same flat-earth approximation `server/parse.mjs`'s `project()`
 *  uses for runway-end reconstruction (fine at these short distances). */
function projectLatLon(origin: LatLon, bearingDegFrom: number, distM: number): LatLon {
  const mLat = 111_319.5
  const mLon = mLat * Math.cos((origin.lat * Math.PI) / 180)
  const h = (bearingDegFrom * Math.PI) / 180
  return { lat: origin.lat + (Math.cos(h) * distM) / mLat, lon: origin.lon + (Math.sin(h) * distM) / mLon }
}

/** Build the outer/middle (and optionally inner) marker positions for an
 *  ILS approach, placed along the extended centerline behind the threshold. */
export function makeMarkerBeacons(ils: IlsRef, includeInner = false): MarkerBeacon[] {
  const backCourse = (ils.courseDeg + 180) % 360
  const beacons: MarkerBeacon[] = [
    { name: 'OM', position: projectLatLon(ils.threshold, backCourse, OUTER_MARKER_DIST_NM * M_PER_NM) },
    { name: 'MM', position: projectLatLon(ils.threshold, backCourse, MIDDLE_MARKER_DIST_FT * 0.3048) },
  ]
  if (includeInner) {
    beacons.push({ name: 'IM', position: projectLatLon(ils.threshold, backCourse, INNER_MARKER_DIST_FT * 0.3048) })
  }
  return beacons
}

/** Marker cone half-angle: real marker-beacon antennas radiate a fan-shaped
 *  pattern, commonly cited as producing a beam roughly 2,400-4,200 ft wide
 *  under the aircraft at typical approach altitudes. There's no single
 *  authoritative half-angle figure in this repo, so a representative 40°
 *  half-angle cone (flagged assumption) stands in: cone radius grows with
 *  aircraft height above the beacon. */
export const MARKER_CONE_HALF_ANGLE_DEG = 40

/** True while the aircraft is within a marker beacon's reception cone
 *  (simple radius-vs-height check, no fade/partial reception modeled). */
export function markerBeaconActive(beacon: MarkerBeacon, aircraft: LatLon, aircraftAglFt: number): boolean {
  if (aircraftAglFt <= 0) return false
  const groundM = distanceM(beacon.position, aircraft)
  const aglM = aircraftAglFt * 0.3048
  const coneRadiusM = aglM * Math.tan((MARKER_CONE_HALF_ANGLE_DEG * Math.PI) / 180)
  return groundM <= coneRadiusM
}

// ---- Morse-code ident timeline ----

/** International Morse code, A-Z and 0-9 — public-domain standard, not an
 *  invented table. */
const MORSE_CODE: Record<string, string> = {
  A: '.-', B: '-...', C: '-.-.', D: '-..', E: '.', F: '..-.', G: '--.', H: '....',
  I: '..', J: '.---', K: '-.-', L: '.-..', M: '--', N: '-.', O: '---', P: '.--.',
  Q: '--.-', R: '.-.', S: '...', T: '-', U: '..-', V: '...-', W: '.--', X: '-..-',
  Y: '-.--', Z: '--..',
  '0': '-----', '1': '.----', '2': '..---', '3': '...--', '4': '....-',
  '5': '.....', '6': '-....', '7': '--...', '8': '---..', '9': '----.',
}

export interface MorseSegment {
  on: boolean
  durationMs: number
}

/** Default Morse unit duration. Real navaid ident keying speed varies by
 *  equipment; ~150 ms/unit (~ 8 wpm equivalent by the standard PARIS timing
 *  formula) was picked as a representative, slow, easily-readable cadence
 *  typical of VOR/NDB/ILS idents — flagged as an assumption, not a sourced
 *  spec figure. */
export const DEFAULT_MORSE_UNIT_MS = 150

/**
 * Pure dit/dah on/off keying timeline for a station ident, standard
 * International Morse timing: dit = 1 unit on, dah = 3 units on,
 * intra-character gap = 1 unit off, inter-character gap = 3 units off.
 * Unknown characters (anything outside A-Z0-9) are skipped. Actual audio
 * synthesis/playback is Phase 9 — this only produces the timing data.
 */
export function morseTimeline(ident: string, unitMs = DEFAULT_MORSE_UNIT_MS): MorseSegment[] {
  const segments: MorseSegment[] = []
  const chars = [...ident.toUpperCase()].filter((ch) => MORSE_CODE[ch] !== undefined)
  chars.forEach((ch, ci) => {
    const code = MORSE_CODE[ch]!
    ;[...code].forEach((sym, si) => {
      segments.push({ on: true, durationMs: sym === '.' ? unitMs : unitMs * 3 })
      if (si < code.length - 1) segments.push({ on: false, durationMs: unitMs })
    })
    if (ci < chars.length - 1) segments.push({ on: false, durationMs: unitMs * 3 })
  })
  return segments
}
