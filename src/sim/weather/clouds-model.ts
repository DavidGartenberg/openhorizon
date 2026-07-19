/**
 * Cloud-layer geometry + in-cloud obscuration (§11, Phase 5 step 4). Pure:
 * converts METAR layers (bases AGL at the reporting station) into MSL slabs
 * and an obscuration factor for the aircraft's altitude. The renderer and
 * the whiteout overlay both read THIS — one state, no cosmetic-only fog.
 *
 * Documented assumption (METARs don't report tops): layer thickness by
 * cover — FEW/SCT 1000 ft, BKN 2000 ft, OVC 3000 ft, VV (obscured sky)
 * from the surface through base+2000.
 */
import type { CloudLayer, CloudCover } from './metar'

export interface CloudSlab {
  cover: CloudCover
  baseMslFt: number
  topMslFt: number
}

const THICKNESS_FT: Record<CloudCover, number> = {
  FEW: 1000, SCT: 1000, BKN: 2000, OVC: 3000, VV: 2000,
}

/** Peak obscuration inside a layer of each cover (opacity of the whiteout). */
const OBSCURATION: Record<CloudCover, number> = {
  FEW: 0.15, SCT: 0.35, BKN: 0.8, OVC: 0.97, VV: 0.97,
}

export function cloudSlabs(clouds: CloudLayer[], stationElevFt: number): CloudSlab[] {
  return clouds.map((c) => {
    const baseMslFt = c.cover === 'VV' ? stationElevFt : stationElevFt + c.baseFt
    return { cover: c.cover, baseMslFt, topMslFt: (c.cover === 'VV' ? stationElevFt + c.baseFt : baseMslFt) + THICKNESS_FT[c.cover] }
  })
}

/** 0 (clear) → ~0.97 (inside solid overcast); 150 ft edge blend so entering
 *  a layer is a fade, not a switch. */
export function inCloudFactor(slabs: CloudSlab[], altMslFt: number): number {
  const EDGE_FT = 150
  let worst = 0
  for (const s of slabs) {
    // VV (obscured sky) reaches the surface — no bottom-edge fade.
    const bottomIn = s.cover === 'VV' ? Infinity : altMslFt - s.baseMslFt
    const into = Math.min(bottomIn, s.topMslFt - altMslFt)
    if (into <= -EDGE_FT) continue
    const blend = Math.min(Math.max((into + EDGE_FT) / (2 * EDGE_FT), 0), 1)
    worst = Math.max(worst, OBSCURATION[s.cover] * blend)
  }
  return worst
}
