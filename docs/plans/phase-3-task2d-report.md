# Phase 3, Task 2d — 3D cockpit + pilot's-eye camera

## Status

Done. This report covers both the original Task 2d build (by a prior agent
run that stalled just before writing it up) and a follow-up pass (this run)
that fixed a cluster of rendering bugs the stall left unaddressed, verified
everything visually in a browser, and confirmed `tsc`/tests stay green.

## Files created / modified

Created:
- `src/render/cockpit.ts` (453 lines) — 3D cockpit interior built from
  three.js primitives: panel bezel, PFD/MFD canvas-texture screens,
  placeholder standby-gauge cluster, a switch row (master battery/alt,
  avionics, pitot heat), ignition key + starter button, throttle/mixture
  vernier knobs, a 4-detent flap lever, an elevator trim wheel, a floor
  fuel selector, and a yoke (column + wheel) that mirrors
  `aircraft.controls.pitch`/`roll`. Also owns `CockpitInteraction`
  (raycast-based click/drag routing from the pointer to
  `SystemsControls`/`aircraft.controls`) and the pure, unit-tested mapping
  functions behind it (`cycleFuelSelector`, `cycleMagneto`,
  `dragToAxisValue`, `nearestFlapDetent`).
- `src/render/cockpit-camera.ts` (68 lines) — `CockpitCamera`, the 4th
  camera mode (chase → orbit → free → **cockpit** → chase). Sits at a
  body-frame eyepoint and tracks full aircraft attitude (heading/pitch/
  roll), unlike chase/orbit which only track heading or nothing. Left-drag
  looks around the cabin (clamped) when the pointer isn't grabbing a
  cockpit control.
- `tests/render/cockpit.test.ts` (12 tests) — covers the pure logic above
  (fuel-selector/magneto click-cycles, drag-to-axis-value math, flap
  detent snapping). The three.js/DOM-dependent parts (mesh construction,
  raycasting, camera math) aren't unit-tested, same status as the rest of
  `src/render/`.

Modified:
- `src/main.ts` (+211/-? — see `git diff 07c53bf`) — wires the systems sim
  (electrical/fuel/pitot-static/engine-start/engine-temps — Task 2a/2c) to
  the cockpit's gauges and controls, adds the `cockpit` camera mode and its
  near-plane swap (see "Near-plane / z-fighting" below), and calls
  `cockpitInteraction.update()` / `updateCockpitControls()` /
  `updateCockpitDisplays()` once per frame.
- `src/input/input.ts` (+53/-5) — adds raw pointer-pixel tracking
  (`pointerPixels()`, `targetSize()`) and press/release edge detection
  (`wasMousePressed`/`wasMouseReleased`/`isMouseDown`) needed for the
  cockpit's raycast click/drag, alongside the existing drag-delta API used
  by camera look-around.
- `src/render/aircraft-mesh.ts` — see "Bugs found and fixed" below; this
  file is the *exterior* model (Task 1/2c), not part of Task 2d's original
  scope, but two of its materials needed small, targeted fixes once the
  cockpit camera made them visible from angles that had never been
  rendered before.

No changes to `src/sim/aircraft/c172s.ts`, `src/cockpit/pfd.ts`, or
`src/cockpit/mfd.ts` (constraint honored — this task only changes where/how
those two modules' canvases are mounted in 3D space, not their drawing
logic).

## What the stalled run left undone

The prior run's last message flagged "fix the panel bezel box dimensions
and the trim wheel axis" as the next step, then stopped (infrastructure
issue, not a code problem) before making either change or writing this
report. A controller browser pass afterward found the concrete symptom:
switching to cockpit camera mode, the yoke wheel filled almost the entire
frame and hid the panel/PFD/MFD behind it.

