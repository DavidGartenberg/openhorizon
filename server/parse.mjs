/**
 * OurAirports CSV → compact US airport JSON (pure functions, unit-tested).
 * Output per airport: { i: ident, n: name, la, lo, e: elevFt, r: [runway] }
 * runway: { li, hi, la1, lo1, la2, lo2, l: lengthFt, w: widthFt,
 *           s: 0 hard | 1 soft, lt: 0|1 lighted }
 */

/** True when the buffer starts with JPEG or PNG magic bytes (13b: the
 *  imagery disk cache must never hold an upstream error page). */
export function isImageBuf(buf) {
  const jpeg = buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff
  const png = buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47
  return jpeg || png
}

// ---- ADS-B provider normalization (Phase 14a) ----
// One wire shape out of three free feeds: adsb.lol and adsb.fi speak the
// readsb/tar1090 aircraft.json dialect; OpenSky anon speaks its states
// array. Rows without a position are dropped (a target you can't place
// is noise). Output: {ac:[{id, cs, t, lat, lon, altFt, gnd, gsKt, trk,
// vsFpm, ageS}], ts(ms epoch)} — never throws on malformed payloads.

const M_TO_FT = 1 / 0.3048
const MS_TO_KT = 1 / 0.514444

function tar1090Row(a) {
  if (typeof a?.lat !== 'number' || typeof a?.lon !== 'number') return null
  const gnd = a.alt_baro === 'ground'
  return {
    id: String(a.hex ?? ''),
    cs: String(a.flight ?? '').trim(),
    t: String(a.t ?? ''),
    lat: a.lat,
    lon: a.lon,
    altFt: gnd ? 0 : Math.round(typeof a.alt_baro === 'number' ? a.alt_baro : 0),
    gnd,
    gsKt: Math.round(typeof a.gs === 'number' ? a.gs : 0),
    trk: Math.round(typeof a.track === 'number' ? a.track : 0),
    vsFpm: Math.round(typeof a.baro_rate === 'number' ? a.baro_rate : 0),
    ageS: typeof a.seen_pos === 'number' ? a.seen_pos : (typeof a.seen === 'number' ? a.seen : 0),
  }
}

function openskyRow(s, nowS) {
  if (!Array.isArray(s) || typeof s[5] !== 'number' || typeof s[6] !== 'number') return null
  const gnd = s[8] === true
  return {
    id: String(s[0] ?? ''),
    cs: String(s[1] ?? '').trim(),
    t: '', // OpenSky carries no type designator
    lat: s[6],
    lon: s[5],
    altFt: gnd || typeof s[7] !== 'number' ? 0 : Math.round(s[7] * M_TO_FT),
    gnd,
    gsKt: Math.round(typeof s[9] === 'number' ? s[9] * MS_TO_KT : 0),
    trk: Math.round(typeof s[10] === 'number' ? s[10] : 0),
    vsFpm: Math.round(typeof s[11] === 'number' ? s[11] * M_TO_FT * 60 : 0),
    ageS: typeof s[3] === 'number' ? Math.max(nowS - s[3], 0) : 0,
  }
}

export function normalizeAdsb(json, provider) {
  try {
    if (provider === 'opensky') {
      const nowS = typeof json?.time === 'number' ? json.time : Date.now() / 1000
      const rows = Array.isArray(json?.states) ? json.states : []
      return { ac: rows.map((s) => openskyRow(s, nowS)).filter(Boolean), ts: Math.round(nowS * 1000) }
    }
    // adsb.lol / adsb.fi (readsb "now" is seconds; guard against ms).
    const now = typeof json?.now === 'number' ? json.now : Date.now() / 1000
    const rows = Array.isArray(json?.ac) ? json.ac : []
    return { ac: rows.map(tar1090Row).filter(Boolean), ts: Math.round(now < 1e12 ? now * 1000 : now) }
  } catch {
    return { ac: [], ts: Date.now() }
  }
}

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

