import * as THREE from 'three'

/**
 * Painted fuselage liveries (goal: "add textures to the plane"). A canvas
 * texture wraps each fuselage cylinder: base paint + belly tone, accent
 * cheatlines, a real cabin-window row per side, door outlines, faint
 * panel seams, airline-neutral "OPENHORIZON" titles and a registration.
 * Branding is deliberately fictional — no real airline's trade dress.
 *
 * UV frame (verified on screen — the first cut was a quarter-turn off):
 *   THREE's CylinderGeometry starts u=0 at local +Z, which the builders'
 *   rotation.x = π/2 sends to render −Y. So u (canvas x): 0/1 = BELLY,
 *   0.25 = right side, 0.5 = crown, 0.75 = left side — the wrap seam
 *   hides on the belly and each side paints once, seam-free.
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

  // Base coat + belly tone (belly = both canvas edges, where the seam hides).
  c.fillStyle = '#f4f5f7'
  c.fillRect(0, 0, W, H)
  const belly = c.createLinearGradient(0, 0, W, 0)
  belly.addColorStop(0.0, 'rgba(160,168,176,0.85)')
  belly.addColorStop(0.12, 'rgba(160,168,176,0.85)')
  belly.addColorStop(0.2, 'rgba(160,168,176,0)')
  belly.addColorStop(0.8, 'rgba(160,168,176,0)')
  belly.addColorStop(0.88, 'rgba(160,168,176,0.85)')
  belly.addColorStop(1.0, 'rgba(160,168,176,0.85)')
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
  cheat(256) // right side
  cheat(768) // left side

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
  winRow(256)
  winRow(768)

  // Door outlines: four per side, spanning the window band height.
  const door = (x: number, y: number): void => {
    c.strokeStyle = 'rgba(40,44,50,0.55)'
    c.lineWidth = 3
    c.beginPath()
    c.roundRect(x - 16, y, 32, 78, 8)
    c.stroke()
  }
  for (const y of [210, 660, 1260, H - 330]) {
    door(256, y)
    door(768, y)
  }

  // Titles on the crown sides (rotated to read along the fuselage) —
  // fictional operator, both sides.
  c.save()
  c.fillStyle = pal.b
  c.font = 'bold 66px sans-serif'
  for (const x of [382, 636]) { // upper sides, just above the window band
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
  for (const x of [300, 716]) {
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
