import * as THREE from 'three'
import type { Input } from '../input/input'

/**
 * Cockpit (pilot's-eye) camera, Phase 3 Task 2d's 4th camera mode
 * (chase/orbit/free → +cockpit). Sits at the pilot eyepoint in the aircraft
 * body frame and tracks the aircraft's full attitude (heading/pitch/roll),
 * unlike chase/orbit which only track heading (or nothing). Left-drag
 * (while not grabbing a cockpit control — see `src/render/cockpit.ts`)
 * looks around the cabin, clamped so the pilot can't look through their own
 * seatback.
 *
 * Eyepoint offset is a body-frame (x fwd, y right, z down) layout choice —
 * left-seat pilot eye position relative to the aircraft's tracked origin —
 * not a POH-sourced figure, same status as `aircraft-mesh.ts`'s panel
 * placements.
 */
const EYE_X = 0.35 // fwd of origin — puts ~0.65-0.7m between eye and panel (a
                    // realistic GA cockpit eye-to-panel depth), well back from
                    // the panel (body-x ~1.02) and yoke (body-x ~0.68-0.7)
const EYE_Y = -0.33 // left seat (y = right, so negative = left)
const EYE_Z = -0.52 // up (z = down, so negative = up)

export class CockpitCamera {
  private lookYaw = 0
  private lookPitch = 0

  constructor(private readonly camera: THREE.PerspectiveCamera) {}

  /** Keep world-relative state sane across a floating-origin rebase — no-op,
   *  this camera is always positioned relative to the (rebased) aircraft. */
  shiftWorld(): void {}

  /**
   * @param aircraftPos render-space position of the aircraft's tracked origin.
   * @param headingRad/pitchRad/rollRad aircraft attitude, same convention
   *   `main.ts` uses to rotate `mesh.group` (order 'YXZ': yaw=-heading,
   *   pitch=+pitch, roll=-roll).
   * @param input used for click-drag look-around; the caller is expected to
   *   only feed drag deltas here when the pointer isn't grabbing a cockpit
   *   control (see `CockpitInteraction` in `cockpit.ts`).
   */
  update(
    aircraftPos: THREE.Vector3,
    headingRad: number,
    pitchRad: number,
    rollRad: number,
    input: Input,
    consumeLook: boolean,
  ): void {
    if (consumeLook) {
      const { dx, dy } = input.consumeMouseDelta()
      this.lookYaw = THREE.MathUtils.clamp(this.lookYaw - dx * 0.003, -1.4, 1.4)
      this.lookPitch = THREE.MathUtils.clamp(this.lookPitch - dy * 0.003, -1.1, 1.1)
    }

    const aircraftQuat = new THREE.Quaternion().setFromEuler(
      new THREE.Euler(pitchRad, -headingRad, -rollRad, 'YXZ'),
    )
    const eyeOffset = new THREE.Vector3(EYE_Y, -EYE_Z, -EYE_X).applyQuaternion(aircraftQuat)
    this.camera.position.copy(aircraftPos).add(eyeOffset)

    const lookQuat = new THREE.Quaternion().setFromEuler(
      new THREE.Euler(this.lookPitch, this.lookYaw, 0, 'YXZ'),
    )
    this.camera.quaternion.copy(aircraftQuat).multiply(lookQuat)
  }
}
