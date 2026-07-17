/**
 * OurAirports CSV → compact US airport JSON (pure functions, unit-tested).
 * Output per airport: { i: ident, n: name, la, lo, e: elevFt, r: [runway] }
 * runway: { li, hi, la1, lo1, la2, lo2, l: lengthFt, w: widthFt,
 *           s: 0 hard | 1 soft, lt: 0|1 lighted }
 */

/** Minimal CSV line splitter with quoted-field support. */
export function splitCsvLine(line) {
  const out = []
  let cur = ''
  let inQ = false
  for (let i = 0; i < line.length; i++) {
    const ch = line[i]
    if (inQ) {
      if (ch === '"' && line[i + 1] === '"') { cur += '"'; i++ }
      else if (ch === '"') inQ = false
      else cur += ch
    } else if (ch === '"') inQ = true
    else if (ch === ',') { out.push(cur); cur = '' }
    else cur += ch
  }
  out.push(cur)
  return out
}

export function parseCsv(text) {
  const lines = text.split('\n').filter((l) => l.trim().length > 0)
  const header = splitCsvLine(lines[0])
  const idx = Object.fromEntries(header.map((h, i) => [h.trim(), i]))
  return { idx, rows: lines.slice(1).map(splitCsvLine) }
}

const HARD_SURFACES = /asp|con|pem|paved|bit|tar/i

/** Project a point `distM` meters along `headingDeg` from lat/lon. */
function project(lat, lon, headingDeg, distM) {
  const mLat = 111_319.5
  const mLon = mLat * Math.cos((lat * Math.PI) / 180)
  const h = (headingDeg * Math.PI) / 180
  return [lat + (Math.cos(h) * distM) / mLat, lon + (Math.sin(h) * distM) / mLon]
}

export function buildUsAirports(airportsCsv, runwaysCsv) {
  const a = parseCsv(airportsCsv)
  const r = parseCsv(runwaysCsv)
  const ai = a.idx
  const ri = r.idx

  const byIdent = new Map()
  for (const row of a.rows) {
    if (row[ai.iso_country] !== 'US') continue
    const type = row[ai.type]
    if (type !== 'small_airport' && type !== 'medium_airport' && type !== 'large_airport') continue
    const lat = parseFloat(row[ai.latitude_deg])
    const lon = parseFloat(row[ai.longitude_deg])
    if (!isFinite(lat) || !isFinite(lon)) continue
    byIdent.set(row[ai.ident], {
      i: row[ai.ident],
      n: row[ai.name],
      la: +lat.toFixed(5),
      lo: +lon.toFixed(5),
      e: Math.round(parseFloat(row[ai.elevation_ft]) || 0),
      t: type === 'large_airport' ? 2 : type === 'medium_airport' ? 1 : 0,
      r: [],
    })
  }

  for (const row of r.rows) {
    const ap = byIdent.get(row[ri.airport_ident])
    if (!ap) continue
    if (row[ri.closed] === '1') continue
    const lengthFt = parseFloat(row[ri.length_ft]) || 0
    if (lengthFt < 800) continue
    let la1 = parseFloat(row[ri.le_latitude_deg])
    let lo1 = parseFloat(row[ri.le_longitude_deg])
    let la2 = parseFloat(row[ri.he_latitude_deg])
    let lo2 = parseFloat(row[ri.he_longitude_deg])
    const heading = parseFloat(row[ri.le_heading_degT])
    const lengthM = lengthFt * 0.3048
    const has1 = isFinite(la1) && isFinite(lo1)
    const has2 = isFinite(la2) && isFinite(lo2)
    if (!has1 && !has2) {
      if (!isFinite(heading)) continue
      ;[la1, lo1] = project(ap.la, ap.lo, heading + 180, lengthM / 2)
      ;[la2, lo2] = project(ap.la, ap.lo, heading, lengthM / 2)
    } else if (!has2) {
      if (!isFinite(heading)) continue
      ;[la2, lo2] = project(la1, lo1, heading, lengthM)
    } else if (!has1) {
      if (!isFinite(heading)) continue
      ;[la1, lo1] = project(la2, lo2, heading + 180, lengthM)
    }
    ap.r.push({
      li: row[ri.le_ident] || '',
      hi: row[ri.he_ident] || '',
      la1: +la1.toFixed(5),
      lo1: +lo1.toFixed(5),
      la2: +la2.toFixed(5),
      lo2: +lo2.toFixed(5),
      e1: Math.round(parseFloat(row[ri.le_elevation_ft]) || ap.e),
      e2: Math.round(parseFloat(row[ri.he_elevation_ft]) || ap.e),
      l: Math.round(lengthFt),
      w: Math.round(parseFloat(row[ri.width_ft]) || 75),
      s: HARD_SURFACES.test(row[ri.surface] || '') ? 0 : 1,
      lt: row[ri.lighted] === '1' ? 1 : 0,
    })
  }

  return [...byIdent.values()].filter((ap) => ap.r.length > 0)
}