/**
 * FAA airspace boundaries (Class B/C/D/E-surface + Special Use Airspace) →
 * compact JSON (Phase 4 Task 5, §6.5). Real source: the FAA's ArcGIS
 * open-data REST API (confirmed reachable this session, clean GeoJSON, no
 * shapefile parsing needed):
 *   Class Airspace: https://services6.arcgis.com/ssFJjBXIUyZDrSYZ/arcgis/rest/services/Class_Airspace/FeatureServer/0/query?where=1=1&outFields=*&f=geojson
 *   Special Use Airspace: https://services6.arcgis.com/ssFJjBXIUyZDrSYZ/arcgis/rest/services/Special_Use_Airspace/FeatureServer/0/query?where=1=1&outFields=*&f=geojson
 * Both paginate (server `maxRecordCount` 2000; `handlers.mjs`'s fetcher
 * pages in smaller 500-feature chunks with retries — larger single
 * requests were observed to intermittently truncate mid-transfer during
 * this task's real-data verification). This function takes the
 * already-paginated, already-merged GeoJSON `Feature[]` arrays (one array
 * per source) and produces the compact representation; it does no
 * networking itself so it's plain-Node-testable against small real
 * fixtures.
 *
 * Class Airspace fields used: `NAME`, `ICAO_ID`, `LOCAL_TYPE` (drives the
 * class code below — the plainer `CLASS` field is coarser: e.g. real
 * `CLASS_E2`/`CLASS_E3`/`CLASS_E5` records all report `CLASS: "E"`, but
 * only E2 is the surface-based Class E this task renders/detects, per the
 * phase plan's "Class E-surface" scope. `LOCAL_TYPE` is the actual, sole
 * discriminator — `LOWER_CODE` does NOT reliably distinguish E2 from E5:
 * live data shows real "SAN FRANCISCO CLASS E5" records also report
 * `LOWER_CODE: "SFC"` (with a nonzero `LOWER_VAL`, e.g. 700/1200 ft) even
 * though E5 isn't surface-based, so `LOWER_CODE` alone would misclassify
 * them. The parser keys off `LOCAL_TYPE` only, never `LOWER_CODE`, for
 * this distinction), `UPPER_VAL`/`UPPER_UOM`/`UPPER_CODE`,
 * `LOWER_VAL`/`LOWER_UOM`/`LOWER_CODE`, `SECTOR` (shelf label — real SF
 * Class B carries 14 shelves, `SECTOR` "AREA A".."AREA Q" minus a few
 * letters, each a separate feature sharing `NAME`/`ICAO_ID` "SAN FRANCISCO
 * CLASS B"/"KSFO").
 *
 * Special Use Airspace fields used: `NAME`, `TYPE_CODE` (confirmed real
 * values: `A` alert, `D` danger, `MOA`, `P` prohibited, `R` restricted, `W`
 * warning — `P` already appears in this one feed, so the separate
 * `Prohibited_Areas` FeatureServer mentioned as a fallback wasn't needed),
 * same `UPPER`/`LOWER` triad as Class Airspace.
 *
 * Altitude normalization to feet MSL, per the real `LOWER_CODE`/
 * `UPPER_CODE` values actually observed across both feeds:
 *   `'SFC'`        -> 0 ft, regardless of `VAL` (`VAL` is `"0"`/`0` anyway)
 *   `'UNLTD'`, or any record where `VAL` parses negative (a real `-9998`
 *              placeholder was observed both explicitly under `UNLTD` and
 *              once under a `null` code on a real Class E2 record and a
 *              real SUA record) -> `CEILING_UNLIMITED_FT` sentinel
 *   `'MSL'`/`'STD'`/`null` + uom `'FT'` -> `VAL` directly. (`STD` = based
 *              on standard pressure 29.92 rather than local altimeter
 *              setting, only ever observed above 18000 ft in this data —
 *              treated identically to MSL feet for in-sim detection, a
 *              standard aviation simplification since the sim doesn't
 *              model altimeter-setting-dependent indicated altitude.)
 *   uom `'FL'` -> `VAL * 100` ft (flight level, e.g. real "FL180"-style
 *              row: `LOWER_VAL: "180", LOWER_UOM: "FL"` -> 18000 ft)
 * Flagged assumption: real Class E2 "surface area" records carry no
 * explicit ceiling in the source data (they extend up to wherever the
 * overlying controlled-airspace structure begins) — rendered/detected here
 * with the same `CEILING_UNLIMITED_FT` sentinel as genuinely unlimited SUA.
 * That's conservative for in-airspace detection (never under-reports
 * "you're in controlled airspace") but technically overstates a real E2's
 * vertical extent; a real implementation would need the local Class
 * B/C/D/E(700ft) structure it hands off to, which isn't in this feed.
 *
 * Polygon simplification: several real polygons in this feed carry
 * extreme, survey-grade vertex density (one real Class Airspace polygon
 * sampled had 16904 ring points; 500 real Class Airspace features totaled
 * ~920k points, ~34MB of GeoJSON) — far more resolution than a chart-style
 * MFD line needs. `simplifyRing` (standard Douglas-Peucker, well-known and
 * correct) cuts this by ~40x at `AIRSPACE_SIMPLIFY_EPSILON_DEG` (~50m at
 * mid-latitudes — comfortably below what's visually distinguishable on the
 * MFD's map page) while preserving overall shape, keeping the full
 * nationwide compacted dataset in the low single-digit MB range so it can
 * ship as one blob like `airports.json`/`navaids.json` rather than needing
 * a regional split.
 */
