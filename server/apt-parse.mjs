/**
 * X-Plane airport data (apt.dat, versions 1100/1200) → one airport's real layout.
 *
 * X-Plane's Global Airports are the World Editor gateway layouts: every
 * runway end, pavement polygon (with holes and Bézier edges), painted line,
 * ramp start, sign and taxi-route edge as authored. This module parses the
 * rows for ONE airport (the text between its header row and the next) into
 * compact JSON the client renders 1:1. Pure: no I/O, no globals.
 *
 * Node rows (111…116) belong to the nearest preceding 110 pavement, 120
 * linear feature or 130 boundary. 111/113/115 are plain nodes, 112/114/116
 * add the Bézier control point (absolute lat/lon of the handle leaving the
 * node; the incoming handle is its mirror image). 113/114 close the ring,
 * 115/116 end an open line. A node's line-type code paints the segment that
 * follows it; without one the segment is unpainted.
 */

const num = (s) => { const v = Number(s); return Number.isFinite(v) ? v : 0 }
const r7 = (v) => Math.round(v * 1e7) / 1e7

/** Cubic Bézier between two nodes, sampled; straight when neither has a handle. */
function segment(a, b, steps = 8) {
  const out = []
  const p1 = a.bz ?? null
  const p2 = b.bz ? { lat: 2 * b.lat - b.bz.lat, lon: 2 * b.lon - b.bz.lon } : null
  if (!p1 && !p2) return out
  const c1 = p1 ?? a, c2 = p2 ?? b
  for (let i = 1; i < steps; i++) {
    const t = i / steps, u = 1 - t
    const w0 = u * u * u, w1 = 3 * u * u * t, w2 = 3 * u * t * t, w3 = t * t * t
    out.push([r7(w0 * a.lat + w1 * c1.lat + w2 * c2.lat + w3 * b.lat), r7(w0 * a.lon + w1 * c1.lon + w2 * c2.lon + w3 * b.lon)])
  }
  return out
}

/** A ring of nodes → a flat lat/lon polyline (Bézier edges sampled). Closed rings do not repeat their first point. */
export function flattenNodes(nodes, closed) {
  const pts = []
  const n = nodes.length
  for (let i = 0; i < n; i++) {
    const a = nodes[i], b = nodes[(i + 1) % n]
    pts.push([r7(a.lat), r7(a.lon)])
    if (i < n - 1 || closed) pts.push(...segment(a, b))
  }
  return pts
}

/** Painted runs: consecutive segments with the same line type become one polyline. */
export function paintedRuns(nodes, closed) {
  const runs = []
  const n = nodes.length
  const segs = closed ? n : n - 1
  let cur = null
  for (let i = 0; i < segs; i++) {
    const a = nodes[i], b = nodes[(i + 1) % n]
    const type = a.type ?? 0
    const pts = [[r7(a.lat), r7(a.lon)], ...segment(a, b), [r7(b.lat), r7(b.lon)]]
    if (type > 0 && type < 100) {
      if (cur && cur.t === type) cur.p.push(...pts.slice(1))
      else { cur = { t: type, p: pts }; runs.push(cur) }
    } else cur = null
  }
  return runs
}

/** Lit runs: consecutive segments with the same light-type code (101…116) become one polyline. */
export function lightRuns(nodes, closed) {
  const runs = []
  const n = nodes.length
  const segs = closed ? n : n - 1
  let cur = null
  for (let i = 0; i < segs; i++) {
    const a = nodes[i], b = nodes[(i + 1) % n]
    const light = a.light ?? 0
    const pts = [[r7(a.lat), r7(a.lon)], ...segment(a, b), [r7(b.lat), r7(b.lon)]]
    if (light >= 101 && light <= 116) {
      if (cur && cur.l === light) cur.p.push(...pts.slice(1))
      else { cur = { l: light, p: pts }; runs.push(cur) }
    } else cur = null
  }
  return runs
}

function parseNode(code, f) {
  const bezier = code === 112 || code === 114 || code === 116
  const lat = num(f[1]), lon = num(f[2])
  const node = { lat, lon }
  let i = 3
  if (bezier) { node.bz = { lat: num(f[3]), lon: num(f[4]) }; i = 5 }
  if (f[i] !== undefined && f[i] !== '') node.type = num(f[i])
  if (f[i + 1] !== undefined && f[i + 1] !== '') node.light = num(f[i + 1])
  node.close = code === 113 || code === 114
  node.end = code === 115 || code === 116
  return node
}