/**
 * OurAirports navaids.csv → compact US VOR/NDB JSON (pure, unit-tested).
 * Real schema (confirmed against the live CSV, Phase 4 Task 1):
 *   id, filename, ident, name, type, frequency_khz, latitude_deg,
 *   longitude_deg, elevation_ft, iso_country, dme_frequency_khz,
 *   dme_channel, dme_latitude_deg, dme_longitude_deg, dme_elevation_ft,
 *   slaved_variation_deg, magnetic_variation_deg, usageType, power,
 *   associated_airport
 * `type` observed values (US rows): VOR, VOR-DME, VORTAC, TACAN, DME, NDB,
 * NDB-DME. `frequency_khz` is genuinely kHz for every type — a VOR at
 * 115.800 MHz is stored as 115800, an NDB at 373 kHz is stored as 373, so no
 * unit correction is needed, only formatting on display (VOR/TACAN divide by
 * 1000 for MHz, NDB stays as kHz). Most VOR-DME/VORTAC rows have blank
 * dme_latitude_deg/dme_longitude_deg — that means the DME is co-located with
 * the VOR (same lat/lon), not that it's missing; only ~29 US rows carry a
 * distinct DME antenna position, so fall back to the primary lat/lon when
 * the DME fields are blank.
 *
 * Output per navaid: { i: ident, n: name, t: type-code, la, lo, e: elevFt,
 *   f: frequency_khz (or NDB kHz), dla, dlo, de: DME elevFt (all three only
 *   present when the station carries a DME/TACAN component), mv: magnetic
 *   variation deg (signed, station declination) }
 * `t` type codes: 0 VOR, 1 VOR-DME, 2 VORTAC, 3 TACAN, 4 DME, 5 NDB,
 * 6 NDB-DME. Unknown/other types are dropped.
 */
const NAVAID_TYPE_CODE = {
  VOR: 0, 'VOR-DME': 1, VORTAC: 2, TACAN: 3, DME: 4, NDB: 5, 'NDB-DME': 6,
}

/** Does this navaid type carry a DME/TACAN distance component? */
const HAS_DME = new Set(['VOR-DME', 'VORTAC', 'TACAN', 'DME', 'NDB-DME'])

export function buildUsNavaids(navaidsCsv) {
  const { idx, rows } = parseCsv(navaidsCsv)
  const out = []
  for (const row of rows) {
    if (row[idx.iso_country] !== 'US') continue
    const type = row[idx.type]
    const t = NAVAID_TYPE_CODE[type]
    if (t === undefined) continue
    const lat = parseFloat(row[idx.latitude_deg])
    const lon = parseFloat(row[idx.longitude_deg])
    if (!isFinite(lat) || !isFinite(lon)) continue
    const freq = parseFloat(row[idx.frequency_khz])
    const entry = {
      i: row[idx.ident],
      n: row[idx.name],
      t,
      la: +lat.toFixed(5),
      lo: +lon.toFixed(5),
      e: Math.round(parseFloat(row[idx.elevation_ft]) || 0),
      f: isFinite(freq) ? freq : 0,
    }
    const mv = parseFloat(row[idx.magnetic_variation_deg])
    if (isFinite(mv)) entry.mv = mv
    if (HAS_DME.has(type)) {
      const dLat = parseFloat(row[idx.dme_latitude_deg])
      const dLon = parseFloat(row[idx.dme_longitude_deg])
      const dElev = parseFloat(row[idx.dme_elevation_ft])
      entry.dla = isFinite(dLat) ? +dLat.toFixed(5) : entry.la
      entry.dlo = isFinite(dLon) ? +dLon.toFixed(5) : entry.lo
      entry.de = isFinite(dElev) ? Math.round(dElev) : entry.e
    }
    out.push(entry)
  }
  return out
}

