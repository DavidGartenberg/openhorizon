import * as THREE from 'three'

/** Smoothed chase camera: sits behind and above the aircraft along its
 *  heading, with soft position/target filtering for a stable feel. */
export class ChaseCamera {
  private readonly desired = new THREE.Vector3()
  private readonly target = new THREE.Vector3()
  private readonly smoothedTarget = new THREE.Vector3()
  private initialized = false
  private groundProbe: ((x: number, z: number) => number) | null = null

  /** Terrain height probe (render x/z → render y of the ground). With it
   *  set, the camera never sinks below the terrain + 2.5 m — large
   *  airframes' long follow distance used to bury the camera in the berm
   *  behind KHAF 30's threshold. */
  setGroundProbe(fn: (x: number, z: number) => number): void {
    this.groundProbe = fn
  }

  constructor(
    private readonly camera: THREE.PerspectiveCamera,
    private distance = 13,
    private height = 3.8,
  ) {}

  /** Scale the follow distance/height for larger airframes (the defaults
   *  were tuned around an 11 m-span C172 — a 36 m 737 put the camera
   *  INSIDE the fuselage). */
  setSizeScale(scale: number): void {
    this.distance = 13 * scale
    this.height = 3.8 * scale
  }

  /** Shift internal smoothed state after a floating-origin rebase. */
  shiftWorld(dxRender: number, dzRender: number): void {
    this.smoothedTarget.x += dxRender
    this.smoothedTarget.z += dzRender
  }

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
    // Never below the ground plane — nor below the terrain under the camera.
    const floor = this.groundProbe ? this.groundProbe(this.camera.position.x, this.camera.position.z) + 2.5 : 1.2
    this.camera.position.y = Math.max(this.camera.position.y, floor, 1.2)
    this.camera.lookAt(this.smoothedTarget)
  }
}