export const CEILING_UNLIMITED_FT = 99999

/** `LOCAL_TYPE` -> compact class-airspace kind code. Other real values seen
 *  (`CLASS_A`, `CLASS_E3`/`E4`/`E5`/`E6`, `MODE C`, null) are out of this
 *  task's rendering/detection scope and dropped. */
const CLASS_LOCAL_TYPE_KIND = { CLASS_B: 0, CLASS_C: 1, CLASS_D: 2, CLASS_E2: 3 }

/** SUA `TYPE_CODE` -> compact kind code. */
const SUA_TYPE_KIND = { R: 4, P: 5, MOA: 6, A: 7, W: 8, D: 9 }

/** Kind code -> name, for callers/tests that want a readable label. Index
 *  matches the numeric `k` values assigned above. */
export const AIRSPACE_KIND_NAMES = [
  'CLASS_B', 'CLASS_C', 'CLASS_D', 'CLASS_E_SFC',
  'RESTRICTED', 'PROHIBITED', 'MOA', 'ALERT', 'WARNING', 'DANGER',
]

/** Normalize one FAA floor/ceiling field triad to feet MSL. See the
 *  header-comment derivation above for the real code values handled. */
export function faaAltFt(val, uom, code) {
  const n = typeof val === 'string' ? parseFloat(val) : val
  if (code === 'SFC') return 0
  // 'UNLTD', or the real "-9998" no-data placeholder observed under a null
  // code — checked against a threshold well below any real floor/ceiling
  // (rather than "any negative value") so a genuine below-sea-level floor
  // (e.g. a hypothetical Death-Valley-area surface boundary) would never
  // misfire this sentinel; no such real record was observed in this data,
  // but real Class/SUA floors always use LOWER_CODE 'SFC' rather than an
  // actual negative feet value in practice.
  if (code === 'UNLTD' || !isFinite(n) || n <= -9000) return CEILING_UNLIMITED_FT
  return uom === 'FL' ? n * 100 : n
}

/** Squared perpendicular distance from point `p` to the line through `a`/`b`
 *  (plain-degree units — adequate at the small epsilon this task uses; not
 *  a geodesic distance, a documented simplification for a simplification
 *  tolerance). */
