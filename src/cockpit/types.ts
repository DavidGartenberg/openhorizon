/**
 * Shared cockpit-display types (Phase 3 §8): data shapes consumed by the
 * canvas-2D G1000-style draw functions (`pfd.ts`, and a later `mfd.ts`).
 * These are display-layer types, not simulation truth — they're small
 * flattened views the systems/aircraft layers get mapped onto by whatever
 * wires the cockpit up in a later task. No three.js/DOM imports here,
 * these are plain data shapes (though unlike `src/sim/`, this directory
 * is not subject to the sim-purity import ban since the draw functions
 * themselves take a CanvasRenderingContext2D).
 */

/** One nav/com radio's active+standby frequency pair (flip-flop display). */
export interface RadioStack {
  activeMhz: number
  standbyMhz: number
}

/** A softkey bezel click-target rectangle, in canvas pixel space. */
export interface SoftkeyRegion {
  label: string
  x: number
  y: number
  w: number
  h: number
}
