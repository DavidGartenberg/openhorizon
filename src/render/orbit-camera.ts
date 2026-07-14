import * as THREE from 'three'
import type { Input } from '../input/input'

/** External orbit camera: circles the aircraft. Drag to rotate, wheel to
 *  zoom. Angles are world-relative so the aircraft banks/turns within the
 *  frame — the classic screenshot view. */
export class OrbitCamera {
  private azimuth = 2.3 // rad
  private elevation = 0.18
  private distance = 16

  constructor(private readonly camera: THREE.PerspectiveCamera) {}

  update(input: Input, target: THREE.Vector3): void {
    const { dx, dy } = input.consumeMouseDelta()
    this.azimuth -= dx * 0.005
    this.elevation = THREE.MathUtils.clamp(this.elevation + dy * 0.005, 0.03, 1.35)
    const wheel = input.consumeWheel()
    if (wheel !== 0) {
      this.distance = THREE.MathUtils.clamp(
        this.distance * Math.pow(1.15, Math.sign(wheel)),
        7,
        150,
      )
    }
    const cosEl = Math.cos(this.elevation)
    this.camera.position.set(
      target.x + this.distance * cosEl * Math.sin(this.azimuth),
      Math.max(target.y + this.distance * Math.sin(this.elevation), target.y - 2),
      target.z + this.distance * cosEl * Math.cos(this.azimuth),
    )
    this.camera.lookAt(target)
  }

  /** Keep world-relative state sane across a floating-origin rebase (no-op:
   *  position is recomputed from the target every frame). */
  shiftWorld(): void {}
}