function perpDistSq(px, py, ax, ay, bx, by) {
  const dx = bx - ax
  const dy = by - ay
  const lenSq = dx * dx + dy * dy
  if (lenSq === 0) return (px - ax) ** 2 + (py - ay) ** 2
  const t = ((px - ax) * dx + (py - ay) * dy) / lenSq
  const cx = ax + t * dx
  const cy = ay + t * dy
  return (px - cx) ** 2 + (py - cy) ** 2
}

/**
 * Douglas-Peucker polyline simplification (standard, well-known algorithm;
 * ring-preserving — a ring's first/last point is always kept). `points` is
 * an array of `[x, y]` pairs (here: `[lon, lat]`); `epsilonDeg` is the
 * distance tolerance in the same units as the input coordinates.
 */
export function simplifyRing(points, epsilonDeg) {
  if (points.length < 3) return points.slice()
  const keep = new Array(points.length).fill(false)
  keep[0] = true
  keep[points.length - 1] = true
  const epsSq = epsilonDeg * epsilonDeg
  const stack = [[0, points.length - 1]]
  while (stack.length > 0) {
    const [start, end] = stack.pop()
    const [ax, ay] = points[start]
    const [bx, by] = points[end]
    let maxD = -1
    let idx = -1
    for (let i = start + 1; i < end; i++) {
      const [px, py] = points[i]
      const d = perpDistSq(px, py, ax, ay, bx, by)
      if (d > maxD) {
        maxD = d
        idx = i
      }
    }
    if (maxD > epsSq) {
      keep[idx] = true
      stack.push([start, idx], [idx, end])
    }
  }
  return points.filter((_, i) => keep[i])
}

/** ~50m at mid-latitudes — see header comment for why this is plenty for
 *  chart-style MFD rendering. */
export const AIRSPACE_SIMPLIFY_EPSILON_DEG = 0.0005

function compactRing(ring) {
  return simplifyRing(ring, AIRSPACE_SIMPLIFY_EPSILON_DEG).map(([lon, lat]) => [+lon.toFixed(5), +lat.toFixed(5)])
}

/** GeoJSON `Polygon`/`MultiPolygon` geometry -> array of compact rings
 *  (first ring of each polygon part is the exterior, any further rings are
 *  holes — no holes were observed in the real Class Airspace/SUA data
 *  sampled for this task, but the shape is preserved generically rather
 *  than assumed away). `MultiPolygon` wasn't observed in this feed either
 *  (every sampled feature was a single `Polygon`); if it occurs, all parts'
 *  rings are flattened into one record's ring list — a flagged
 *  simplification, since a genuine multi-part airspace would render/detect
 *  as if it were one contiguous shape. */
function compactPolygonRings(geometry) {
  if (!geometry) return []
  if (geometry.type === 'Polygon') return geometry.coordinates.map(compactRing)
  if (geometry.type === 'MultiPolygon') return geometry.coordinates.flat().map(compactRing)
  return []
}

/**
 * Build the compact US airspace dataset from already-fetched GeoJSON
 * `Feature[]` arrays (Class Airspace + Special Use Airspace). Pure,
 * unit-tested against small real fixtures extracted from the live feeds
 * (`tests/nav/airspace-parse.test.ts`).
 *
 * Output per airspace record:
 *   { n: name, k: kind code (see `AIRSPACE_KIND_NAMES`), fl: floor ft MSL,
 *     ce: ceiling ft MSL (or `CEILING_UNLIMITED_FT`), i?: ICAO airport ident
 *     (Class Airspace only, when present), se?: sector/shelf label (e.g.
 *     "AREA A", when present), r: rings — `[[ [lon,lat], ... ], ...]` }
 */