Root cause as diagnosed going in: `cockpit-camera.ts`'s `EYE_X = 0.85`
(body-frame, fwd of the aircraft's tracked origin) put the eyepoint only
~0.14–0.17 m from the panel (bezel ~1.02, PFD/MFD screens ~0.99) and the
yoke was even closer (0.95/0.93) — at that range, even a realistically
sized yoke wheel (torus radius 0.11, ≈ a real ~9" yoke) subtends a huge
angular size in a 70°-FOV perspective camera and blocks everything behind
it.

## What this pass fixed

**1. Eye-to-panel depth.** `EYE_X` in `cockpit-camera.ts` changed from
`0.85` to `0.35`, putting ~0.67 m between the eye and the panel (bezel at
body-x 1.02) — in the realistic 0.6–0.7 m GA-cockpit range. Chose to move
the eye rather than the panel, since it's a single constant vs. having to
re-derive every switch/knob/gauge position relative to a moved panel.

**2. Yoke position.** Column/wheel moved from body-x 0.95/0.93 (almost
touching the eye) to 0.70/0.68 — roughly halfway between the eye (0.35)
and the panel (1.02), i.e. ~0.33–0.35 m from the eye. Also **lowered**
(z from -0.32/-0.42 to -0.16/-0.26, i.e. "up" from 0.32/0.42 to 0.16/0.26):
the original construction had the wheel dead level with the PFD (both at
up=0.42), so even at a corrected distance the wheel — being much closer to
the eye than the panel, hence larger in angle — fully covered the PFD
head-on. A real yoke rim sits below the panel; the pilot looks *over* it,
not through it. The new height was derived from the eye/PFD/yoke geometry
(not eyeballed) so the wheel's top edge clears the PFD's bottom edge, then
confirmed against a screenshot. Kept the wheel's own size (torus radius
0.11) unchanged — after the distance fix it read as a plausible, not
oversized, yoke.

**3. Trim wheel axis — verified correct, not touched.** Checked both the
construction (`trimWheel.rotation.z = Math.PI / 2`, reorienting the
cylinder's default spin-axis from local-Y to render-X = body-y, i.e.
lateral — so the disc faces fore/aft, toward the pilot, matching a real
side-console trim wheel) and, separately, found a **real bug in the
animation code**: `updateCockpitControls` was doing
`meshes.trimWheel.rotation.z = trim * Math.PI` every frame, which
*replaces* `rotation.z` outright rather than composing with it — silently
discarding the constructor's fixed orientation and snapping the wheel back
to its unrotated default (axis vertical, like a flat coin) every frame.
Fixed by composing two quaternions — a constant "face the pilot" base
rotation and a `trim`-driven spin about the cylinder's own original
(pre-reorientation) axis — instead of overwriting the Euler component. The
axis convention itself (lateral, disc-face-toward-pilot) was correct and
left alone, per the task's "don't fix what isn't broken" instruction.

**4. Two more bugs found only by actually looking at a screenshot** (not
guessable from reading the code, and both pre-existing — present in the
original Task 2d cockpit regardless of the depth/yoke fix above; they just
happened to be hidden by the yoke filling the whole frame until fix #1/#2
made the panel visible):

- **PFD/MFD screens were exactly coplanar with the panel bezel's front
  face**, both at body-x 0.99 (bezel is a 0.06-deep box centered at 1.02,
  so its near face sits at 1.02-0.03 = 0.99). Combined with this scene's
  enormous near/far ratio (`camera.near` swaps to 0.02 in cockpit mode,
  `far` stays 2,000,000 — tuned for exterior sky/terrain, terrible depth
  precision up close), this z-fights, and the opaque, dimly-lit bezel
  consistently won, silently hiding the entire PFD/MFD behind a flat dark
  rectangle. Fixed by moving both screens 2 cm forward (body-x 0.99 → 0.97)
  — proud of the bezel face, as a real G1000 sits.
- **The exterior "windshield hint" box** (`aircraft-mesh.ts`, `GLASS`
  material) was fully opaque, metallic (`metalness: 0.4`, no environment
  map — reads as flat black with no reflection source), and 0.6 m deep
  (body-x 0.75–1.35), which physically overlapped the panel/PFD/MFD's
  depth range. From outside (chase/orbit/free), none of this ever mattered
  — it only ever appeared as a small, oblique, mostly-shadowed sliver.
  Task 2d's cockpit camera is the first view to look at this face head-on,
  filling much of the frame with an unlit, black, non-see-through "glass."
  Fixed by (a) dropping `metalness` to 0 and (b) making the material
  actually semi-transparent (`transparent: true, opacity: 0.25`) — real
  glass is transmissive, and this lets the exterior sky/ground actually
  show through, which a fully opaque box never could regardless of
  lighting; and (c) shrinking its depth to 0.12 m and shifting it forward
  so it no longer overlaps the panel/PFD/MFD's depth range at all.

Net effect, verified by screenshot: cockpit-mode view now shows a readable
PFD (airspeed/attitude/altitude) and MFD (EIS: lean-assist graph, engine
strip) below a translucent windshield, with the yoke wheel sitting low and
clear of both screens instead of blotting out the whole frame.

## Browser verification

Used the `openhorizon-dev-2d` dev server preview and a scripted sequence
(`window.dispatchEvent(new KeyboardEvent('keydown', {code:'KeyC'}))` →
`window.__ohStep(1/60)` → keyup, repeated 3×, cross-checked against a
temporary debug hook exposing `cameraMode` — removed before finishing) to
reliably land in `cockpit` mode before screenshotting; a naive "dispatch 3
keydowns then step once" collapses to a single transition, and even
dispatch-step-dispatch-step sequences can occasionally race against the
app's own background `requestAnimationFrame` loop (which keeps running
during scripted `__ohStep` calls, since nothing pauses it) — confirming
`cameraMode` after each press, not just after the batch, was necessary to
get a trustworthy screenshot.