/** @param {string} text the rows of one airport, header row first */
export function parseAptAirport(text) {
  const out = {
    icao: '', name: '', elevFt: 0, datum: null,
    rwy: [], heli: [], pav: [], lines: [], lights: [], bound: [], ramps: [], signs: [], wind: [], papi: [], freqs: [],
    taxi: { nodes: [], edges: [] },
  }
  /** the open feature collecting node rows */
  let feat = null
  const finishRing = (f) => {
    if (f.nodes.length) f.rings.push({ nodes: f.nodes, closed: f.closing })
    f.nodes = []; f.closing = false
  }
  const flush = () => {
    if (!feat) return
    finishRing(feat)
    if (feat.kind === 'pav') {
      const rings = feat.rings.filter((r) => r.nodes.length >= 3).map((r) => flattenNodes(r.nodes, true))
      if (rings.length) out.pav.push({ surf: feat.surf, name: feat.name, rings })
      for (const r of feat.rings) {
        for (const run of paintedRuns(r.nodes, r.closed)) out.lines.push({ ...run, edge: true })
        out.lights.push(...lightRuns(r.nodes, r.closed))
      }
    } else if (feat.kind === 'line') {
      for (const r of feat.rings) {
        for (const run of paintedRuns(r.nodes, r.closed)) out.lines.push(run)
        out.lights.push(...lightRuns(r.nodes, r.closed))
      }
    } else if (feat.kind === 'bound') {
      for (const r of feat.rings) if (r.nodes.length >= 3) out.bound.push(flattenNodes(r.nodes, true))
    }
    feat = null
  }
  for (const raw of text.split('\n')) {
    const line = raw.trim()
    if (!line) continue
    const f = line.split(/\s+/)
    const code = Number(f[0])
    if (code >= 111 && code <= 116) {
      if (!feat) continue
      const node = parseNode(code, f)
      feat.nodes.push(node)
      if (node.close) { feat.closing = true; finishRing(feat) } else if (node.end) finishRing(feat)
      continue
    }
    flush()
    switch (code) {
      case 1: case 16: case 17:
        out.elevFt = num(f[1]); out.icao = f[4] ?? ''; out.name = f.slice(5).join(' ')
        break
      case 100: {
        const end = (o) => ({ id: f[o], lat: num(f[o + 1]), lon: num(f[o + 2]), dthr: num(f[o + 3]), over: num(f[o + 4]), mark: num(f[o + 5]), app: num(f[o + 6]), tdz: num(f[o + 7]), reil: num(f[o + 8]) })
        if (f.length >= 26) out.rwy.push({ w: num(f[1]), surf: num(f[2]), shoulder: num(f[3]), centreLights: num(f[5]), edgeLights: num(f[6]), signs: num(f[7]), ends: [end(8), end(17)] })
        break
      }
      case 102:
        out.heli.push({ id: f[1], lat: num(f[2]), lon: num(f[3]), hdg: num(f[4]), len: num(f[5]), wid: num(f[6]), surf: num(f[7]) })
        break
      case 110: feat = { kind: 'pav', surf: num(f[1]), name: f.slice(4).join(' '), nodes: [], rings: [], closing: false }; break
      case 120: feat = { kind: 'line', name: f.slice(1).join(' '), nodes: [], rings: [], closing: false }; break
      case 130: feat = { kind: 'bound', name: f.slice(1).join(' '), nodes: [], rings: [], closing: false }; break
      case 1300: out.ramps.push({ lat: num(f[1]), lon: num(f[2]), hdg: num(f[3]), kind: f[4] ?? '', cats: (f[5] ?? '').split('|').filter(Boolean), name: f.slice(6).join(' ') }); break
      case 20: out.signs.push({ lat: num(f[1]), lon: num(f[2]), hdg: num(f[3]), size: num(f[5]), text: f.slice(6).join(' ') }); break
      case 19: out.wind.push({ lat: num(f[1]), lon: num(f[2]) }); break
      case 21: out.papi.push({ lat: num(f[1]), lon: num(f[2]), type: num(f[3]), hdg: num(f[4]), gs: num(f[5]), rwy: f[6] ?? '' }); break
      case 1302: if (f[1] === 'datum_lat') { out.datum = { lat: num(f[2]), lon: out.datum?.lon ?? 0 } } else if (f[1] === 'datum_lon') { out.datum = { lat: out.datum?.lat ?? 0, lon: num(f[2]) } }; break
      case 50: case 51: case 52: case 53: case 54: case 55: case 56:
      case 1050: case 1051: case 1052: case 1053: case 1054: case 1055: case 1056: {
        const kind = ['atis', 'ctaf', 'clearance', 'ground', 'tower', 'approach', 'departure'][(code % 50)] ?? 'other'
        out.freqs.push({ kind, mhz: code >= 1000 ? num(f[1]) / 1000 : num(f[1]) / 100, name: f.slice(2).join(' ') })
        break
      }
      case 1201: out.taxi.nodes.push({ id: num(f[4]), lat: num(f[1]), lon: num(f[2]), use: f[3], name: f.slice(5).join(' ') }); break
      case 1202: out.taxi.edges.push({ a: num(f[1]), b: num(f[2]), oneway: f[3] === 'oneway', kind: f[4] ?? '', name: f.slice(5).join(' ') }); break
      default: break
    }
  }
  flush()
  return out
}

/** Airport header rows for an index scan: "1|16|17 elev tower deprecated ICAO name". */
export function airportHeader(line) {
  const m = /^(1|16|17)\s+(-?\d+)\s+\d+\s+\d+\s+(\S+)\s*(.*)$/.exec(line)
  return m ? { code: Number(m[1]), elevFt: Number(m[2]), icao: m[3], name: m[4] } : null
}
