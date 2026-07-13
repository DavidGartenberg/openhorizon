import * as THREE from 'three'

/** Smoothed chase camera: sits behind and above the aircraft along its
 *  heading, with soft position/target filtering for a stable feel. */
export class ChaseCamera {
  private readonly desired = new THREE.Vector3()
  private readonly target = new THREE.Vector3()
  private readonly smoothedTarget = new THREE.Vector3()
  private initialized = false

  constructor(
    private readonly camera: THREE.PerspectiveCamera,
    private distance = 13,
    private height = 3.8,
  ) {}

  update(dt: number, aircraftPos: THREE.Vector3, headingRad: number): void {
    // Behind the aircraft along its heading (render: north = -z).
    const hx = Math.sin(headingRad) // east component of heading
    const hz = -Math.cos(headingRad) // render z component
    this.desired.set(
      aircraftPos.x - hx * this.distance,
      aircraftPos.y + this.height,
      aircraftPos.z - hz * this.distance,
    )
    this.target.copy(aircraftPos)
    this.target.y += 1.2

    if (!this.initialized) {
      this.camera.position.copy(this.desired)
      this.smoothedTarget.copy(this.target)
      this.initialized = true
    }
    const k = 1 - Math.exp(-4.5 * dt)
    this.camera.position.lerp(this.desired, k)
    this.smoothedTarget.lerp(this.target, 1 - Math.exp(-8 * dt))
    // Never below the ground plane.
    this.camera.position.y = Math.max(this.camera.position.y, 1.2)
    this.camera.lookAt(this.smoothedTarget)
  }
}
