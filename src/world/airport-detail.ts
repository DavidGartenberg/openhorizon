/**
 * Airport surface detail (13a′, user-requested): FAA-style runway markings
 * (threshold stripes by width, painted runway numbers, aiming point,
 * touchdown-zone bars), distance-remaining boards every 1,000 ft, a
 * procedural parallel taxiway with connectors, holding-position and
 * location signs, and an apron with terminal (jet fields) or hangars (GA).
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
const TAXI_GREY = new THREE.MeshStandardMaterial({ color: 0x2c2f33, roughness: 0.96 })
const TAXI_LINE = new THREE.MeshBasicMaterial({ color: 0xd9c04a })
const APRON_GREY = new THREE.MeshStandardMaterial({ color: 0x33373c, roughness: 0.95 })
const BUILDING = new THREE.MeshStandardMaterial({ color: 0xb9bec5, roughness: 0.7 })
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

type Quad = { x: number; y: number; w: number; l: number; rotZ?: number }

/** Merge flat quads (runway-local x/y, painted at z≈0) into one geometry. */
function mergedQuads(quads: Quad[], r: RunwayLocal, lift: number): THREE.BufferGeometry {
  const pos: number[] = []
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
    }
    idx.push(base, base + 1, base + 2, base, base + 2, base + 3)
  }
  const g = new THREE.BufferGeometry()
  g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(pos), 3))
  g.setIndex(idx)
  g.computeVertexNormals()
  return g
}

const FT = 0.3048

/** FAA threshold stripe count by runway width. */
function thresholdStripes(widM: number): number {
  const wFt = widM / FT
  if (wFt >= 150) return 12
  if (wFt >= 100) return 8
  if (wFt >= 75) return 6
  return 4
}

