import * as THREE from 'three'
import { aircraftPaint } from './aircraft-materials'

// CylinderGeometry + rotation.x = PI/2: u=0/1 belly, .25 starboard,
// .5 crown, .75 port. Local +Y (v=1, canvas top) rotates to +Z, AFT.
// Thus distance from the forward end maps to canvas y = H - distance * sy.
const W = 1024, H = 2048
const PALETTES = [
  { a: '#0e7c86', b: '#123a5c' }, { a: '#b3372b', b: '#3c3f45' },
  { a: '#d97b29', b: '#1f3a5f' }, { a: '#2b7bbd', b: '#1b2a4a' },
]
function hashCode(s: string): number {
  let h = 0
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0
  return Math.abs(h)
}
interface LiveryMaps { color: THREE.Texture; roughness: THREE.Texture; bump: THREE.Texture; users?: number }
const cache = new Map<string, LiveryMaps>()
/** Corporate cabin layouts: window counts are visual family approximations.
 * These aircraft do not carry transport-airliner titles or four exit doors. */
const BUSINESS_WINDOWS: Record<string, number> = {
  C525:5,C25A:6,C25B:7,C25C:7,C56X:7,C680:9,C68A:8,C750:8,
  E50P:4,E55P:6,HDJT:4,CL30:6,CL35:6,F2TH:8,FA7X:10,
  GLF4:6,GLF5:7,GLF6:8,GL5T:10,GLEX:12,
}
export function isBusinessLivery(designator: string): boolean { return designator in BUSINESS_WINDOWS }
function disposeIfRetired(maps: LiveryMaps): void {
  if ((maps.users ?? 0) > 0 || [...cache.values()].includes(maps)) return
  maps.color.dispose(); maps.roughness.dispose(); maps.bump.dispose()
}
export function liveryAccent(designator: string): { a: string; b: string } {
  return PALETTES[hashCode(designator) % PALETTES.length]!
}
function solidTexture(r: number, g: number, b: number): THREE.DataTexture {
  const texture = new THREE.DataTexture(new Uint8Array([r, g, b, 255]), 1, 1)
  texture.needsUpdate = true
  return texture
}
function liveryMaps(designator: string, lengthM: number, radiusM: number): LiveryMaps {
  const key = `${designator}:${lengthM}:${radiusM}:${typeof document}`
  const hit = cache.get(key)
  if (hit) { cache.delete(key); cache.set(key, hit); return hit }
  // Import and headless aircraft construction never require a browser DOM.
  if (typeof document === 'undefined') {
    return { color: solidTexture(215, 218, 222), roughness: solidTexture(112, 112, 112), bump: solidTexture(128, 128, 128) }
  }
  const makeCanvas = (): [HTMLCanvasElement, CanvasRenderingContext2D] => {
    const canvas = document.createElement('canvas'); canvas.width = W; canvas.height = H
    return [canvas, canvas.getContext('2d')!]
  }
  const [colorCanvas, c] = makeCanvas(), [roughCanvas, r] = makeCanvas(), [bumpCanvas, b] = makeCanvas()
  const sx = W / (2 * Math.PI * Math.max(radiusM, 0.4))
  const sy = H / Math.max(lengthM, 2)
  const business = isBusinessLivery(designator)
  c.fillStyle = '#d7dade'; c.fillRect(0, 0, W, H)
  r.fillStyle = '#a0a0a0'; r.fillRect(0, 0, W, H)
  b.fillStyle = '#808080'; b.fillRect(0, 0, W, H)
  const belly = c.createLinearGradient(0, 0, W, 0)
  for (const [at, value] of [[0, '#98a1ac'], [.14, '#b3bbc3'], [.29, '#d7dade'], [.5, '#e3e5e7'], [.71, '#d7dade'], [.86, '#b3bbc3'], [1, '#98a1ac']] as const) belly.addColorStop(at, value)
  c.fillStyle = belly; c.fillRect(0, 0, W, H)
  if (business) { c.fillStyle = '#f0f1ef'; c.fillRect(0,0,W,H) }

  // Narrow frame joins and restrained, nonuniform panel tone; dimensions in meters.
  for (let frame = 0, y = 0; y < H; frame++, y += sy * 1.65) {
    c.fillStyle = `rgba(48,59,70,${0.006 + (hashCode(designator + frame) % 5) * 0.003})`
    c.fillRect(0, y, W, sy * 1.65)
    c.fillStyle = 'rgba(49,61,73,0.11)'; c.fillRect(0, y, W, .7)
    b.fillStyle = '#727272'; b.fillRect(0, y, W, .7)
  }
  // Lower service/wet streaks, deterministic and soft-edged.
  for (let i = 0; i < 70; i++) {
    const seed = hashCode(designator + ':' + i)
    const x = ((seed % 997) / 997) * W, y = ((seed % 1789) / 1789) * H
    const streak = c.createLinearGradient(x, y, x, y + sy * .42)
    streak.addColorStop(0, 'rgba(74,69,60,.025)'); streak.addColorStop(1, 'rgba(74,69,60,0)')
    c.fillStyle = streak; c.fillRect(x, y, Math.max(1, sx * .015), sy * .42)
  }
  const path = (ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, radius: number): void => {
    ctx.beginPath(); ctx.roundRect(x - w / 2, y - h / 2, w, h, radius)
  }
  // A window is .46 m tall around the circumference and .30 m wide
  // along the barrel; separate maps make its inset glazing smooth and dark.
  const windowAt = (x: number, y: number): void => {
    const gulfstream = /^GLF[456]$/.test(designator)
    const w = sx * (gulfstream ? .69 : business ? .40 : .46)
    const h = sy * (gulfstream ? .51 : business ? .34 : .30)
    path(c, x, y, w + sx * .055, h + sy * .045, Math.min(w, h) * .38)
    c.fillStyle = '#9aa3ad'; c.fill()
    path(c, x, y, w, h, Math.min(w, h) * .40)
    const glass = c.createLinearGradient(x - w / 2, y - h / 2, x + w / 2, y + h / 2)
    glass.addColorStop(0, '#101d2b'); glass.addColorStop(.48, '#294658'); glass.addColorStop(.63, '#59727e'); glass.addColorStop(1, '#172431')
    c.fillStyle = glass; c.fill()
    c.strokeStyle = '#65717a'; c.lineWidth = .7; c.stroke()
    path(r, x, y, w, h, Math.min(w, h) * .4); r.fillStyle = '#252525'; r.fill()
    path(b, x, y, w, h, Math.min(w, h) * .4); b.fillStyle = '#505050'; b.fill()
  }
  const doors = business ? [.12] : lengthM > 35 ? [.08, .32, .65, .91] : [.085, .91]
  for (const side of [.25, .75]) {
    const x = side * W + (business ? (side < .5 ? 1 : -1) * sx * .18 : 0)
    if (business) {
      const direction = side < .5 ? 1 : -1
      c.fillStyle='#1c3856';c.fillRect(x-direction*sx*.46,0,sx*.075,H)
      c.fillStyle='#a7a38e';c.fillRect(x-direction*sx*.35,0,sx*.035,H)
      const count=BUSINESS_WINDOWS[designator]!
      for(let i=0;i<count;i++) windowAt(x,H*(1-(.23+i/Math.max(1,count-1)*.61)))
    }
    for (let distance = 1.8; !business && distance < lengthM - 1.8; distance += .78) {
      const y = H - distance * sy
      if (doors.some(d => Math.abs(y - (1 - d) * H) < sy * .67)) continue
      windowAt(x, y)
    }
    for (const location of doors) {
      if(business && side < .5) continue
      const y = H * (1 - location), w = sx * (business ? 1.35 : 1.77), h = sy * (business ? .67 : .85)
      // Door center lies below the window band toward the belly.
      const doorX = x + (side < .5 ? -1 : 1) * sx * .53
      for (const ctx of [c, r, b]) {
        path(ctx, doorX, y, w, h, Math.min(sx, sy) * .10)
        ctx.lineWidth = Math.max(.8, sx * .010)
        ctx.strokeStyle = ctx === c ? '#7a838b' : ctx === b ? '#555555' : '#bebebe'; ctx.stroke()
      }
      if(!business) windowAt(x, y)
      c.fillStyle = '#65717c'; c.fillRect(doorX - sx * .12, y - sy * .06, sx * .025, sy * .17)
      c.fillStyle = '#b33135'; c.fillRect(doorX - sx * .72, y - sy * .26, sx * .014, sy * .52)
      c.save(); c.translate(x + (side < .5 ? 1 : -1) * sx * .34, y)
      c.rotate(side < .5 ? Math.PI / 2 : -Math.PI / 2)
      c.textAlign = 'center'; c.fillStyle = '#8d3031'; c.font = `600 ${Math.max(5, sx * .065)}px sans-serif`; c.fillText('EXIT', 0, 0); c.restore()
    }
    // The right exterior view has the nose at screen right, the left view
    // has it at screen left. Opposite rotations (without reflection) keep
    // both words upright and reading left-to-right to an exterior observer.
    const direction = side < .5 ? 1 : -1
    c.save(); c.translate(x + direction * sx * .68, H * .76)
    c.rotate(direction * Math.PI / 2)
    c.fillStyle = '#13294b'; c.font = `italic 500 ${sx * .76}px Arial, sans-serif`
    c.textAlign = 'center'
    // Canvas axes have different pixels/meter: size the title along the
    // fuselage explicitly instead of inheriting circumference font scaling.
    const titleLengthM = Math.min(4.8, lengthM * .24)
    c.scale(titleLengthM * sy / Math.max(c.measureText('American').width, 1), 1)
    if(!business) c.fillText('American', 0, 0); c.restore()
    const reg = `N${(hashCode(designator) % 900) + 100}OH`
    c.save(); c.translate(x - direction * sx * .49, H * .17)
    c.rotate(direction * Math.PI / 2)
    c.textAlign = 'center'
    c.fillStyle = '#344353'; c.font = `600 ${sx * .17}px Arial, sans-serif`; c.fillText(reg, 0, 0); c.restore()
  }
  const texture = (canvas: HTMLCanvasElement, color: boolean): THREE.CanvasTexture => {
    const tex = new THREE.CanvasTexture(canvas)
    if (color) tex.colorSpace = THREE.SRGBColorSpace
    tex.anisotropy = 8
    return tex
  }
  const maps = { color: texture(colorCanvas, true), roughness: texture(roughCanvas, false), bump: texture(bumpCanvas, false) }
  cache.set(key, maps)
  // Referenced atlases survive eviction; the final material disposal retires
  // them. Unreferenced cached atlases remain reusable until the next eviction.
  if (cache.size > 8) {
    const oldest=cache.keys().next().value!, retired=cache.get(oldest)!
    cache.delete(oldest);disposeIfRetired(retired)
  }
  return maps
}

export function makeLiveryTexture(designator: string, lengthM: number, radiusM = 1.9): THREE.Texture {
  return liveryMaps(designator, lengthM, radiusM).color
}

export function liveryMaterial(designator: string, lengthM: number, radiusM = 1.9): THREE.MeshPhysicalMaterial {
  const maps = liveryMaps(designator, lengthM, radiusM)
  const material = aircraftPaint(0xffffff, {
    map: maps.color, roughnessMap: maps.roughness, bumpMap: maps.bump, bumpScale: .004,
    roughness: .48, metalness: .22, clearcoat: .4, clearcoatRoughness: .2,
  })
  maps.users = (maps.users ?? 0) + 1
  let released = false
  material.addEventListener('dispose', () => {
    if(released) return
    released=true;maps.users!--;disposeIfRetired(maps)
  })
  return material
}
