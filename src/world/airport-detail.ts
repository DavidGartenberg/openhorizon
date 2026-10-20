/**
 * Airport surface detail (13a′, user-requested): FAA-style runway markings
 * (threshold stripes by width, painted runway numbers, aiming point,
 * touchdown-zone bars), distance-remaining boards every 1,000 ft, a
 * procedural parallel taxiway with connectors and holding-position signs.
 * Facilities and apron service traffic are built separately in airport-scenery.
 *
 * HONESTY NOTE (recorded): real taxiway layouts and terminal footprints
 * are NOT in the free data pipeline (OurAirports has runways only) — the
 * taxiway/apron/terminal geometry is a plausible PROCEDURAL layout, not
 * the real field diagram. Markings and distance boards, by contrast,
 * follow the real FAA geometry rules from the real runway dimensions.
 *
 * Everything is built in the runway-local frame (x = right of heading,
 * y = along from center) inside a group the caller orients; painted
 * markings merge into ONE white geometry per runway (1 draw call).
 */
import * as THREE from 'three'
import { ownMaterial } from './airport-scenery'
import { pavementMaterial } from '../render/surface-materials'
import { runwayMarkQuads, designatorLayout, FT, type Quad } from './runway-marks'

/** Painted markings: unlit, multiplied by a tiling wear map so fresh paint,
 *  scuffs and rubber-dulled patches read like the real thing. */
const MARK_WHITE = new THREE.MeshBasicMaterial({ color: 0xf0f2f0 })
const MARK_WHITE_BASE = 0xf0f2f0
const TAXI_LINE_BASE = 0xd9c04a

/** 16c: painted markings are unlit materials — full-bright at night.
 *  Scale their colors with darkness (signs stay bright: real ones are
 *  internally illuminated). */
export function dimPaintForNight(night: number): void {
  const f = 1 - 0.78 * Math.min(Math.max(night, 0), 1)
  MARK_WHITE.color.setHex(MARK_WHITE_BASE).multiplyScalar(f)
  TAXI_LINE.color.setHex(TAXI_LINE_BASE).multiplyScalar(f)
}
const TAXI_GREY = pavementMaterial(0x45484a, 'xz')
const TAXI_LINE = new THREE.MeshBasicMaterial({ color: 0xd9c04a })
const BUILDING_DARK = new THREE.MeshStandardMaterial({ color: 0x6f757c, roughness: 0.8 })

const textureCache = new Map<string, THREE.CanvasTexture>()

/** Cached canvas text texture (for numbers/signs). */
function textTexture(text: string, fg: string, bg: string, wPx = 128, hPx = 128, fontPx = 90): THREE.CanvasTexture {
  const key = `${text}|${fg}|${bg}|${wPx}x${hPx}`
  const hit = textureCache.get(key)
  if (hit) return hit
  const c = document.createElement('canvas')
  c.width = wPx
  c.height = hPx
  const ctx = c.getContext('2d')!
  if (bg === 'transparent') ctx.clearRect(0, 0, wPx, hPx)
  else {
    ctx.fillStyle = bg
    ctx.fillRect(0, 0, wPx, hPx)
  }
  ctx.fillStyle = fg
  ctx.font = `bold ${fontPx}px Arial, sans-serif`
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  ctx.fillText(text, wPx / 2, hPx / 2)
  const tex = new THREE.CanvasTexture(c)
  tex.colorSpace = THREE.SRGBColorSpace
  tex.anisotropy = 4
  textureCache.set(key, tex)
  return tex
}

/** Runway geometry facts the builders need (runway-local frame). */
export interface RunwayLocal {
  lenM: number
  widM: number
  liIdent: string // low end (at y = -len/2)
  hiIdent: string // high end (at y = +len/2)
  elevAt: (t: number) => number // t ∈ [-0.5, 0.5] → elevation offset vs center
}

/** Merge flat quads (runway-local x/y, painted at z≈0) into one geometry. */
function mergedQuads(quads: Quad[], r: RunwayLocal, lift: number): THREE.BufferGeometry {
  const pos: number[] = []
  const uv: number[] = []
  const idx: number[] = []
  for (const q of quads) {
    const c = Math.cos(q.rotZ ?? 0)
    const s = Math.sin(q.rotZ ?? 0)
    const hw = q.w / 2
    const hl = q.l / 2
    const base = pos.length / 3
    for (const [dx, dy] of [[-hw, -hl], [hw, -hl], [hw, hl], [-hw, hl]] as const) {
      const x = q.x + dx * c - dy * s
      const y = q.y + dx * s + dy * c
      const t = y / r.lenM
      pos.push(x, r.elevAt(Math.max(-0.5, Math.min(0.5, t))) + lift, -y)
      uv.push(x / PAINT_TILE_M, y / PAINT_TILE_M) // wear map tiles in world metres
    }
    idx.push(base, base + 1, base + 2, base, base + 2, base + 3)
  }
  const g = new THREE.BufferGeometry()
  g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(pos), 3))
  g.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(uv), 2))
  g.setIndex(idx)
  g.computeVertexNormals()
  return g
}

