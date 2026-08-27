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
/** Per-layout pilot eyepoints (Slice 3). The one-size eye (up 0.52) sat
 *  BELOW both panel tops, so the windscreen band started +31° above the
 *  horizon — zero forward view. The GA eye must stay under the C172's
 *  exterior cabin top (0.80) while clearing its shortened panel (top
 *  0.72 → ~3° of over-the-nose vision); the transport eye rides above
 *  the re-seated 737 glareshield (top 0.92 → ~7° over the nose, the
 *  real design-eye idea). `up` is render-up metres (body −z). */
export const EYE_BY_LAYOUT = {
  ga: { x: 0.45, y: -0.33, up: 0.75 },
  transport: { x: 0.45, y: -0.5, up: 1.0 },
} as const

export class CockpitCamera {
  private lookYaw = 0
  private lookPitch = 0
  private eye: { x: number; y: number; up: number } = EYE_BY_LAYOUT.ga

  constructor(private readonly camera: THREE.PerspectiveCamera) {}

  /** Select the eyepoint for the active aircraft's panel layout. */
  setEye(kind: keyof typeof EYE_BY_LAYOUT): void {
    this.eye = EYE_BY_LAYOUT[kind]
  }

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
      // Down-look widened to −1.25 rad: the floor controls (trim wheel,
      // fuel selector) sit ~80°+ below the raised eyepoint.
      this.lookPitch = THREE.MathUtils.clamp(this.lookPitch - dy * 0.003, -1.25, 1.1)
    }

    const aircraftQuat = new THREE.Quaternion().setFromEuler(
      new THREE.Euler(pitchRad, -headingRad, -rollRad, 'YXZ'),
    )
    const eyeOffset = new THREE.Vector3(this.eye.y, this.eye.up, -this.eye.x).applyQuaternion(aircraftQuat)
    this.camera.position.copy(aircraftPos).add(eyeOffset)

    const lookQuat = new THREE.Quaternion().setFromEuler(
      new THREE.Euler(this.lookPitch, this.lookYaw, 0, 'YXZ'),
    )
    this.camera.quaternion.copy(aircraftQuat).multiply(lookQuat)
  }
}