/**
 * FAA CIFP (`FAACIFP18`) → compact per-airport SID/STAR/approach procedure
 * JSON (Phase 4 Task 4, §24/§10). This is a fixed-width ARINC 424 record
 * format with NO official machine-readable spec bundled in the FAA's CIFP
 * distribution (only PDFs) — the field layout below was reverse-engineered
 * directly from real records (KSFO's "H28RY" = ILS 28R approach, plus real
 * SID/STAR/waypoint/runway records fetched from the live
 * CIFP_260709.zip / FAACIFP18 file, cycle 2607) via careful column counting,
 * NOT from an external spec document. See
 * docs/plans/phase-4-task4-report.md for the full derivation and cited
 * sample lines.
 *
 * Record layout confirmed from real data (0-based JS string indices):
 *   [0,5)   "SUSAP" — record type S + customer/area code USA + section P
 *           (airport). Only these US airport-section records are parsed;
 *           other customer codes (Canada, Mexico, Pacific, etc. also ship
 *           in the same file) are skipped.
 *   [6,10)  airport ICAO ident, e.g. "KSFO"
 *   [10,12) ICAO region code, e.g. "K2" (unused)
 *   [12,13) subsection code — this is what distinguishes record purpose
 *           under the airport section. Empirically confirmed (by grepping
 *           real KSFO records and counting how many of each letter appear):
 *             D = SID, E = STAR, F = Approach (IAP) — the three procedure
 *                 subsections this parser extracts.
 *             C = terminal waypoint/fix definition (ident + lat/lon) —
 *                 used only to resolve leg fix coordinates, not exposed as
 *                 procedures.
 *             G = runway threshold definition (ident + lat/lon) — used
 *                 only to resolve "RW28R"-style runway references on final
 *                 approach legs.
 *             (A, I, P, S also appear under an airport but are not
 *             procedure/waypoint/runway records we need — not parsed.)
 *   [13,19) procedure identifier (6 chars, space-padded), e.g. "H28RY " or
 *           "CIITY3" (SID name+version). For D/E/F records only.
 *   [19,20) route type (1 char) — real ARINC 424 route-type codes are
 *           letters for approach transitions (e.g. "A" = a named approach
 *           transition, "H" = the common/final segment all transitions feed
 *           into) and digits for SID/STAR route classifications (e.g. "4" =
 *           enroute transition). This parser does not decode route-type
 *           semantics; it only uses whether the transition-ident field
 *           (next) is blank to distinguish "common" segments from named
 *           transitions, which is confirmed reliable from every real sample
 *           examined.
 *   [20,25) transition identifier (5 chars, space-padded) — blank (after
 *           trim) marks the shared "common" segment/final routing.
 *   [26,29) leg sequence number within this transition, e.g. "010","020"
 *   [29,34) fix identifier this leg references (5 chars)
 *   [34,36) fix's ICAO region (unused)
 *   [36,37) fix's section code (unused)
 *   [37,38) fix's subsection code (unused directly, but empirically 'C'
 *           for waypoints and 'G' for runway thresholds — confirms the
 *           waypoint-index lookup below is hitting the right table)
 *   [43,44) turn direction (1 char: 'L'/'R', blank = unspecified/either) —
 *           only meaningful for RF/holding legs, out of scope for most of
 *           this parser but captured when present.
 *   [44,47) RNP (3 digits) — real values observed ("010","031") don't map
 *           cleanly onto standard published RNP figures (0.3/1.0/2.0) from
 *           a 3-digit-with-implied-decimal reading; left OPAQUE/unparsed
 *           (a flagged, time-boxed assumption — not required for the leg
 *           types this task implements).
 *   [47,49) Path & Termination — the ARINC 424 *leg type* code (e.g. "IF",
 *           "TF", "CF", "DF", "CA", "RF", "HM", "VA", "FM"...). This is the
 *           single most-verified field in this whole parser: checked
 *           against dozens of real KSFO ILS 28R / SID / STAR lines at this
 *           exact fixed column position throughout.
 *   [50,54) recommended navaid ident (4 chars) — a VOR/NDB reference used
 *           by some CF/RF legs for theta/rho; captured but not resolved to
 *           coordinates (out of scope: would require also parsing the
 *           enroute/terminal navaid subsections).
 *   [54,56) recommended navaid's ICAO region (unused)
 *   [62,66) theta — bearing from the recommended navaid, tenths of a
 *           degree (unused directly; theta/rho give an alternate fix
 *           definition this parser doesn't need since waypoint lat/lon
 *           already come from the subsection-C table)
 *   [66,70) rho — distance from the recommended navaid, tenths of an nm
 *           (unused directly, see above)
 *   [70,74) magnetic course, tenths of a degree, e.g. "0900" = 090.0°,
 *           "2837" = 283.7° — this is the leg's specified course, used by
 *           CF/CA/FA/holding legs.
 *   [74,78) route distance / holding leg length, tenths — nm if the next
 *           field is 'D', minutes if 'T'. For the KSFO holds sampled here
 *           this trailing flag was blank; nm was chosen as the more
 *           plausible reading (a 4.0-elsewhere-minute hold leg would be
 *           unusually long) — a flagged, time-boxed best guess.
 *   [78,79) distance/time flag ('D'=nm, 'T'=minutes, blank=ambiguous, see
 *           above)
 *   [82,83) altitude description: '+' at-or-above, '-' at-or-below, 'B'
 *           between (Altitude 1 = upper bound, Altitude 2 = lower bound —
 *           confirmed from real STAR legs like ALWYS "B FL260FL220", where
 *           FL260 > FL220), blank = at (exact crossing altitude).
 *   [84,89) Altitude 1 (5 chars: either raw feet "07000" or flight level
 *           "FL270" = FL270*100 ft)
 *   [89,94) Altitude 2 (5 chars, same format) — only meaningful when the
 *           altitude description is 'B'.
 *   [94,99) NOT parsed. On the very first leg of every named transition,
 *           this consistently shows "18000" — the exact, well-known US
 *           standard transition altitude — while never appearing on
 *           subsequent legs of the same transition. Read as the
 *           procedure's (constant, header-level) Transition Altitude field
 *           rather than a genuine per-leg second altitude ceiling; not
 *           modeled as a leg constraint to avoid mis-representing it.
 *   [99,102) speed limit, knots (3 digits, e.g. "240")
 *   [102,106) vertical angle, hundredths of a degree, signed (e.g. "-300"
 *           = -3.00°, confirmed against the real ILS 28R glidepath which
 *           is a standard 3° final segment).
 *   [106,111) a second recommended-navaid-or-runway field (5 chars) — when
 *           it starts with "RW" (e.g. "RW28R"), this is the runway this
 *           leg's final segment serves; resolved to coordinates via the
 *           subsection-G runway table.
 *
 * Waypoint (subsection C) and runway (subsection G) support records share
 * the identifier/coordinate layout:
 *   [13,18) ident (5 chars)
 *   [32,41) latitude: 1-char hemisphere (N/S) + 8 digits DDMMSSss (degrees,
 *           minutes, seconds, hundredths-of-a-second)
 *   [41,51) longitude: 1-char hemisphere (E/W) + 9 digits DDDMMSSss (3-digit
 *           degrees since longitude runs to 180)
 *   Verified against KSFO's real ARCHI fix ("N37292687W121523195" decodes
 *   to ~37.4908, -121.8755, matching ARCHI's real published position on the
 *   ILS 28R approach) and KSFO runway thresholds.
 *
 * NOT implemented / explicitly scoped out (see phase-4-task4-report.md):
 *   - Leg types VA, VM, VI, FM, RF (present in real KSFO SIDs/STARs/
 *     approaches but not in this task's required subset of
 *     IF/TF/CF/DF/CA/FA + simplified HM/HA/HF holds). These are still
 *     captured as raw leg records (type string + fix/course/altitude where
 *     present) so callers can see they exist, but `procedures.ts`'s
 *     interpreter does not know how to fly them.
 *   - Full procedure assembly (which runway-transition + common +
 *     enroute-transition legs chain together for a given runway) — CIFP
 *     stores transitions as independent named segments; this parser
 *     preserves that structure (a procedure has multiple named
 *     transitions, one of which — the blank-name one — is the shared
 *     "common" segment) and `procedures.ts` provides a small
 *     `assembleProcedureLegs` helper to concatenate a chosen transition
 *     with the common segment.
 */