/** Painted markings for one paved runway → ONE mesh + 2 number quads. */
export function buildRunwayMarkings(r: RunwayLocal): THREE.Group {
  const g = new THREE.Group()
  const quads: Quad[] = []
  const halfLen = r.lenM / 2

  for (const end of [-1, 1] as const) {
    // Threshold stripes: 30 m × 1.75 m starting 6 m from the threshold.
    const n = thresholdStripes(r.widM)
    const usable = r.widM * 0.85
    const gap = usable / n
    for (let i = 0; i < n; i++) {
      const x = -usable / 2 + gap * (i + 0.5) + (i >= n / 2 ? gap * 0.35 : -gap * 0.35)
      quads.push({ x, y: end * (halfLen - 6 - 15), w: 1.75, l: 30 })
    }
    // Aiming point: 45 m × 6 m pair at 305 m (1,000 ft), runways ≥ 4,200 ft.
    if (r.lenM >= 1280) {
      for (const side of [-1, 1]) {
        quads.push({ x: side * r.widM * 0.19, y: end * (halfLen - 305 - 22.5), w: 6, l: 45 })
      }
    }
    // Touchdown-zone bars at 500-ft stations (skip the aiming point), ≥ 6,000 ft.
    if (r.lenM >= 1800) {
      for (const stationFt of [500, 1500, 2000, 2500, 3000]) {
        const y = end * (halfLen - stationFt * FT - 11.5)
        if (Math.abs(y) > halfLen - 40) continue
        for (const side of [-1, 1]) {
          quads.push({ x: side * r.widM * 0.24, y, w: 1.8, l: 23 })
        }
      }
    }
  }
  const paint = new THREE.Mesh(mergedQuads(quads, r, 0.16), MARK_WHITE)
  paint.renderOrder = 22
  g.add(paint)

  // Painted runway numbers (canvas textures), reading toward the arriving pilot.
  for (const end of [-1, 1] as const) {
    const ident = end === -1 ? r.liIdent : r.hiIdent
    const tex = textTexture(ident.length > 2 ? ident : ident, '#f0f2f0', 'transparent', 256, 256, ident.length > 2 ? 88 : 120)
    const mat = new THREE.MeshBasicMaterial({ map: tex, transparent: true })
    const quad = new THREE.Mesh(new THREE.PlaneGeometry(12, 15), mat)
    const y = end * (halfLen - 55)
    quad.rotation.x = -Math.PI / 2
    quad.rotation.z = end === -1 ? 0 : Math.PI
    quad.position.set(0, r.elevAt(y / r.lenM) + 0.17, -y)
    quad.renderOrder = 22
    g.add(quad)
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
      const mat = new THREE.MeshBasicMaterial({ map: tex })
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
  const m = new THREE.Mesh(new THREE.PlaneGeometry(wM, 0.8), new THREE.MeshBasicMaterial({ map: tex, side: THREE.DoubleSide }))
  return m
}

/** Procedural parallel taxiway + connectors + signs + apron/terminal. */
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

  // Apron + buildings on the taxiway side.
  const apronX = off + twW / 2 + (big ? 65 : 35)
  const apronW = big ? 130 : 70
  const apronL = big ? 220 : 110
  const apron = new THREE.Mesh(mergedQuads([{ x: apronX, y: 0, w: apronW, l: apronL }], r, 0.04), APRON_GREY)
  apron.receiveShadow = true
  apron.renderOrder = 20
  g.add(apron)
  // Apron link to the taxiway.
  const link = new THREE.Mesh(mergedQuads([{ x: off + (apronX - apronW / 2 - off) / 2 + 2, y: 0, w: apronX - apronW / 2 - off + 8, l: twW, rotZ: 0 }], r, 0.05), TAXI_GREY)
  link.receiveShadow = true
  link.renderOrder = 20
  g.add(link)

  const elev0 = r.elevAt(0)
  if (big) {
    // Terminal: main block + concourse + three jet-bridge stubs.
    const terminal = new THREE.Mesh(new THREE.BoxGeometry(24, 14, 150), BUILDING)
    terminal.position.set(apronX + apronW / 2 - 10, elev0 + 7, 0)
    terminal.castShadow = terminal.receiveShadow = true
    g.add(terminal)
    const concourse = new THREE.Mesh(new THREE.BoxGeometry(10, 9, 170), BUILDING)
    concourse.position.set(apronX + apronW / 2 - 26, elev0 + 4.5, 0)
    concourse.castShadow = concourse.receiveShadow = true
    g.add(concourse)
    for (const zy of [-55, 0, 55]) {
      const bridge = new THREE.Mesh(new THREE.BoxGeometry(14, 3.2, 3.2), BUILDING_DARK)
      bridge.position.set(apronX + apronW / 2 - 38, elev0 + 5, zy)
      bridge.castShadow = true
      g.add(bridge)
    }
    const tower = new THREE.Mesh(new THREE.CylinderGeometry(2.2, 3.0, 24, 8), BUILDING)
    tower.position.set(apronX + apronW / 2 - 5, elev0 + 12, apronL / 2 + 30)
    tower.castShadow = true
    g.add(tower)
    const cab = new THREE.Mesh(new THREE.CylinderGeometry(4.2, 3.4, 4.5, 8), BUILDING_DARK)
    cab.position.set(apronX + apronW / 2 - 5, elev0 + 26, apronL / 2 + 30)
    cab.castShadow = true
    g.add(cab)
  } else {
    // GA: two hangars + FBO shack.
    for (const [i, zy] of [-30, 12].entries()) {
      const hangar = new THREE.Mesh(new THREE.BoxGeometry(22, 7, 26), i === 0 ? BUILDING : BUILDING_DARK)
      hangar.position.set(apronX + apronW / 2 - 8, elev0 + 3.5, zy)
      hangar.castShadow = hangar.receiveShadow = true
      g.add(hangar)
    }
    const fbo = new THREE.Mesh(new THREE.BoxGeometry(10, 4, 12), BUILDING)
    fbo.position.set(apronX + apronW / 2 - 4, elev0 + 2, 42)
    fbo.castShadow = true
    g.add(fbo)
  }
  return g
}
