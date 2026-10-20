/**
 * Pure runway-marking geometry (FAA AC 150/5340-1 proportions) in the
 * runway-local frame: x = right of the low-end heading, y = along from the
 * runway centre (low threshold at −len/2). No Three.js, no canvas — so the
 * layout is unit-tested; airport-detail.ts turns the quads into meshes.
 */

export interface Quad { x: number; y: number; w: number; l: number; rotZ?: number }

export const FT = 0.3048

/** Edge of paint → pavement edge, and the centerline dash pattern. */
export const DASH_LEN_M = 36.6 // 120 ft
export const DASH_GAP_M = 24.4 // 80 ft
const NUMBER_ZONE_M = 100 // centerline dashes start beyond the designators

/** FAA threshold stripe count by runway width. */
export function thresholdStripes(widM: number): number {
  const wFt = widM / FT
  if (wFt >= 150) return 16
  if (wFt >= 100) return 12
  if (wFt >= 75) return 8
  if (wFt >= 60) return 6
  return 4
}

/** Split a runway identifier ("28L", "9", "36C") into numerals and suffix letter. */
export function splitDesignator(ident: string): { digits: string; letter: string } {
  const m = /^(\d{1,2})([LRC]?)$/i.exec(ident.trim())
  if (!m) return { digits: ident.trim(), letter: '' }
  return { digits: String(Number(m[1])).padStart(2, '0').replace(/^0(\d)$/, m[1]!.length === 1 ? '$1' : '0$1'), letter: m[2]!.toUpperCase() }
}

/** Painted designator layout for one end, as distances from that runway end to each glyph centre. */
export function designatorLayout(ident: string): { glyphs: { text: string; distM: number }[]; heightM: number } {
  const { digits, letter } = splitDesignator(ident)
  const heightM = 18
  const start = 48 // 12 m past the threshold stripes
  const glyphs: { text: string; distM: number }[] = []
  let d = start + heightM / 2
  if (letter) { glyphs.push({ text: letter, distM: d }); d += heightM + 6 }
  glyphs.push({ text: digits, distM: d })
  return { glyphs, heightM }
}

/** Every white painted quad on one paved runway. */
export function runwayMarkQuads(lenM: number, widM: number): Quad[] {
  const quads: Quad[] = []
  const halfLen = lenM / 2
  const halfW = widM / 2
  const precision = widM >= 30
  const lineW = precision ? 0.9 : 0.45

  // Solid edge lines, 0.9 m inboard of the pavement edge.
  const edgeX = halfW - 0.9 - lineW / 2
  const edgeLen = lenM - 2 * 6
  for (const side of [-1, 1]) quads.push({ x: side * edgeX, y: 0, w: lineW, l: edgeLen })

  // Centerline: 120 ft dashes / 80 ft gaps, evenly distributed between the designator zones.
  const span = lenM - 2 * NUMBER_ZONE_M
  if (span > DASH_LEN_M) {
    const n = Math.max(1, Math.floor((span + DASH_GAP_M) / (DASH_LEN_M + DASH_GAP_M)))
    const gap = n > 1 ? (span - n * DASH_LEN_M) / (n - 1) : 0
    for (let k = 0; k < n; k++) {
      quads.push({ x: 0, y: -span / 2 + DASH_LEN_M / 2 + k * (DASH_LEN_M + gap), w: lineW, l: DASH_LEN_M })
    }
  }

  const inner = Math.min(18, Math.max(6, widM * 0.3)) // gap between the two aiming-point blocks
  const sideX = inner / 2 + 3
  for (const end of [-1, 1] as const) {
    // Threshold stripes: 30 m × 1.8 m starting 6 m from the threshold, centreline gap.
    const n = thresholdStripes(widM)
    const usable = widM - 2 * 1.8 - 2 * 1.8
    const pitch = usable / n
    for (let i = 0; i < n; i++) {
      const raw = -usable / 2 + pitch * (i + 0.5)
      const x = raw + (raw >= 0 ? 1 : -1) * Math.min(pitch * 0.25, 1.5)
      quads.push({ x: Math.max(-halfW + 2.7, Math.min(halfW - 2.7, x)), y: end * (halfLen - 6 - 15), w: 1.8, l: 30 })
    }
    // Aiming point: two 45 m × 6 m blocks at 1,000 ft on runways ≥ 4,200 ft.
    if (lenM >= 1280) {
      for (const side of [-1, 1]) quads.push({ x: side * sideX, y: end * (halfLen - 305 - 22.5), w: 6, l: 45 })
    }
    // Touchdown-zone bars at 500 / 1,500 / 2,000 / 2,500 / 3,000 ft: 3-2-2-1-1 stripes per side.
    if (lenM >= 1800) {
      const stations: Array<[number, number]> = [[500, 3], [1500, 2], [2000, 2], [2500, 1], [3000, 1]]
      for (const [stationFt, count] of stations) {
        const dist = stationFt * FT + 11.45
        if (dist > halfLen - 160) continue // never past the mid-runway / into the opposite end's zone
        const groupW = count * 1.8 + (count - 1) * 1.5
        for (const side of [-1, 1]) {
          for (let k = 0; k < count; k++) {
            const x = side * sideX - groupW / 2 + 0.9 + k * 3.3
            quads.push({ x, y: end * (halfLen - dist), w: 1.8, l: 22.9 })
          }
        }
      }
    }
  }
  return quads
}
