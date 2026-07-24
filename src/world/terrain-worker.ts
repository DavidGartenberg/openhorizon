/**
 * Terrain worker: fetch + decode a terrarium tile, apply runway flattening,
 * and build mesh buffers (positions/normals/vertex colors + skirt) in the
 * tile-local frame (x east, y up, z south; origin at tile NW corner's SW...
 * origin = tile center, y = height meters). Transfers buffers to main.
 */
import { terrariumDecode, flattenForRunway, tileGridUv } from '../math/geo'
import { classifyNlcdPixel } from './nlcd-palette'

export interface TileRequest {
  key: string
  url: string
  /** NLCD land-cover tile for biome coloring (§6.2); fetch failure or
   *  off-legend pixels fall back to the elevation/slope ramp. */
  landcoverUrl?: string
  gridSize: number
  sizeEastM: number
  sizeNorthM: number
  /** Runways intersecting this tile, in tile-local meters (x east, y north). */
  runways: Array<{ ax: number; ay: number; bx: number; by: number; ha: number; hb: number; halfW: number }>
  skirtDepthM: number
  /** Render-only ring depth bias (coarse rings sit low; see tiles.ts). */
  depthBiasM: number
}

export interface TileResponse {
  key: string
  positions: Float32Array
  normals: Float32Array
  colors: Float32Array
  uvs: Float32Array // imagery-tile UVs (13b); orientation in tileGridUv
  indices: Uint32Array
  heights: Float32Array // gridSize² for elevation queries
  gridSize: number
  error?: string
}

function colorFor(
  h: number,
  slope: number,
  out: [number, number, number],
  biome: [number, number, number] | null = null,
): void {
  let r: number, g: number, b: number
  if (biome && h >= 1.5 && h < 3000) {
    // Real land cover (NLCD) wins where classified; snowline and beaches
    // stay elevation-driven, slope-rock blend applies to both paths.
    ;[r, g, b] = biome
  } else if (h < 1.5) { r = 0.72; g = 0.66; b = 0.5 } // beach
  else if (h < 500) { r = 0.24; g = 0.36; b = 0.18 } // lowland green
  else if (h < 1200) { r = 0.3; g = 0.34; b = 0.17 } // foothills
  else if (h < 2200) { r = 0.42; g = 0.38; b = 0.28 } // mountain scrub
  else if (h < 3000) { r = 0.48; g = 0.46; b = 0.44 } // rock
  else { r = 0.88; g = 0.9; b = 0.94 } // snow
  const rocky = Math.min(slope * 1.6, 1) * (h > 200 ? 1 : 0.3)
  out[0] = r * (1 - rocky) + 0.45 * rocky
  out[1] = g * (1 - rocky) + 0.42 * rocky
  out[2] = b * (1 - rocky) + 0.4 * rocky
}

