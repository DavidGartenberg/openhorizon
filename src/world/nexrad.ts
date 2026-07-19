/**
 * NEXRAD radar field (§11, Phase 5 step 5): fetches the IEM national
 * composite through our proxy, decodes tiles to a 4-level intensity grid,
 * and answers (a) MFD "FIS-B" cell queries with an age stamp and (b)
 * point-intensity queries that drive in-world rain/lightning.
 *
 * Latency honesty: the IEM composite is itself minutes old, and real FIS-B
 * broadcast adds more — the age stamp shown is time-since-our-fetch plus a
 * documented 5-minute product-baseline. We do NOT artificially hold data
 * beyond that (recorded simplification; a full broadcast-schedule emulation
 * is roadmap material).
 */
import { lonToTileX, latToTileY, tileXToLon, tileYToLat } from '../math/geo'
import { classifyNexradPixel } from '../sim/weather/nexrad-palette'

const ZOOM = 6
const PRODUCT_BASELINE_MIN = 5

interface DecodedTile {
  x: number
  y: number
  grid: Uint8Array // 256×256 intensity 0-3
}

export interface RadarCell {
  lat: number
  lon: number
  intensity: 1 | 2 | 3
}

export class NexradField {
  private tiles = new Map<string, DecodedTile>()
  private fetchedAt = 0
  private fetching = false
  private lastCenter = { lat: 0, lon: 0 }

  /** Refetch every 5 min or on a big move; safe to call every frame. */
  update(lat: number, lon: number, now: number): void {
    const moved =
      Math.abs(lat - this.lastCenter.lat) > 1.5 || Math.abs(lon - this.lastCenter.lon) > 2
    if (!this.fetching && (now - this.fetchedAt > 5 * 60 * 1000 || moved)) {
      this.fetching = true
      this.lastCenter = { lat, lon }
      const tx = Math.floor(lonToTileX(lon, ZOOM))
      const ty = Math.floor(latToTileY(lat, ZOOM))
      const wanted: Array<{ x: number; y: number }> = []
      for (let dy = -1; dy <= 1; dy++)
        for (let dx = -1; dx <= 1; dx++) wanted.push({ x: tx + dx, y: ty + dy })
      Promise.all(wanted.map((t) => this.fetchTile(t.x, t.y)))
        .then((decoded) => {
          this.tiles = new Map(
            decoded.filter((d): d is DecodedTile => d !== null).map((d) => [`${d.x}/${d.y}`, d]),
          )
          this.fetchedAt = now
        })
        .finally(() => {
          this.fetching = false
        })
    }
  }

  private async fetchTile(x: number, y: number): Promise<DecodedTile | null> {
    try {
      const res = await fetch(`/proxy/nexrad/${ZOOM}/${x}/${y}.png`)
      if (!res.ok) return null
      const bitmap = await createImageBitmap(await res.blob())
      const px = bitmap.width
      const canvas = document.createElement('canvas')
      canvas.width = px
      canvas.height = px
      const ctx = canvas.getContext('2d', { willReadFrequently: true })!
      ctx.drawImage(bitmap, 0, 0)
      const img = ctx.getImageData(0, 0, px, px)
      bitmap.close()
      const grid = new Uint8Array(256 * 256)
      for (let j = 0; j < 256; j++) {
        for (let i = 0; i < 256; i++) {
          const sx = Math.floor((i / 256) * px)
          const sy = Math.floor((j / 256) * px)
          const o = (sy * px + sx) * 4
          grid[j * 256 + i] = classifyNexradPixel(
            img.data[o]!, img.data[o + 1]!, img.data[o + 2]!, img.data[o + 3]!,
          )
        }
      }
      return { x, y, grid }
    } catch {
      return null
    }
  }

  /** Radar intensity 0-3 at a position (0 when no data). */
  intensityAt(lat: number, lon: number): number {
    if (this.tiles.size === 0) return 0
    const fx = lonToTileX(lon, ZOOM)
    const fy = latToTileY(lat, ZOOM)
    const tile = this.tiles.get(`${Math.floor(fx)}/${Math.floor(fy)}`)
    if (!tile) return 0
    const i = Math.min(Math.floor((fx - Math.floor(fx)) * 256), 255)
    const j = Math.min(Math.floor((fy - Math.floor(fy)) * 256), 255)
    return tile.grid[j * 256 + i]!
  }

  /** Age for the FIS-B stamp, minutes (product baseline included). */
  ageMin(now: number): number | null {
    if (this.fetchedAt === 0) return null
    return Math.round((now - this.fetchedAt) / 60_000) + PRODUCT_BASELINE_MIN
  }

  /** Cells within `radiusM` of a position, decimated for the MFD overlay. */
  cellsNear(lat: number, lon: number, radiusM: number, stride = 4): RadarCell[] {
    const out: RadarCell[] = []
    const mLat = 111_320
    const mLon = mLat * Math.cos((lat * Math.PI) / 180)
    for (const tile of this.tiles.values()) {
      for (let j = 0; j < 256; j += stride) {
        for (let i = 0; i < 256; i += stride) {
          const v = tile.grid[j * 256 + i]!
          if (v === 0) continue
          const cellLat = tileYToLat(tile.y + (j + stride / 2) / 256, ZOOM)
          const cellLon = tileXToLon(tile.x + (i + stride / 2) / 256, ZOOM)
          const dn = (cellLat - lat) * mLat
          const de = (cellLon - lon) * mLon
          if (dn * dn + de * de > radiusM * radiusM) continue
          out.push({ lat: cellLat, lon: cellLon, intensity: v as 1 | 2 | 3 })
        }
      }
    }
    return out
  }

  /** Nearest heavy (level-3) cell within `radiusM`, for lightning. */
  nearestHeavyM(lat: number, lon: number, radiusM: number): number | null {
    let best: number | null = null
    for (const c of this.cellsNear(lat, lon, radiusM, 8)) {
      if (c.intensity < 3) continue
      const mLat = 111_320
      const d = Math.hypot((c.lat - lat) * mLat, (c.lon - lon) * mLat * Math.cos((lat * Math.PI) / 180))
      if (best === null || d < best) best = d
    }
    return best
  }
}
