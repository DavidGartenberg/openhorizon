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