export function buildUsAirspace(classFeatures, suaFeatures) {
  const out = []
  const pushFrom = (features, kindOf) => {
    for (const f of features) {
      const p = f.properties
      const kind = kindOf(p)
      if (kind === undefined) continue
      const rings = compactPolygonRings(f.geometry).filter((ring) => ring.length >= 3)
      if (rings.length === 0) continue
      const entry = {
        n: p.NAME,
        k: kind,
        fl: faaAltFt(p.LOWER_VAL, p.LOWER_UOM, p.LOWER_CODE),
        ce: faaAltFt(p.UPPER_VAL, p.UPPER_UOM, p.UPPER_CODE),
        r: rings,
      }
      if (p.ICAO_ID) entry.i = p.ICAO_ID
      if (p.SECTOR) entry.se = p.SECTOR
      out.push(entry)
    }
  }
  pushFrom(classFeatures, (p) => CLASS_LOCAL_TYPE_KIND[p.LOCAL_TYPE])
  pushFrom(suaFeatures, (p) => SUA_TYPE_KIND[p.TYPE_CODE])
  return out
}

/**
 * OurAirports frequencies.csv → per-airport comms JSON (Phase 6a, §12).
 * Schema: id,airport_ref,airport_ident,type,description,frequency_mhz.
 * Only types the ATC system uses are kept; rows are filtered to the same
 * US-airport ident set `buildUsAirports` emits, so the two datasets always
 * join. Output: { [ident]: [{ t: type, f: mhz, d: description }] }.
 */
const FREQ_TYPES = new Set(['TWR', 'GND', 'ATIS', 'CTAF', 'UNICOM', 'CLD', 'DEL', 'A/D', 'APP', 'DEP', 'CNTR'])

export function buildUsFrequencies(frequenciesCsv, usIdentSet) {
  const { idx, rows } = parseCsv(frequenciesCsv)
  const out = {}
  for (const row of rows) {
    const ident = row[idx.airport_ident]
    if (!usIdentSet.has(ident)) continue
    const type = row[idx.type]
    if (!FREQ_TYPES.has(type)) continue
    const f = parseFloat(row[idx.frequency_mhz])
    if (!isFinite(f) || f < 108 || f > 137) continue
    ;(out[ident] ??= []).push({ t: type, f, d: row[idx.description] ?? '' })
  }
  return out
}

/**
 * ICAO Doc-8643 type designators (Phase 12a): merge the ADS-B ecosystem's
 * desc/wtc table (tar1090-db mirror: { DES: { desc: 'L2J', wtc: 'M' } })
 * with the community name list (rikgale ICAOList CSV) into a compact map
 * { DES: [desc, wtc, name] }. Names are best-effort — absent means empty
 * string, never an invented name. Types JSON is required; unparseable
 * input throws so the endpoint 502s instead of serving junk.
 */
export function buildAircraftTypes(typesJsonText, namesCsvText) {
  const types = JSON.parse(typesJsonText)
  if (typeof types !== 'object' || types === null || Array.isArray(types)) {
    throw new Error('aircraft types: expected an object keyed by designator')
  }
  const names = new Map()
  if (namesCsvText) {
    const { idx, rows } = parseCsv(namesCsvText)
    const dCol = idx['Aircraft TypeDesignator']
    const mCol = idx['MANUFACTURER, Model']
    if (dCol !== undefined && mCol !== undefined) {
      for (const r of rows) {
        const d = (r[dCol] ?? '').trim().toUpperCase()
        if (d && !names.has(d)) names.set(d, (r[mCol] ?? '').trim())
      }
    }
  }
  const out = {}
  for (const [dRaw, v] of Object.entries(types)) {
    const d = dRaw.trim().toUpperCase()
    if (!d || !v || typeof v.desc !== 'string') continue
    if (out[d]) continue // first entry wins on trim/case collisions
    out[d] = [v.desc, typeof v.wtc === 'string' ? v.wtc : '-', names.get(d) ?? '']
  }
  return out
}