- **Before (this pass's starting point):** yoke wheel filling almost the
  whole frame, panel/PFD/MFD entirely hidden behind it.
- **After fixing distance + yoke position only:** yoke no longer touching
  the eye, but the whole panel area above/around it rendered as a solid
  black rectangle (no PFD/MFD content, no sky) — traced through raycasting
  (real `THREE.Raycaster`, not hand-rolled geometry math, which had its own
  bugs along the way) and direct canvas-source vs. rendered-framebuffer
  pixel sampling to the two bugs in item 4 above, both fixed.
- **After all fixes:** PFD shows a blue/brown attitude indicator and
  compass rose; MFD shows "LEAN ASSIST", a CHT graph, and engine-strip
  data; standby gauge placeholders visible left of the PFD; switch row and
  ignition/starter visible below; yoke wheel low in frame, not overlapping
  either screen. Windshield above the panel is a dim, translucent
  dark-teal rather than a solid black void.
- **Chase view** (exterior, unaffected by any of the above since it never
  looks inside the cockpit): re-checked after all fixes, unchanged from
  before this pass — normal exterior aircraft-on-runway view.

## Verification commands

- `npx tsc --noEmit` — clean.
- `npm test` — 139/139 passing (15 test files), unchanged count from
  before this pass; all fixes here were rendering/layout constants and one
  animation-composition fix, no test-visible behavior changed.

## Flagged assumptions / deviations

- **No glTF/authored 3D assets.** Per this environment's constraints (same
  as `aircraft-mesh.ts`'s exterior model), the entire cockpit interior is
  three.js primitives — boxes, cylinders, a torus, planes — not an
  authored/photo-matched panel. The phase-3 plan's original "proper glTF
  exterior/interior" aspiration is not achievable here; this is flagged
  in `cockpit.ts`'s header comment, not a silent downgrade.
- **`engineStartState` seeded to `'running'`, not the state machine's
  natural `'stopped'` (cold-and-dark) default.** This was the prior run's
  choice, already documented in `main.ts`'s inline comment (search
  `engineStartState` around line 60): done specifically so existing
  verified spawn/takeoff behavior — which assumes a running engine at
  spawn, e.g. the ground-yaw flight-assist fix — stays unaffected by
  Task 2d landing. Cold-and-dark is fully reachable in-sim via the cockpit
  switches (or `__ohFail`), it's just not the boot default. This pass did
  not change that choice, only confirmed and is now explicitly flagging it
  per the task brief's request.
