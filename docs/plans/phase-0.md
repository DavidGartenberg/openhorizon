# Phase 0 plan — Skeleton

Goal (§24): Vite+TS+Three+Vitest+server scaffold, fixed-timestep loop, camera
rig, input layer, flat ocean world, sky sun cycle, FPS/debug HUD.
Acceptance: 60 fps empty world; loop timing test passes.

## Files

- `src/sim/loop.ts` — fixed 120 Hz accumulator loop, sim-rate control
  (pause/1x/2x/4x), spiral-of-death guard, interpolation alpha. Pure (no three).
- `src/math/solar.ts` — NOAA solar position (elevation/azimuth from date/lat/lon).
  Pure. Drives the sun.
- `src/render/scene.ts` — renderer (WebGL2, ACES tone mapping), camera, resize.
- `src/render/sky.ts` — three Sky dome + directional sun + hemisphere light,
  positioned from solar.ts. (Custom scattering shader is Phase 5 per §7.)
- `src/render/ocean.ts` — large ocean plane, analytic wave-normal shader,
  fresnel + sun specular.
- `src/render/camera.ts` — fly camera (mouse-drag look, WASD/RF move).
- `src/input/input.ts` — keyboard/mouse/gamepad state layer.
- `src/ui/hud.ts` — FPS/frame-time/sim-time/rate HUD; exposes window.__oh for
  automated verification.
- `src/main.ts` — wiring; keys: Space pause, 1/2/3 sim rate, [ ] scrub
  time-of-day to verify the sun cycle.
- `server/index.mjs` — Express proxy skeleton (/health; /proxy 501 INOP until
  Phase 2).
- `tests/loop.test.ts` — tick counts vs elapsed time, rate scaling, pause,
  clamp behavior, alpha bounds.
- `tests/solar.test.ts` — sanity: noon summer sun high & south at KSFO lat,
  night sun below horizon.
- `tests/sim-purity.test.ts` — asserts no three.js imports under src/sim.

## Data flow

rAF → elapsed → loop.advance(step) n×120Hz ticks → sim clock → solar position
(date+scrub) → sky/sun/light uniforms → render. Input is read by camera rig
each frame; HUD reads counters.

## Risks

- Node was not installed on this machine → installed v24 LTS user-locally.
- three Sky addon types under `three/addons/*` — if @types/three lags, add a
  local .d.ts shim.
- Float accumulation in loop tests → assert with ±1 tick tolerance.