const CIFP_MIN_LEG_LEN = 111
const CIFP_MIN_WP_LEN = 51

/** ARINC 424 procedure subsection → numeric procedure-type code. */
const CIFP_PROC_TYPE = { D: 0, E: 1, F: 2 }

function parseTenths(raw) {
  const s = raw.trim()
  if (!s) return undefined
  const n = parseInt(s, 10)
  return isFinite(n) ? n / 10 : undefined
}

function parseIntOrUndef(raw) {
  const s = raw.trim()
  if (!s) return undefined
  const n = parseInt(s, 10)
  return isFinite(n) ? n : undefined
}

/** Decode one ARINC 424 altitude field: raw feet ("07000") or flight level
 *  ("FL270" → 27000 ft). Returns undefined for a blank field. */
function decodeCifpAltitude(raw) {
  const s = raw.trim()
  if (!s) return undefined
  if (s.startsWith('FL')) {
    const n = parseInt(s.slice(2), 10)
    return isFinite(n) ? n * 100 : undefined
  }
  const n = parseInt(s, 10)
  return isFinite(n) ? n : undefined
}

/** Decode one ARINC 424 vertical-angle field ("-300" → -3.00 degrees). */
function decodeVerticalAngle(raw) {
  const s = raw.trim()
  if (!s) return undefined
  const n = parseInt(s, 10)
  return isFinite(n) ? n / 100 : undefined
}

