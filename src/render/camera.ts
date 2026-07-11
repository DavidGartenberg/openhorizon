import * as THREE from 'three'
import type { Input } from '../input/input'

/**
 * Phase 0 camera rig: free fly camera. Left-drag to look, WASD to move,
 * R/F up/down, Shift ×8 speed, wheel scales base speed. The full camera-mode
 * system (cockpit/chase/orbit/tower/drone, §7) arrives with the aircraft.
 */
export class FlyCamera {
  private yaw = Math.PI // start looking north-ish over the water
  private pitch = -0.06
  private speed = 60 // m/s

  private readonly forward = new THREE.Vector3()
  private readonly right = new THREE.Vector3()
  private readonly move = new THREE.Vector3()

  constructor(private readonly camera: THREE.PerspectiveCamera) {}

  update(dtSeconds: number, input: Input): void {
    const { dx, dy } = input.consumeMouseDelta()
    this.yaw -= dx * 0.0026
    this.pitch = THREE.MathUtils.clamp(this.pitch - dy * 0.0026, -1.55, 1.55)

    const wheel = input.consumeWheel()
    if (wheel !== 0) {
      this.speed = THREE.MathUtils.clamp(this.speed * Math.pow(1.25, -Math.sign(wheel)), 2, 2000)
    }

    this.camera.quaternion.setFromEuler(new THREE.Euler(this.pitch, this.yaw, 0, 'YXZ'))

    this.camera.getWorldDirection(this.forward)
    this.right.crossVectors(this.forward, this.camera.up).normalize()

    const boost = input.isHeld('ShiftLeft') || input.isHeld('ShiftRight') ? 8 : 1
    this.move
      .set(0, 0, 0)
      .addScaledVector(this.forward, input.axis('KeyW', 'KeyS'))
      .addScaledVector(this.right, input.axis('KeyD', 'KeyA'))
    this.move.y += input.axis('KeyR', 'KeyF')

    if (this.move.lengthSq() > 0) {
      this.move.normalize()
      this.camera.position.addScaledVector(this.move, this.speed * boost * dtSeconds)
    }

    // Stay above the water.
    this.camera.position.y = Math.max(this.camera.position.y, 2)
  }

  get position(): THREE.Vector3 {
    return this.camera.position
  }

  get speedMs(): number {
    return this.speed
  }
}
