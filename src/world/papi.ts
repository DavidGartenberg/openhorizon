/**
 * PAPI core (Phase 13d) — pure. Standard 4-box PAPI for a 3° path:
 * per-unit setting angles 2.5/2.83/3.17/3.5° (FAA AIM 2-1-2); a unit
 * shows WHITE when the observer sits above its setting angle, RED
 * below. On slope → 2W2R; each transition is exact at the unit angle.
 * The render layer colors real light points from these functions using
 * the camera's elevation angle to the array.
 */

import * as THREE from 'three'
import { lightGlowTexture } from '../render/light-glow'

export const PAPI_ANGLES_DEG: readonly number[] = [2.5, 2.83, 3.17, 3.5]

/** Elevation angle (deg) from the array to an observer. */
export function papiAngleDeg(horizDistM: number, heightM: number): number {
  return (Math.atan2(heightM, horizDistM) * 180) / Math.PI
}

/** How many units show white (0–4) at a given approach angle. */
export function papiWhiteCount(angleDeg: number): number {
  let n = 0
  for (const a of PAPI_ANGLES_DEG) if (angleDeg > a) n++
  return n
}

/** One 4-box PAPI array. Colors are recomputed each frame from the CAMERA's elevation angle to the array
 *  (what the lens sees is what a pilot's eye would see). */
export interface PapiArray {
  colors: THREE.BufferAttribute
  /** Array center in airport-group-local coords. */
  baseX: number
  baseY: number
  baseZ: number
  /** Unit vector (x,z) pointing from the array out along the approach. */
  outX: number
  outZ: number
  /** Per-box setting angle, box order matching the vertex order. */
  boxAngles: number[]
  rwyIdent: string
  /** The light points, so an array can be retired when X-Plane's own are placed. */
  points?: THREE.Points
}

let papiMat: THREE.PointsMaterial | null = null
/** 13d PAPI boxes: constant-pixel additive glow points, on day and night (one shared material). */
export function papiMaterial(): THREE.PointsMaterial {
  if (!papiMat) {
    papiMat = new THREE.PointsMaterial({ map: lightGlowTexture(), size: 5, sizeAttenuation: false, vertexColors: true, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending })
    papiMat.userData.airportShared = true
  }
  return papiMat
}

/** The four boxes' setting angles for a glide slope `gsDeg`: innermost steepest, 0.33° apart around the slope (2.5 / 2.83 / 3.17 / 3.5° at 3°). */
export function papiBoxAngles(gsDeg: number): number[] {
  const g = Number.isFinite(gsDeg) && gsDeg > 1 && gsDeg < 6 ? gsDeg : 3
  return [g + 0.5, g + 0.17, g - 0.17, g - 0.5]
}
