import * as THREE from 'three'

/**
 * Painted fuselage liveries (goal: "add textures to the plane"). A canvas
 * texture wraps each fuselage cylinder: base paint + belly tone, accent
 * cheatlines, a real cabin-window row per side, door outlines, faint
 * panel seams, airline-neutral "OPENHORIZON" titles and a registration.
 * Branding is deliberately fictional — no real airline's trade dress.
 *
 * UV frame (CylinderGeometry rotated x=π/2 in both jet builders):
 *   u (canvas x): around the barrel — 0/1 = right side, 0.25 = belly,
 *   0.5 = left side, 0.75 = crown. The u seam sits mid-right-side, so
 *   right-side rows are painted twice (once at each edge) to survive it.
 *   v (canvas y): along the fuselage axis.
 */

const W = 1024
const H = 2048

/** Tasteful fictional palettes, picked stably per designator. */
const PALETTES: Array<{ a: string; b: string }> = [
  { a: '#0e7c86', b: '#123a5c' }, // teal / navy
  { a: '#b3372b', b: '#3c3f45' }, // crimson / slate
  { a: '#d97b29', b: '#1f3a5f' }, // amber / navy
  { a: '#2b7bbd', b: '#1b2a4a' }, // sky / deep blue
]

function hashCode(s: string): number {
  let h = 0
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0
  return Math.abs(h)
}

const cache = new Map<string, THREE.CanvasTexture>()

export function liveryAccent(designator: string): { a: string; b: string } {
  return PALETTES[hashCode(designator) % PALETTES.length]!
}

/** Paint + cache the fuselage wrap for one type. `lengthM` scales window
 *  pitch so a 747 gets more windows than an E175, not stretched ones. */
export function makeLiveryTexture(designator: string, lengthM: number): THREE.CanvasTexture {
  const hit = cache.get(designator)
  if (hit) return hit
  const pal = liveryAccent(designator)
  const canvas = document.createElement('canvas')
  canvas.width = W
  canvas.height = H
  const c = canvas.getContext('2d')!

  // Base coat + belly tone (u bands: belly centered at x=0.25W).
  c.fillStyle = '#f4f5f7'
  c.fillRect(0, 0, W, H)
  const belly = c.createLinearGradient(0, 0, W, 0)
  belly.addColorStop(0.08, 'rgba(160,168,176,0)')
  belly.addColorStop(0.17, 'rgba(160,168,176,0.85)')
  belly.addColorStop(0.33, 'rgba(160,168,176,0.85)')
  belly.addColorStop(0.42, 'rgba(160,168,176,0)')
  c.fillStyle = belly
  c.fillRect(0, 0, W, H)

  // Faint panel seams along the length + a few around the barrel.
  c.strokeStyle = 'rgba(60,66,72,0.10)'
  c.lineWidth = 2
  for (let y = 140; y < H; y += 190) {
    c.beginPath(); c.moveTo(0, y); c.lineTo(W, y); c.stroke()
  }
  for (const x of [128, 384, 640, 896]) {
    c.beginPath(); c.moveTo(x, 0); c.lineTo(x, H); c.stroke()
  }

  // Cheatline pair under the window rows, full length.
  const cheat = (x: number): void => {
    c.fillStyle = pal.a
    c.fillRect(x - 34, 90, 14, H - 180)
    c.fillStyle = pal.b
    c.fillRect(x - 16, 90, 6, H - 180)
  }
  // left side (u=0.5 → x=512); right side split across the seam.
  cheat(512)
  cheat(6); cheat(W - 2) // wrap-safe halves paint past the edges harmlessly

  // Cabin windows: rounded near-black marks along the length. Pitch in
  // canvas-y from real ~1 m frame spacing.
  const pitch = Math.max(22, Math.min(40, (1.0 / (lengthM * 0.72)) * H))
  const winRow = (x: number): void => {
    c.fillStyle = '#14171c'
    for (let y = 200; y < H - 260; y += pitch) {
      c.beginPath()
      c.roundRect(x - 5, y, 10, 15, 4)
      c.fill()
    }
  }
  winRow(512)
  winRow(2); winRow(W - 2)

  // Door outlines: four per side, spanning the window band height.
  const door = (x: number, y: number): void => {
    c.strokeStyle = 'rgba(40,44,50,0.55)'
    c.lineWidth = 3
    c.beginPath()
    c.roundRect(x - 16, y, 32, 78, 8)
    c.stroke()
  }
  for (const y of [210, 660, 1260, H - 330]) {
    door(512, y)
    door(4, y); door(W - 4, y)
  }

  // Titles on the crown sides (rotated to read along the fuselage) —
  // fictional operator, both sides.
  c.save()
  c.fillStyle = pal.b
  c.font = 'bold 66px sans-serif'
  for (const x of [655, 880]) {
    c.save()
    c.translate(x, 330)
    c.rotate(Math.PI / 2)
    c.fillText('OPENHORIZON', 0, 0)
    c.restore()
  }
  c.restore()

  // Registration near the tail, small, both sides.
  const reg = `N${(hashCode(designator) % 900) + 100}OH`
  c.fillStyle = '#3a3f45'
  c.font = 'bold 34px sans-serif'
  for (const x of [560, 940]) {
    c.save()
    c.translate(x, H - 420)
    c.rotate(Math.PI / 2)
    c.fillText(reg, 0, 0)
    c.restore()
  }

  const tex = new THREE.CanvasTexture(canvas)
  tex.colorSpace = THREE.SRGBColorSpace
  tex.anisotropy = 8
  cache.set(designator, tex)
  return tex
}

/** Fuselage material carrying the livery (glossy paint, env-lit). */
export function liveryMaterial(designator: string, lengthM: number): THREE.MeshStandardMaterial {
  return new THREE.MeshStandardMaterial({
    map: makeLiveryTexture(designator, lengthM),
    roughness: 0.3,
    metalness: 0.12,
  })
}
