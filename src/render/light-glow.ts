import * as THREE from 'three'

/** Shared soft radial glow sprite texture (13c night lights). */
let tex: THREE.Texture | null = null

export function lightGlowTexture(): THREE.Texture {
  if (tex) return tex
  const c = document.createElement('canvas')
  c.width = c.height = 64
  const ctx = c.getContext('2d')!
  const g = ctx.createRadialGradient(32, 32, 0, 32, 32, 32)
  g.addColorStop(0, 'rgba(255,255,255,1)')
  g.addColorStop(0.3, 'rgba(255,255,255,0.7)')
  g.addColorStop(1, 'rgba(255,255,255,0)')
  ctx.fillStyle = g
  ctx.fillRect(0, 0, 64, 64)
  tex = new THREE.CanvasTexture(c)
  return tex
}
