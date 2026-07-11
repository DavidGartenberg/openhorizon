import * as THREE from 'three'
import { Sky } from 'three/addons/objects/Sky.js'
import { sunPosition, sunDirectionENU } from '../math/solar'

/**
 * Sky dome + sun/ambient lighting driven by the real solar position for the
 * sim date and location. The three.js Sky (Preetham-style scattering) is the
 * Phase 0 baseline; the full custom Hillaire-style sky arrives in Phase 5 (§7).
 */
export class SkyDome {
  readonly sunDir = new THREE.Vector3(0, 1, 0)

  private readonly sky = new Sky()
  private readonly sunLight = new THREE.DirectionalLight(0xffffff, 3)
  private readonly hemiLight = new THREE.HemisphereLight(0x8fb4dd, 0x1c2a38, 0.5)

  /** Current sun elevation in degrees, for HUD/debug. */
  elevationDeg = 0

  constructor(scene: THREE.Scene) {
    this.sky.scale.setScalar(450_000)
    const u = this.sky.material.uniforms
    u.turbidity!.value = 6
    u.rayleigh!.value = 1.6
    u.mieCoefficient!.value = 0.005
    u.mieDirectionalG!.value = 0.8
    scene.add(this.sky, this.sunLight, this.hemiLight)
  }

  /** Position the sun for `date` at (lat, lon); returns the sun direction. */
  update(date: Date, latDeg: number, lonDeg: number): THREE.Vector3 {
    const angles = sunPosition(date, latDeg, lonDeg)
    this.elevationDeg = angles.elevationDeg
    const d = sunDirectionENU(angles)
    this.sunDir.set(d.x, d.y, d.z)

    this.sky.material.uniforms.sunPosition!.value.copy(this.sunDir)
    this.sunLight.position.copy(this.sunDir).multiplyScalar(10_000)

    // Ramp direct light through twilight (-6° civil twilight → +10° full day).
    const dayness = smoothstep(-6, 10, angles.elevationDeg)
    this.sunLight.intensity = 3 * dayness
    this.hemiLight.intensity = 0.04 + 0.5 * dayness

    return this.sunDir
  }
}

function smoothstep(lo: number, hi: number, v: number): number {
  const t = Math.min(1, Math.max(0, (v - lo) / (hi - lo)))
  return t * t * (3 - 2 * t)
}
