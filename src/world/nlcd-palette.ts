/**
 * NLCD 2021 land-cover legend → terrain vertex color (pure). The MRLC WMS
 * renders classes in the standard legend palette; we classify by nearest
 * legend RGB and emit our own muted ground tint per biome. Water and
 * missing data return null — callers fall back to the elevation ramp (and
 * the ocean plane remains the sea).
 */

interface LegendEntry {
  rgb: [number, number, number]
  key: string
  color: [number, number, number] | null // null = defer (water/nodata)
}

const LEGEND: LegendEntry[] = [
  { rgb: [70, 107, 159], key: 'water', color: null },
  { rgb: [209, 222, 248], key: 'snow', color: [0.88, 0.9, 0.94] },
  { rgb: [222, 197, 197], key: 'dev-open', color: [0.42, 0.44, 0.4] },
  { rgb: [217, 146, 130], key: 'dev-low', color: [0.45, 0.44, 0.42] },
  { rgb: [235, 0, 0], key: 'dev-med', color: [0.5, 0.49, 0.47] },
  { rgb: [171, 0, 0], key: 'dev-high', color: [0.55, 0.54, 0.52] },
  { rgb: [179, 172, 159], key: 'barren', color: [0.62, 0.58, 0.5] },
  { rgb: [104, 171, 95], key: 'deciduous', color: [0.2, 0.34, 0.16] },
  { rgb: [28, 95, 44], key: 'evergreen', color: [0.13, 0.26, 0.14] },
  { rgb: [181, 197, 143], key: 'mixed-forest', color: [0.22, 0.32, 0.17] },
  { rgb: [204, 184, 121], key: 'shrub', color: [0.45, 0.4, 0.26] },
  { rgb: [223, 223, 194], key: 'grass', color: [0.42, 0.42, 0.27] },
  { rgb: [220, 217, 57], key: 'pasture', color: [0.35, 0.42, 0.2] },
  { rgb: [171, 108, 40], key: 'crops', color: [0.4, 0.34, 0.2] },
  { rgb: [184, 217, 235], key: 'wetland-woody', color: [0.2, 0.3, 0.22] },
  { rgb: [108, 159, 184], key: 'wetland-herb', color: [0.28, 0.36, 0.3] },
]

export interface NlcdResult {
  key: string
  color: [number, number, number] | null
}

/** Classify one WMS pixel; transparent/void → null (defer to fallback). */
export function classifyNlcdPixel(r: number, g: number, b: number, a: number): NlcdResult | null {
  if (a < 128) return null
  let best: LegendEntry | null = null
  let bestD = Infinity
  for (const e of LEGEND) {
    const d = (r - e.rgb[0]) ** 2 + (g - e.rgb[1]) ** 2 + (b - e.rgb[2]) ** 2
    if (d < bestD) {
      bestD = d
      best = e
    }
  }
  // Reject pixels far from every legend color (antialiased edges, borders).
  if (!best || bestD > 1600) return null
  return { key: best.key, color: best.color }
}
