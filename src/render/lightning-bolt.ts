import * as THREE from 'three'
import { boltSegments } from '../sim/weather/lightning'

/** A visible lightning channel: bright additive lines that flicker through a
 *  few return strokes (~0.35 s) and are gone. One bolt at a time. */
export class LightningBolt {
  private readonly line: THREE.LineSegments
  private readonly material = new THREE.LineBasicMaterial({ color: 0xe8f0ff, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, opacity: 0 })
  private startedAt = -Infinity
  private strokes: number[] = []

  constructor(scene: THREE.Scene) {
    this.line = new THREE.LineSegments(new THREE.BufferGeometry(), this.material)
    this.line.frustumCulled = false
    this.line.visible = false
    this.line.renderOrder = 7
    scene.add(this.line)
  }

  /** Strike at a render-frame ground point under a cloud base `heightM` up. */
  strike(x: number, groundY: number, z: number, heightM: number, nowMs: number, seed = Math.floor(Math.random() * 1e9)): void {
    const geo = new THREE.BufferGeometry()
    geo.setAttribute('position', new THREE.Float32BufferAttribute(boltSegments(heightM, seed), 3))
    this.line.geometry.dispose()
    this.line.geometry = geo
    this.line.position.set(x, groundY, z)
    this.startedAt = nowMs
    // Return strokes: main flash, 1–3 restrikes.
    this.strokes = [0, 60 + Math.random() * 40, 140 + Math.random() * 60, 230 + Math.random() * 80].slice(0, 2 + Math.floor(Math.random() * 3))
  }

  update(nowMs: number): void {
    const t = nowMs - this.startedAt
    if (t > 400) { this.line.visible = false; return }
    const on = this.strokes.some((s) => t >= s && t < s + 45)
    this.line.visible = true
    this.material.opacity = on ? 1 : 0.15
  }
}