const PAINT_TILE_M = 6
let wearTex: THREE.CanvasTexture | null = null

/** Tiling grayscale wear map (1 = fresh paint, lower = scuffed / dulled). */
function paintWearTexture(): THREE.CanvasTexture {
  if (wearTex) return wearTex
  const N = 128
  const c = document.createElement('canvas')
  c.width = N; c.height = N
  const ctx = c.getContext('2d')!
  const img = ctx.createImageData(N, N)
  const hash = (x: number, y: number): number => {
    const h = Math.sin(x * 127.1 + y * 311.7) * 43758.5453
    return h - Math.floor(h)
  }
  const vnoise = (x: number, y: number, period: number): number => {
    const xi = Math.floor(x), yi = Math.floor(y), xf = x - xi, yf = y - yi
    const u = xf * xf * (3 - 2 * xf), v = yf * yf * (3 - 2 * yf)
    const h = (a: number, b: number): number => hash(((a % period) + period) % period, ((b % period) + period) % period)
    return (h(xi, yi) * (1 - u) + h(xi + 1, yi) * u) * (1 - v) + (h(xi, yi + 1) * (1 - u) + h(xi + 1, yi + 1) * u) * v
  }
  for (let y = 0; y < N; y++) {
    for (let x = 0; x < N; x++) {
      const broad = vnoise(x / 32 * 4, y / 32 * 4, 4) // 4 cells per tile
      const mid = vnoise(x / 8, y / 8, 16)
      const fine = hash(x * 1.7, y * 1.3)
      let v = 0.9 + 0.1 * broad - 0.1 * mid
      if (fine > 0.93) v -= 0.18 + 0.2 * (fine - 0.93) / 0.07 // chips and scuffs
      const g = Math.max(0.45, Math.min(1, v))
      const k = (y * N + x) * 4
      img.data[k] = img.data[k + 1] = img.data[k + 2] = Math.round(g * 255)
      img.data[k + 3] = 255
    }
  }
  ctx.putImageData(img, 0, 0)
  wearTex = new THREE.CanvasTexture(c)
  wearTex.wrapS = wearTex.wrapT = THREE.RepeatWrapping
  wearTex.colorSpace = THREE.SRGBColorSpace
  wearTex.anisotropy = 8
  return wearTex
}

/** Tall, narrow runway numeral/letter glyphs (FAA numerals are ~3:5). */
function numeralTexture(text: string): THREE.CanvasTexture {
  const key = `numeral|${text}`
  const hit = textureCache.get(key)
  if (hit) return hit
  const W = 256, H = 384
  const c = document.createElement('canvas')
  c.width = W; c.height = H
  const ctx = c.getContext('2d')!
  ctx.clearRect(0, 0, W, H)
  ctx.fillStyle = '#f0f2f0'
  ctx.font = `bold ${Math.round(H * 0.82)}px "Arial Narrow", Arial, sans-serif`
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  const m = ctx.measureText ? ctx.measureText(text) : { width: 0 }
  const fit = m.width > W * 0.94 ? (W * 0.94) / m.width : 1
  ctx.save()
  ctx.translate(W / 2, H / 2 + H * 0.04)
  ctx.scale(fit, 1)
  ctx.fillText(text, 0, 0)
  ctx.restore()
  const tex = new THREE.CanvasTexture(c)
  tex.colorSpace = THREE.SRGBColorSpace
  tex.anisotropy = 8
  textureCache.set(key, tex)
  return tex
}

/** Painted markings for one paved runway → ONE mesh (edge lines, centerline,
 *  threshold stripes, aiming points, touchdown bars) + the designator glyphs. */
export function buildRunwayMarkings(r: RunwayLocal): THREE.Group {
  const g = new THREE.Group()
  const halfLen = r.lenM / 2
  MARK_WHITE.map = paintWearTexture()
  MARK_WHITE.needsUpdate = true
  const paint = new THREE.Mesh(mergedQuads(runwayMarkQuads(r.lenM, r.widM), r, 0.16), MARK_WHITE)
  paint.renderOrder = 22
  g.add(paint)

  // Painted designators (numerals + L/R/C), reading toward the arriving pilot.
  for (const end of [-1, 1] as const) {
    const ident = end === -1 ? r.liIdent : r.hiIdent
    const { glyphs, heightM } = designatorLayout(ident)
    for (const gl of glyphs) {
      const wM = gl.text.length > 1 ? 12 : 8
      const mat = ownMaterial(new THREE.MeshBasicMaterial({ map: numeralTexture(gl.text), transparent: true }))
      const quad = new THREE.Mesh(new THREE.PlaneGeometry(wM, heightM), mat)
      const y = end * (halfLen - gl.distM)
      quad.rotation.x = -Math.PI / 2
      quad.rotation.z = end === -1 ? 0 : Math.PI
      quad.position.set(0, r.elevAt(y / r.lenM) + 0.17, -y)
      quad.renderOrder = 22
      g.add(quad)
    }
  }
  return g
}

