# Phase 16 plan — polish batch (user-directed)

Order per the user: joystick/throttle-quadrant support first, then the
quick-win polish items. Same standing rules: TDD for pure modules,
suite + validate green forever, one commit per slice, honest
deviations recorded.

## Slices

- **16a. Joystick + throttle quadrant.** Pure `sim/gamepad-map.ts`
  (TDD): deadzone-with-rescale, expo, bipolar/unipolar conversion,
  moved-axis detection (multi-device, sign from movement direction),
  map serialization. Driver polls `navigator.getGamepads()` each
  frame; bound axes OWN their control absolutely (stick: pitch/roll/
  yaw with deadzone+expo; quadrant: throttle/mixture as absolute
  lever positions; brakes axis optional). Defaults: single-stick
  layout (roll/pitch/twist/slider) applies automatically when one pad
  and no stored map. Binding UX by search verbs: `JOY` guided capture
  (move each axis to its POSITIVE extreme — that direction becomes
  +1, so inverted hardware Just Works), `JOY <FN>` single rebind,
  `JOY CLEAR`. PROP lever refused honestly (no controllable-pitch
  model — governed types auto-govern; recorded). `__ohJoy` hook.
  Verification: synthetic `getGamepads` injection end-to-end in the
  browser; physical-hardware confirmation is the user's (recorded).
- **16b. Imagery z14 composite.** Near-ring textures stitched from
  four z14 tiles (512 px, ~7.6 m/px) with the existing validation/
  fallback ladder; request volume ×4 on the z13 ring only.
- **16c. Night finish.** MALSR/ALSF-style approach light bars at ILS
  runways (heuristic, recorded), taxiway blue edges on the 13a′
  complex, painted markings dimmed after dark.
- **16d. Replay viewer.** Debrief draws the recorder's 10 Hz track:
  plan-view approach path + vertical profile with touchdown marker.