/**
 * Decode ARINC 424 lat/lon fields:
 *   lat: 1-char hemisphere (N/S) + DDMMSSss (8 digits)
 *   lon: 1-char hemisphere (E/W) + DDDMMSSss (9 digits)
 * Returns undefined if either field doesn't parse as digits.
 */
export function parseCifpCoord(latField, lonField) {
  if (latField.length < 9 || lonField.length < 10) return undefined
  const latHemi = latField[0]
  const lonHemi = lonField[0]
  const latDigits = latField.slice(1, 9)
  const lonDigits = lonField.slice(1, 10)
  if (!/^\d{8}$/.test(latDigits) || !/^\d{9}$/.test(lonDigits)) return undefined
  const latDd = parseInt(latDigits.slice(0, 2), 10)
  const latMm = parseInt(latDigits.slice(2, 4), 10)
  const latSs = parseInt(latDigits.slice(4, 6), 10)
  const latHh = parseInt(latDigits.slice(6, 8), 10)
  const lonDdd = parseInt(lonDigits.slice(0, 3), 10)
  const lonMm = parseInt(lonDigits.slice(3, 5), 10)
  const lonSs = parseInt(lonDigits.slice(5, 7), 10)
  const lonHh = parseInt(lonDigits.slice(7, 9), 10)
  const lat = (latDd + latMm / 60 + (latSs + latHh / 100) / 3600) * (latHemi === 'S' ? -1 : 1)
  const lon = (lonDdd + lonMm / 60 + (lonSs + lonHh / 100) / 3600) * (lonHemi === 'W' ? -1 : 1)
  return { la: +lat.toFixed(6), lo: +lon.toFixed(6) }
}

/**
 * Build a `${airportIdent}|${fixIdent}` → {la,lo} lookup table from the
 * CIFP's terminal-waypoint (subsection C) and runway (subsection G)
 * records. Used to resolve procedure-leg fix idents to coordinates.
 */
export function buildCifpWaypoints(cifpText) {
  const map = new Map()
  const lines = cifpText.split('\n')
  for (const line of lines) {
    if (line.length < CIFP_MIN_WP_LEN) continue
    if (line.slice(0, 5) !== 'SUSAP') continue
    const sub = line[12]
    if (sub !== 'C' && sub !== 'G') continue
    const airport = line.slice(6, 10).trim()
    const ident = line.slice(13, 18).trim()
    if (!airport || !ident) continue
    const coord = parseCifpCoord(line.slice(32, 41), line.slice(41, 51))
    if (!coord) continue
    map.set(`${airport}|${ident}`, coord)
  }
  return map
}