/** Distance-remaining boards every 1,000 ft, both faces numbered. */
export function buildDistanceSigns(r: RunwayLocal): THREE.Group {
  const g = new THREE.Group()
  if (r.lenM < 1800) return g
  const lenFt = r.lenM / FT
  const xOff = -(r.widM / 2 + 12) // left of the low-end heading
  for (let stationFt = 1000; stationFt < lenFt - 500; stationFt += 1000) {
    const y = -r.lenM / 2 + stationFt * FT
    const remainHiK = Math.floor((lenFt - stationFt) / 1000)
    const remainLoK = Math.floor(stationFt / 1000)
    for (const [face, k] of [[1, remainHiK], [-1, remainLoK]] as const) {
      if (k < 1) continue
      const tex = textTexture(String(k), '#ffffff', '#111111', 96, 128, 96)
      const mat = ownMaterial(new THREE.MeshBasicMaterial({ map: tex }))
      const sign = new THREE.Mesh(new THREE.PlaneGeometry(1.5, 2.0), mat)
      sign.position.set(xOff, r.elevAt(y / r.lenM) + 1.6, -y + face * 0.03)
      sign.rotation.y = face === 1 ? Math.PI : 0
      g.add(sign)
    }
    const post = new THREE.Mesh(new THREE.BoxGeometry(0.12, 1.2, 0.12), BUILDING_DARK)
    post.position.set(xOff, r.elevAt(y / r.lenM) + 0.6, -y)
    g.add(post)
  }
  return g
}

function taxiSign(text: string, fg: string, bg: string, wM = 2.2): THREE.Mesh {
  const tex = textTexture(text, fg, bg, 256, 96, 56)
  const m = new THREE.Mesh(new THREE.PlaneGeometry(wM, 0.8), ownMaterial(new THREE.MeshBasicMaterial({ map: tex, side: THREE.DoubleSide })))
  return m
}

/** Procedural parallel taxiway + connectors + signs; facilities are independent. */
export function buildTaxiwayComplex(r: RunwayLocal, big: boolean, edgeLightsOut?: THREE.Vector3[]): THREE.Group {
  const g = new THREE.Group()
  const off = r.widM / 2 + 32 // taxiway centerline offset (right of low heading)
  const twW = big ? 15 : 10

  const quads: Quad[] = [{ x: off, y: 0, w: twW, l: r.lenM * 0.94 }]
  const connectors = [-0.44, 0, 0.44].map((f) => f * r.lenM)
  // 16c: taxiway blue edge lights, LOCAL detail-frame positions (x
  // lateral, y up, z = −along) for the caller's night layer.
  if (edgeLightsOut) {
    const halfLen = (r.lenM * 0.94) / 2
    for (let a = -halfLen; a <= halfLen; a += 30) {
      for (const side of [-1, 1]) {
        edgeLightsOut.push(new THREE.Vector3(off + side * (twW / 2 + 1), r.elevAt(a / r.lenM) + 0.4, -a))
      }
    }
    for (const cy of connectors) {
      for (let x = r.widM / 2 + 4; x < off - twW / 2 - 2; x += 10) {
        for (const side of [-1, 1]) {
          edgeLightsOut.push(new THREE.Vector3(x, r.elevAt(cy / r.lenM) + 0.4, -(cy + side * (twW / 2 + 1))))
        }
      }
    }
  }
  for (const cy of connectors) quads.push({ x: off / 2, y: cy, w: 32, l: twW, rotZ: Math.PI / 2 })
  const pave = new THREE.Mesh(mergedQuads(quads, r, 0.05), TAXI_GREY)
  pave.receiveShadow = true
  pave.renderOrder = 20
  g.add(pave)

  // Yellow taxi centerlines.
  const lines: Quad[] = [{ x: off, y: 0, w: 0.3, l: r.lenM * 0.92 }]
  for (const cy of connectors) lines.push({ x: off / 2, y: cy, w: 26, l: 0.3, rotZ: Math.PI / 2 })
  const line = new THREE.Mesh(mergedQuads(lines, r, 0.12), TAXI_LINE)
  line.renderOrder = 21
  g.add(line)

  // Signs at each connector: holding position (white on red) + location (yellow on black).
  const holdText = `${r.liIdent}-${r.hiIdent}`
  const names = ['A1', 'A2', 'A3']
  connectors.forEach((cy, i) => {
    const sx = r.widM / 2 + 8
    const hold = taxiSign(holdText, '#ffffff', '#a01212')
    hold.position.set(sx, r.elevAt(cy / r.lenM) + 0.7, -(cy + twW / 2 + 3))
    g.add(hold)
    const loc = taxiSign(names[i]!, '#e8c545', '#111111', 1.2)
    loc.position.set(sx + 1.9, r.elevAt(cy / r.lenM) + 0.7, -(cy + twW / 2 + 3))
    g.add(loc)
    for (const m of [hold, loc]) {
      const post = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.5, 0.1), BUILDING_DARK)
      post.position.copy(m.position).y -= 0.55
      g.add(post)
    }
  })

  return g
}