- **Panel/control positions are layout choices with no in-repo source**
  (same status as `aircraft-mesh.ts`'s primitive dimensions) — not POH
  data, flagged inline in `cockpit.ts`'s header.
- **Windshield opacity (0.25) and depth (0.12 m) are tuned by eye**, not
  from a reference photo — chosen to (a) stop reading as a solid black
  void and (b) stop z-fighting/overlapping the panel; further polish
  (e.g. matching a specific window trim look) was out of this pass's
  scope (constrained to depth/scale/trim-wheel plus the bugs that blocked
  verifying that fix).
- The cockpit's near/far camera-plane mismatch (0.02 / 2,000,000) that
  caused the PFD/bezel z-fight is inherent to sharing one camera between
  wildly different-scale views (exterior terrain/sky vs. centimeters-close
  cockpit controls) and wasn't restructured — the coplanar-geometry fix
  (moving the screens 2 cm proud of the bezel) sidesteps it for this
  specific pair without touching the shared near/far setup, which would be
  a larger, riskier change outside this task's scope.

## Review fix-pass (three Important findings)

Fixes for three "Important" findings from the task review of `dd67513`. All
three fixes live in `src/main.ts` (plus one small, pure helper extracted to
`src/math/geo.ts`); no flight-dynamics/tuning files touched.

### Finding 1 — wind direction hardcoded to 0 on the PFD

`main.ts`'s `updateCockpitDisplays` call passed `windDirDeg: 0` literally,
while `windSpeedKt` right next to it was correctly computed from
`aircraft.windNed`. Root cause: nobody had derived the "from" direction from
the NED wind vector.

Fix: added a pure helper, `windDirFromNed(windNed: { x, y })`, to
`src/math/geo.ts` (next to `bearingDeg`, same file/convention family) and
wired it into `main.ts`: `windDirDeg: windDirFromNed(aircraft.windNed)`.

Direction convention check: `WindModel.setSteady(directionFromDeg, speedKt)`
(`src/sim/wind.ts`) rotates the "from" input 180° before building the NED
vector (`toRad = (directionFromDeg + 180) * …`), i.e. the vector it produces
points in the direction the wind is blowing *toward*. `windDirFromNed` inverts
that: `atan2(y, x)` (matching the `headingDeg` computation pattern already
used in `src/sim/aircraft.ts`'s `(euler.yaw * 180 / Math.PI + 360) % 360`)
gives the "toward" bearing of the vector, and adding 180° converts it back to
the "from" convention a wind box/METAR reports. Verified: a north wind
(`windNed` pointing south, i.e. `{x: -1, y: 0}`) now reads 000°/360°, not
180°.

Added `tests/geo.test.ts` cases for `windDirFromNed` (cardinal directions,
plus a round-trip through `WindModel.setSteady` at dt=0 to keep it
deterministic).

### Finding 2 — respawn didn't reset the new systems state

`fuelState`, `electricalState`, `engineStartState` (plus `systemsControls`
and `failures`) are module-scope objects in `main.ts` that `spawnAtAirport`
never touched, so draining a tank, killing the battery, or stopping the
engine via the cockpit switches left that state dead/stale across a respawn
(KeyR or a search-spawn), even though `Aircraft`'s own fields (`fuelKg`,
position, controls) reset fine.

Fix: added `resetSystemsState()` in `main.ts`, called at the very top of
`spawnAtAirport` (covers both the KeyR handler and `handleSearch`, since both
paths funnel through `spawnAtAirport`). It:
- `Object.assign(fuelState, makeFuelState())` — full tanks, selector logic
  state cleared (`_lastSelector: null`, `fuelFlowing: false` until the first
  post-spawn tick sets it true again, matching boot behavior).
- `Object.assign(electricalState, makeElectricalState())` — full battery;
  `stepElectrical` normalizes `busVoltage`/`mainBusPowered` on the next tick,
  exactly as it does at boot (boot also just calls `makeElectricalState()`
  and lets the first tick settle it — no second "normal" state invented).
- `Object.assign(engineStartState, ENGINE_START_BOOT_RUNNING)` — a new
  shared constant (`{ status: 'running', rpm: 700, crankTimeS: 0 }`, hoisted
  out of the previous inline object literal) so boot seeding and respawn
  reset are provably the same values, not two hand-maintained copies.
- `Object.assign(systemsControls, SYSTEMS_CONTROLS_DEFAULT)` — a new shared
  constant for the same reason (battery/alternator/avionics on, pitot heat
  off, magneto BOTH, fuel selector BOTH, boost pump off, starter
  disengaged).
- `failures.alternatorFailed/icingConditions/staticBlocked` all cleared —
  restarting the sim should mean a genuinely fresh airplane, matching the
  spirit of `spawnAtAirport`'s existing `aircraft.crashed = false`.
- Also resets `engineTemps` via `makeEngineTemps()` for the same
  fresh-airplane reasoning (not explicitly called out in the finding, but a
  stale hot CHT/oil temp surviving a respawn is the same class of bug).

Browser-verified: `__ohFail('alternator', true)` then stepping showed
`batteryAmps` going negative (discharging, no alternator contribution) via
`__ohSystems()`; dispatching a `KeyR` keydown/keyup and stepping again showed
`failures.alternatorFailed: false`, `electricalState.batteryAh` back to
`25.5` (full)/`busVoltage: 28` (alternator-up), and `fuelState.leftKg`/
`rightKg` back to `72.12` (full tank) each — and the PFD screenshot post-
respawn showed no annunciations and `FUEL L/R GAL 26.5`, `VOLTS 28.0`.

### Finding 3 — two unreconciled fuel-mass ledgers

`aircraft.fuelKg` (single pool, decremented inside `Aircraft.step()` at
`src/sim/aircraft.ts:180` by `prop.fuelFlowKgS * dt`, and driving `massKg`/
propulsion gating) and `fuelState.leftKg`/`rightKg` (decremented independently
by `stepFuel` in `main.ts`'s loop, using the *same* `prop.fuelFlowKgS * dt`
demand, but with per-tank/selector/starvation logic `Aircraft` knows nothing
about) had no reconciliation — two sources of truth for "fuel remaining"
that could diverge the moment a tank ran dry or the selector wasn't BOTH.

Fix (minimal footprint, no `Aircraft` internals touched, as constrained):
in the fixed-timestep loop in `main.ts`, immediately after `stepFuel(fuelState,
dt, …)` returns, added:

```ts
aircraft.fuelKg = fuelState.leftKg + fuelState.rightKg
```

with a comment explaining that `fuelState` is authoritative (it's the only
ledger that models per-tank starvation) and `aircraft.fuelKg` is now a
derived mirror that `Aircraft.step()` still consumes unchanged for mass/
propulsion gating.

Double-decrement check (traced the actual per-tick call order): each fixed
tick runs `aircraft.step(dt)` (decrements `aircraft.fuelKg` by
`prop.fuelFlowKgS * dt`, computed from the *previous* tick's already-synced
`aircraft.fuelKg`) → `stepFuel(fuelState, dt, …)` (decrements
`fuelState.leftKg/rightKg` by the same demand, gated by selector/tank-empty
logic) → the new sync line overwrites `aircraft.fuelKg` from the fresh
`fuelState` sum. The overwrite *replaces* `aircraft.step()`'s decrement for
that tick rather than stacking a second subtraction on top of it, so there's
no double-count — `aircraft.fuelKg` after the tick equals exactly what
`fuelState` says is left, and next tick's `aircraft.step()` decrements from
that correct baseline. This also incidentally fixes a related pre-existing
gap: `spawnOnGround`/`applyTrimState` in `aircraft.ts` never reset
`aircraft.fuelKg` on respawn either — now that it's a mirror of `fuelState`
(which Finding 2's `resetSystemsState()` does reset), it comes back full on
respawn too, for free.

### Verification

- `npx tsc --noEmit` — clean, no errors.
- `npm test` — 141/141 passing (139 pre-existing + 2 new `windDirFromNed`
  cases in `tests/geo.test.ts`). `tests/sim-purity.test.ts` stayed green
  (the only `src/math` change, `windDirFromNed`, is a pure function with no
  three.js/DOM dependency).
- Browser-verified via the Browser pane against the running dev server
  (`http://localhost:5173`):
  - `__ohWind(230, 15)` then stepping the sim and switching to cockpit
    camera showed the PFD wind box reading exactly `WIND 230°/15`, matching
    the debug hook's input value (not just "non-zero").
  - `__ohFail('alternator', true)` → `__ohSystems()` showed the electrical
    model discharging the battery (`batteryAmps < 0`, `alternatorAmps: 0`) —
    confirms the failure is live.
  - Dispatched a synthetic `KeyR` keydown/keyup (respawn) → `__ohSystems()`
    showed `failures.alternatorFailed: false`, electrical back to full/
    alternator-up, and fuel tanks back to full capacity; the PFD screenshot
    post-respawn showed no annunciations, `FUEL L/R GAL 26.5`, `VOLTS 28.0`.
  - Note: the Browser pane's synthetic `KeyboardEvent`s dispatched via the
    `computer` tool's native key-press path were flaky in this headless
    environment (camera-mode cycling didn't always advance); switching to
    `window.dispatchEvent(new KeyboardEvent(...))` via the JS eval tool was
    reliable and is what the verification above used. This is an artifact of
    the test environment, not a product bug — worth knowing if a future pass
    tries to browser-verify keyboard-driven behavior here.

### Files changed

- `src/main.ts` — wind direction wiring (Finding 1), `resetSystemsState()` +
  its call site in `spawnAtAirport` plus the two new shared default
  constants (Finding 2), fuel-ledger sync line + comment (Finding 3).
- `src/math/geo.ts` — added `windDirFromNed` pure helper.
- `tests/geo.test.ts` — added `windDirFromNed` unit tests.
