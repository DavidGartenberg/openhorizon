import * as THREE from 'three'
import type { Input } from '../input/input'

/**
 * Cameras bolted to the airplane: the passenger's window seat over the wing, and the fin-top camera airlines fit.
 *
 * Each is an eyepoint in the body frame and a base look direction; the pilot can look around a little from it. The wing
 * seat sits over the wing root a little ahead of the trailing edge, looking out and aft and down, so the flaps hanging
 * under the trailing edge and the spoiler panels along the wing's top are all in view.
 */
export type MountKind = 'wingL' | 'wingR' | 'tail'

export const MOUNT_KINDS: readonly MountKind[] = ['wingL', 'wingR', 'tail']
export const MOUNT_LABELS: Readonly<Record<MountKind, string>> = { wingL: 'Wing (left window)', wingR: 'Wing (right window)', tail: 'Tail camera' }

/** What the mounts need to know of the airplane (metres). `jet` = an airliner-style cabin; otherwise a light airplane's. */
export interface MountDims { lengthM: number; fuselageRadiusM: number; jet: boolean }

export interface Mount {
  /** Eye: metres forward of the airplane's origin (its CG), right of it, and above it. */
  eye: { x: number; y: number; up: number }
  /** Base look direction in the body frame, degrees: yaw + = left (0 = straight ahead), pitch + = up. */
  yawDeg: number
  pitchDeg: number
  /** How far the pilot may look from it, degrees either way. */
  yawRangeDeg: number
  pitchRangeDeg: number
}

/** Wing root trailing edge sits this far aft of the CG, as a share of fuselage length (the 737-800 and A330-300 both measure 0.062). */
export const WING_ROOT_TE_AFT = 0.062
/** The seat is this far forward of the CG (the middle of the root chord of both measured models: 0.014 and 0.027 of the length). */
export const WING_SEAT_FORWARD = 0.02

export function mountFor(kind: MountKind, dims: MountDims): Mount {
  const L = dims.lengthM, R = dims.fuselageRadiusM
  if (kind === 'tail') {
    // On top of the fin, looking forward along the fuselage and a little down.
    return jetOrProp(dims, { eye: { x: -0.4 * L, y: 0, up: 0.21 * L }, yawDeg: 0, pitchDeg: -8, yawRangeDeg: 70, pitchRangeDeg: 35 }, { eye: { x: -0.3 * L, y: 0, up: 0.17 * L }, yawDeg: 0, pitchDeg: -6, yawRangeDeg: 70, pitchRangeDeg: 35 })
  }
  const side = kind === 'wingL' ? -1 : 1
  // A window seat: against the skin, at about a third of the radius above the centreline.
  const seat = dims.jet
    ? { x: WING_SEAT_FORWARD * L, y: side * (R - 0.14), up: 0.36 * R }
    : { x: 0.05 * L, y: side * Math.max(R - 0.08, 0.35), up: 0.35 * Math.max(R, 0.55) }
  return {
    eye: seat,
    // Out to the side and 14° aft of the beam, a little down at the wing (the root, the spoiler row, the flaps behind the
    // trailing edge and the tip all in the window); a light airplane's wing is above the window, not below it.
    yawDeg: (kind === 'wingL' ? 1 : -1) * (dims.jet ? 104 : 100),
    pitchDeg: dims.jet ? -12 : 6,
    yawRangeDeg: 45, pitchRangeDeg: 30,
  }
}

const jetOrProp = (dims: MountDims, jet: Mount, prop: Mount): Mount => (dims.jet ? jet : prop)

const _quat = new THREE.Quaternion(), _look = new THREE.Quaternion(), _euler = new THREE.Euler(0, 0, 0, 'YXZ'), _offset = new THREE.Vector3()

export class MountedCamera {
  private lookYaw = 0
  private lookPitch = 0
  private mount: Mount = mountFor('wingL', { lengthM: 39.5, fuselageRadiusM: 1.9, jet: true })

  constructor(private readonly camera: THREE.PerspectiveCamera) {}

  /** Choose the mount (and clear any looking around from the last one). */
  set(kind: MountKind, dims: MountDims): void {
    this.mount = mountFor(kind, dims)
    this.lookYaw = this.lookPitch = 0
  }

  get current(): Mount { return this.mount }

  /** Verification: look this many degrees from the base direction (clamped to the mount's range). */
  setLook(yawDeg: number, pitchDeg: number): void {
    this.lookYaw = THREE.MathUtils.clamp(THREE.MathUtils.degToRad(yawDeg), -THREE.MathUtils.degToRad(this.mount.yawRangeDeg), THREE.MathUtils.degToRad(this.mount.yawRangeDeg))
    this.lookPitch = THREE.MathUtils.clamp(THREE.MathUtils.degToRad(pitchDeg), -THREE.MathUtils.degToRad(this.mount.pitchRangeDeg), THREE.MathUtils.degToRad(this.mount.pitchRangeDeg))
  }

  /** No world-relative state: it is always placed from the (rebased) airplane. */
  shiftWorld(): void {}

  /**
   * Place the camera. Attitude is the airplane's, as `main.ts` rotates `mesh.group` (order 'YXZ': yaw −heading, pitch,
   * roll −roll). `consumeLook` feeds mouse drags into looking around within the mount's range.
   */
  update(aircraftPos: THREE.Vector3, headingRad: number, pitchRad: number, rollRad: number, input: Input, consumeLook: boolean): void {
    const m = this.mount
    if (consumeLook) {
      const { dx, dy } = input.consumeMouseDelta()
      const yr = THREE.MathUtils.degToRad(m.yawRangeDeg), pr = THREE.MathUtils.degToRad(m.pitchRangeDeg)
      this.lookYaw = THREE.MathUtils.clamp(this.lookYaw - dx * 0.003, -yr, yr)
      this.lookPitch = THREE.MathUtils.clamp(this.lookPitch - dy * 0.003, -pr, pr)
    }
    _quat.setFromEuler(_euler.set(pitchRad, -headingRad, -rollRad, 'YXZ'))
    _offset.set(m.eye.y, m.eye.up, -m.eye.x).applyQuaternion(_quat)
    this.camera.position.copy(aircraftPos).add(_offset)
    _look.setFromEuler(_euler.set(THREE.MathUtils.degToRad(m.pitchDeg) + this.lookPitch, THREE.MathUtils.degToRad(m.yawDeg) + this.lookYaw, 0, 'YXZ'))
    this.camera.quaternion.copy(_quat).multiply(_look)
  }
}