self.onmessage = async (ev: MessageEvent<TileRequest>) => {
  const req = ev.data
  try {
    const res = await fetch(req.url)
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    const bitmap = await createImageBitmap(await res.blob())
    const px = bitmap.width // capture BEFORE close() — close() zeroes it
    const canvas = new OffscreenCanvas(px, bitmap.height)
    const ctx = canvas.getContext('2d')!
    ctx.drawImage(bitmap, 0, 0)
    const img = ctx.getImageData(0, 0, px, bitmap.height)
    bitmap.close()

    // Land cover (optional, best-effort — never fails the tile).
    let lc: ImageData | null = null
    let lcPx = 0
    if (req.landcoverUrl) {
      try {
        const lcRes = await fetch(req.landcoverUrl)
        if (lcRes.ok) {
          const lcBmp = await createImageBitmap(await lcRes.blob())
          lcPx = lcBmp.width
          const lcCanvas = new OffscreenCanvas(lcPx, lcBmp.height)
          const lcCtx = lcCanvas.getContext('2d')!
          lcCtx.drawImage(lcBmp, 0, 0)
          lc = lcCtx.getImageData(0, 0, lcPx, lcBmp.height)
          lcBmp.close()
        }
      } catch {
        lc = null
      }
    }

    const G = req.gridSize
    const heights = new Float32Array(G * G)
    const sea = new Uint8Array(G * G)
    for (let j = 0; j < G; j++) {
      for (let i = 0; i < G; i++) {
        const sx = Math.min(Math.round((i / (G - 1)) * (px - 1)), px - 1)
        const sy = Math.min(Math.round((j / (G - 1)) * (px - 1)), px - 1)
        const o = (sy * px + sx) * 4
        let h = terrariumDecode(img.data[o]!, img.data[o + 1]!, img.data[o + 2]!)
        const belowDatum = h < 0
        if (belowDatum) h = 0 // ocean plane is the sea
        // Local coords: x east from -sizeE/2, y north from +sizeN/2 (row j=0 = north)
        const lx = (i / (G - 1) - 0.5) * req.sizeEastM
        const ly = (0.5 - j / (G - 1)) * req.sizeNorthM
        for (const rw of req.runways) {
          h = flattenForRunway(h, lx, ly, rw.ax, rw.ay, rw.bx, rw.by, rw.ha, rw.hb, rw.halfW)
        }
        heights[j * G + i] = h
        // Sea-clamped verts render slightly below the y=0 ocean plane so
        // the water wins the coplanar depth fight deterministically
        // (physics heights keep 0; runway-flattened verts are exempt).
        sea[j * G + i] = belowDatum && h === 0 ? 1 : 0
      }
    }

    // Intermittent Worker-side ImageBitmap/getImageData flakiness can yield
    // non-finite heights (see PROGRESS.md). Reject the tile rather than
    // caching a poisoned heightfield — elevation queries fall through to a
    // coarser ring, and the visual gap is honest.
    for (let k = 0; k < heights.length; k++) {
      if (!Number.isFinite(heights[k]!)) throw new Error('non-finite decode')
    }

    // Mesh: grid + one ring of skirt vertices.
    const vertsPerRow = G
    const total = G * G + 4 * G
    const positions = new Float32Array(total * 3)
    const normals = new Float32Array(total * 3)
    const colors = new Float32Array(total * 3)
    const uvs = new Float32Array(total * 2)
    const dxe = req.sizeEastM / (G - 1)
    const dyn = req.sizeNorthM / (G - 1)
    const c: [number, number, number] = [0, 0, 0]
    for (let j = 0; j < G; j++) {
      for (let i = 0; i < G; i++) {
        const idx = j * G + i
        const h = heights[idx]!
        const x = (i / (G - 1) - 0.5) * req.sizeEastM
        const zSouth = (j / (G - 1) - 0.5) * req.sizeNorthM // j=0 north → z=-size/2
        positions[idx * 3] = x
        positions[idx * 3 + 1] = (sea[idx] ? -0.15 : h) - req.depthBiasM
        positions[idx * 3 + 2] = zSouth
        // Normal from central differences.
        const hL = heights[j * G + Math.max(i - 1, 0)]!
        const hR = heights[j * G + Math.min(i + 1, G - 1)]!
        const hU = heights[Math.max(j - 1, 0) * G + i]!
        const hD = heights[Math.min(j + 1, G - 1) * G + i]!
        let nx = (hL - hR) / (2 * dxe)
        let nz = (hU - hD) / (2 * dyn)
        const inv = 1 / Math.hypot(nx, 1, nz)
        nx *= inv
        nz *= inv
        normals[idx * 3] = nx
        normals[idx * 3 + 1] = inv
        normals[idx * 3 + 2] = nz
        const slope = Math.hypot((hR - hL) / (2 * dxe), (hD - hU) / (2 * dyn))
        let biome: [number, number, number] | null = null
        if (lc) {
          const lx = Math.min(Math.round((i / (G - 1)) * (lcPx - 1)), lcPx - 1)
          const ly = Math.min(Math.round((j / (G - 1)) * (lcPx - 1)), lcPx - 1)
          const lo = (ly * lcPx + lx) * 4
          const cls = classifyNlcdPixel(lc.data[lo]!, lc.data[lo + 1]!, lc.data[lo + 2]!, lc.data[lo + 3]!)
          biome = cls?.color ?? null
        }
        colorFor(h, slope, c, biome)
        colors[idx * 3] = c[0]
        colors[idx * 3 + 1] = c[1]
        colors[idx * 3 + 2] = c[2]
        const [u, v] = tileGridUv(i, j, G)
        uvs[idx * 2] = u
        uvs[idx * 2 + 1] = v
      }
    }
    // Skirts: duplicate edge verts, dropped down.
    let sv = G * G
    const edge = (i: number, j: number) => j * G + i
    const skirtIdx: number[] = []
    const pushSkirt = (src: number) => {
      positions[sv * 3] = positions[src * 3]!
      positions[sv * 3 + 1] = positions[src * 3 + 1]! - req.skirtDepthM
      positions[sv * 3 + 2] = positions[src * 3 + 2]!
      normals[sv * 3] = normals[src * 3]!
      normals[sv * 3 + 1] = normals[src * 3 + 1]!
      normals[sv * 3 + 2] = normals[src * 3 + 2]!
      colors[sv * 3] = colors[src * 3]!
      colors[sv * 3 + 1] = colors[src * 3 + 1]!
      colors[sv * 3 + 2] = colors[src * 3 + 2]!
      uvs[sv * 2] = uvs[src * 2]!
      uvs[sv * 2 + 1] = uvs[src * 2 + 1]!
      skirtIdx.push(sv)
      return sv++
    }

    const quads: number[] = []
    for (let j = 0; j < G - 1; j++) {
      for (let i = 0; i < G - 1; i++) {
        const a = edge(i, j)
        const b = edge(i + 1, j)
        const d = edge(i, j + 1)
        const e = edge(i + 1, j + 1)
        quads.push(a, d, b, b, d, e)
      }
    }
    // Skirt quads along each edge.
    const addSkirtEdge = (cells: number[]) => {
      let prevTop = cells[0]!
      let prevBot = pushSkirt(prevTop)
      for (let k = 1; k < cells.length; k++) {
        const top = cells[k]!
        const bot = pushSkirt(top)
        quads.push(prevTop, prevBot, top, top, prevBot, bot)
        prevTop = top
        prevBot = bot
      }
    }
    addSkirtEdge(Array.from({ length: G }, (_, i) => edge(i, 0)))
    addSkirtEdge(Array.from({ length: G }, (_, i) => edge(G - 1 - i, G - 1)))
    addSkirtEdge(Array.from({ length: G }, (_, j) => edge(0, G - 1 - j)))
    addSkirtEdge(Array.from({ length: G }, (_, j) => edge(G - 1, j)))
    void skirtIdx
    void vertsPerRow

    const indices = new Uint32Array(quads)
    const resp: TileResponse = {
      key: req.key,
      positions,
      normals,
      colors,
      uvs,
      indices,
      heights,
      gridSize: G,
    }
    ;(self as unknown as Worker).postMessage(resp, [
      positions.buffer,
      normals.buffer,
      colors.buffer,
      uvs.buffer,
      indices.buffer,
      heights.buffer,
    ])
  } catch (err) {
    ;(self as unknown as Worker).postMessage({ key: req.key, error: String(err) })
  }
}