/**
 * Parse the FAA CIFP `FAACIFP18` fixed-width file into per-airport
 * SID/STAR/approach procedures (pure, unit-tested). See the file-header
 * comment above for the full field-position derivation and citations.
 *
 * Output: Map<airportIdent, Procedure[]>, where
 *   Procedure = { y: 0 SID | 1 STAR | 2 APPCH, n: procedure ident,
 *                 t: [{ tn: transition name ('' = common/final segment),
 *                       l: [Leg...] }] }
 *   Leg = { s: seq, ty: leg-type string (e.g. "IF","TF","CF","DF","CA",
 *           "HM", raw/unsupported types passed through), f: fix ident,
 *           la?, lo? (only if resolved via the waypoint table), td?: turn
 *           direction, c?: course deg, d?: distance nm (only when the
 *           distance/time flag was 'D' or blank — see header comment), ad?:
 *           altitude description, a1?/a2?: altitude ft, sp?: speed limit
 *           kt, va?: vertical angle deg, rw?: runway ident + coordinates
 *           if this leg's runway-reference field resolved. }
 */
export function buildCifpProcedures(cifpText) {
  const waypoints = buildCifpWaypoints(cifpText)
  const lines = cifpText.split('\n')
  // airport -> procIdent -> { y, n, transitions: Map<tn, legs[]> }
  const byAirport = new Map()

  for (const line of lines) {
    if (line.length < CIFP_MIN_LEG_LEN) continue
    if (line.slice(0, 5) !== 'SUSAP') continue
    const sub = line[12]
    const y = CIFP_PROC_TYPE[sub]
    if (y === undefined) continue

    const airport = line.slice(6, 10).trim()
    const procIdent = line.slice(13, 19).trim()
    const transitionName = line.slice(20, 25).trim()
    const seq = parseIntOrUndef(line.slice(26, 29)) ?? 0
    const fixIdent = line.slice(29, 34).trim()
    const turnDirection = line.slice(43, 44).trim() || undefined
    const legType = line.slice(47, 49).trim()
    const course = parseTenths(line.slice(70, 74))
    const distTenths = parseTenths(line.slice(74, 78))
    const distFlag = line[78]
    const altDesc = line.slice(82, 83).trim() || undefined
    const alt1 = decodeCifpAltitude(line.slice(84, 89))
    const alt2 = decodeCifpAltitude(line.slice(89, 94))
    const speed = parseIntOrUndef(line.slice(99, 102))
    const va = decodeVerticalAngle(line.slice(102, 106))
    const rwField = line.slice(106, 111).trim()

    if (!airport || !procIdent || !legType) continue

    let airportProcs = byAirport.get(airport)
    if (!airportProcs) {
      airportProcs = new Map()
      byAirport.set(airport, airportProcs)
    }
    const key = `${y}|${procIdent}`
    let proc = airportProcs.get(key)
    if (!proc) {
      proc = { y, n: procIdent, transitions: new Map() }
      airportProcs.set(key, proc)
    }
    let legs = proc.transitions.get(transitionName)
    if (!legs) {
      legs = []
      proc.transitions.set(transitionName, legs)
    }

    const leg = { s: seq, ty: legType, f: fixIdent }
    const fixCoord = fixIdent ? waypoints.get(`${airport}|${fixIdent}`) : undefined
    if (fixCoord) {
      leg.la = fixCoord.la
      leg.lo = fixCoord.lo
    }
    if (turnDirection) leg.td = turnDirection
    if (course !== undefined) leg.c = course
    // Distance/time flag: 'D' = nm (parse); 'T' = minutes (not modeled as
    // nm — leave undefined rather than mis-scale); blank = ambiguous, see
    // header comment — treated as nm (best-guess, flagged).
    if (distTenths !== undefined && distFlag !== 'T') leg.d = distTenths
    if (altDesc) leg.ad = altDesc
    if (alt1 !== undefined) leg.a1 = alt1
    if (alt2 !== undefined) leg.a2 = alt2
    if (speed !== undefined) leg.sp = speed
    if (va !== undefined) leg.va = va
    if (rwField.startsWith('RW')) {
      leg.rw = rwField
      const rwCoord = waypoints.get(`${airport}|${rwField}`)
      if (rwCoord) {
        leg.rwla = rwCoord.la
        leg.rwlo = rwCoord.lo
      }
    }
    legs.push(leg)
  }

  const out = new Map()
  for (const [airport, procs] of byAirport) {
    const list = []
    for (const proc of procs.values()) {
      const transitions = [...proc.transitions.entries()]
        .map(([tn, legs]) => ({ tn, l: legs.slice().sort((a, b) => a.s - b.s) }))
        .sort((a, b) => a.tn.localeCompare(b.tn))
      list.push({ y: proc.y, n: proc.n, t: transitions })
    }
    out.set(airport, list)
  }
  return out
}
