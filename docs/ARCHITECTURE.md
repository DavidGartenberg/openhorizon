# Architecture and code map

Source inspected on 2026-11-24 at local `72c033a` plus the current uncommitted
aircraft/material work. Paths below are relative to the repository root. Check
[CURRENT-STATE.md](CURRENT-STATE.md) for exact verification evidence and limits.

## Boundaries and runtime

`index.html` loads `src/main.ts`, the large browser composition root. It owns the
active aircraft, systems ledgers, guidance panel, world managers, controllers,
speech, recorder, persistence, shell and debug hooks. Search named functions
rather than relying on line numbers, which drift frequently.

```text
DOM / keyboard / Gamepad / cockpit interactions
                 |
            src/main.ts <----- same-origin APIs and optional /xp/ assets
                 |
      input + resolved navigation
                 |
   fixed ticks: guidance -> controls -> Aircraft.step -> systems
                 |
       flight state / applied surfaces
                 |
  cockpit + rendering + warnings + recording + ATC/traffic
```

`src/sim/` and `src/math/` are importable headlessly and must not depend on Three.js,
DOM or browser state. `tests/sim-purity.test.ts` guards this boundary. `src/world/`
and `src/render/` can use Three.js and browser APIs. `src/main.ts` connects the
layers; `server/` is Node ESM JavaScript and serves data, not player physics.

Vite's `configureServer` middleware and the standalone Express host both dispatch
through `server/handlers.mjs::route`. The browser uses relative `/api/`, `/proxy/`
and `/xp/` URLs. There is no requirement to proxy from Vite to port 8787.

## Time, frames, units and ownership

- `FixedTimestepLoop` in `src/sim/loop.ts` runs physics at **120 Hz**, with rates
  0/1/2/4, a 0.25-second per-advance clamp and a rate-scaled substep budget.
  `main.ts::advanceFrame` splits larger elapsed intervals into chunks. Guidance
  steps at the fixed tick, while navigation is resolved once per advanceFrame.
- `src/render/frame-pacer.ts::FramePacer` drives rendering. The default uncapped
  mode uses MessageChannel/macrotasks with a 360 fps ceiling and parks while
  hidden. Display-synced mode uses `requestAnimationFrame`. The selected mode is
  stored in `oh-frame-mode`. `src/metronome-worker.ts` provides a physics fallback
  after 400 ms without a rendered frame, capped at one second per advance.
  Hiding the tab can therefore leave physics running.
- Physics uses SI internally: body **x forward / y right / z down**; local world
  **north / east / down (NED)**; `quat` rotates body to NED. HUD/nav interfaces
  often use knots, feet and degrees; use `FT`, `KT` and the atmosphere/geo helpers.
- Render space is **x east / y up / z south**; aircraft models face **-z** with
  right wing **+x**. Convert NED `(n,e,d)` to render `(e,-d,-n)` explicitly.
- `src/world/tiles.ts::WorldFrame` projects geodetic coordinates around a movable
  lat/lon anchor. `main.ts::rebaseIfNeeded` resets horizontal aircraft coordinates
  after 10 km and shifts/repositions terrain, airports, cameras and clouds. Preserve
  world position through rebases; inspect geo/dateline tests for boundary changes.
- `Aircraft` owns rigid-body state and applied surface angles. Renderer smoothing
  is visual only. `appliedControlSurfaces` records what physics actually consumed;
  command inputs alone can differ after AP, trim and actuator mixing.
- In the app, `fuelState.leftKg/rightKg` is the tank ledger; main mirrors its sum
  into `aircraft.fuelKg` after the tick. Loading must update both coherently.
  Do not create a second independent fuel decrement or let display-only values
  become authoritative physics state.

## Subsystem map

| Concern | Implementation entry points | Verification entry points |
|---|---|---|
| Rigid-body/aero/ground/propulsion | `src/sim/aircraft.ts`, `aero.ts`, `gear.ts`, `propulsion.ts`, `turbofan.ts`, `trim.ts`, `atmosphere.ts`, `wind.ts` | `tests/handling.test.ts`, `lateral-stability.test.ts`, `nan-ground.test.ts`, `tests/validate/` |
| Aircraft data and derivation | `src/sim/aircraft/{params,c172s,j3cub,b738,derive,roster,roster-core,roster-ext}.ts` | `tests/fleet-params.test.ts`, `fleet-lateral.test.ts`, `tests/validate/roster.test.ts` |
| Flaps, flaperons, spoilers, reversers | `src/sim/flaperons.ts`, `spoilers.ts`, `aircraft.ts`; `src/input/speedbrake-control.ts` | `tests/glider-airbrakes.test.ts`, `spoilers.test.ts`, `reversers.test.ts`, existing local `dg800-*.test.ts` |
| Systems and loading | `src/sim/systems/`, `captain-systems.ts`, `loading.ts`, `weight-balance.ts`, `checklists.ts`; `src/ui/loading-panel.ts` | `tests/systems/`, `captain-systems.test.ts`, `loading.test.ts`, `loading-main.test.ts`, `weight-balance.test.ts` |
| Guidance/panel/autoland | `src/sim/autopilot.ts`, `ap-panel.ts`, `autothrottle.ts`, `autoland.ts`; `src/ui/shell/ap-window.ts`; main's `advanceFrame`/`apPress` | `tests/autopilot-gs-descent.test.ts`, `ap-panel-flight.test.ts`, `autoland-flight.test.ts`, `autothrottle-fleet.test.ts`, `tests/helpers/autoland-harness.ts` |
| Navigation and airspace | `src/sim/nav/`, main's `computeTunedNav`/`computeGpsCdi`; `src/world/ils.ts`; `server/parse.mjs` | `tests/nav/`, `tests/papi.test.ts`, coupled-flight tests |
| Terrain and world streaming | `src/world/tiles.ts`, `terrain-worker.ts`, `terrain-coverage.ts`, `imagery-detail.ts`; `src/math/geo.ts` | `tests/terrain-visibility.test.ts`, `tile-uv.test.ts`, `imagery-detail.test.ts`, browser terrain inspection |
| Airports and scenery | `src/world/airports.ts`, `airport-detail.ts`, `airport-scenery.ts`, `osm-layout.ts`, `runway-marks.ts`, `papi.ts` | `tests/airport-scenery.test.ts`, `osm-airport-lifecycle.test.ts`, `runway-marks.test.ts`, airport studio |
| Installed airport layouts | `src/world/apt-layout.ts`, `airport-flatten.ts`; `server/apt.mjs`, `apt-parse.mjs` | `tests/apt-*.test.ts`, airport studio |
| Buildings and trees | `src/world/scenery.ts`, `buildings.ts`; `server/osm-buildings.mjs` | `tests/scenery-buildings.test.ts`, `__ohScenery()` and browser inspection |
| Weather/sky/clouds/water | `src/sim/weather/`; `src/world/nexrad.ts`; `src/render/{sky,atmosphere-shader,clouds,cloud-shadows,ocean,post-fx}.ts` | `tests/weather/`, `tests/render/clouds.test.ts`, `cloud-shadows.test.ts`, `post-fx.test.ts`, graphics lab |
| ATC and traffic | `src/sim/atc/`, `src/sim/traffic/`; `src/render/traffic-layer.ts`; main's `scanAtc`/`sendFreeTextAtc` | `tests/atc/`, `tests/traffic/`, `atc-speech-understanding.test.ts`, `traffic-labels.test.ts` |
| Safety and copilot | `src/sim/{tcas,taws,safety-approach,boeing-aurals,copilot}.ts`; main's `updateSafety`/`stepCopilot` | `tests/safety-*.test.ts`, `tcas*.test.ts`, `taws.test.ts`, `boeing-aurals.test.ts`, safety studio |
| Voice and sound | `src/audio/`, `src/voice/`, `server/voice.mjs` | `tests/voice-*.test.ts`, `browser-speech.test.ts`, `radio-voice.test.ts`, `spoken-aviation.test.ts`; actual playback/microphone checks |
| Player exterior and local models | `src/render/player-aircraft.ts`, `aircraft-mesh.ts`, `prop-aircraft.ts`, `airliner-mesh.ts`, `local-aircraft.ts`, `xplane-obj8.ts`, `xplane-manifest.ts` | `tests/render/`, `fleet-mesh-build.test.ts`, `prop-aircraft.test.ts`, aircraft studio |
| Cockpit/displays/cameras/UI | `src/cockpit/`; `src/render/cockpit*.ts`, camera modules; `src/ui/shell/`, `instrument-overlay.ts`, `flight-panel-dock.ts` | `tests/cockpit/`, `tests/render/cockpit*.test.ts`, `shell.test.ts`, `instrument-overlay.test.ts`, browser cockpit checks |
| Local flight decks and manipulators | `src/render/xplane-{cockpit,panel,datarefs,interact,ga-cockpits,ga-datarefs,airbus}.ts`; `src/cockpit/{boeing-displays,airbus-displays}.ts`; main's `xpAct`, `xpDatarefs`, `update737Deck` | `tests/xplane-*.test.ts`, `tests/render/xplane-airbus.test.ts`, `airbus-displays.test.ts`, Airbus browser page |
| Material detail and graphics controls | `src/render/{aircraft-materials,surface-materials,material-packs,material-finish}.ts`; `src/ui/graphics-panel.ts` | `tests/aircraft-materials.test.ts`, `tests/render/material-packs.test.ts`, GPU/browser checks |
| Input and hardware | `src/input/`, `src/sim/gamepad-map.ts`, `src/ui/controller-panel.ts`; main's `pollControls`/`updateControllers` | `tests/controller*.test.ts`, `gamepad-map.test.ts`, `tca-controller.test.ts`; physical device exercise |
| Recorder/replay/training | `src/sim/recorder.ts`, `replay.ts`, `training/graders.ts`; `src/render/replay-view.ts`; main's `updateRecorder` | `tests/recorder.test.ts`, `replay.test.ts`; landing/logbook/replay browser scenario |
| APIs and parsers | `server/handlers.mjs`, `parse.mjs`, `voice.mjs`, `xp-static.mjs`, `index.mjs`; `vite.config.ts` | `tests/nav/*parse.test.ts`, `aircraft-types-parse.test.ts`, `voice-service.test.ts`, `xp-route.test.ts` |

## Integration contracts that need special care

**Guidance and CDI signs.** LOC/VOR display needle fractions are positive with
the course to the right (aircraft left); the AP takes positive aircraft-right
offset. `advanceFrame` negates the tuned LOC/VOR fractions. GPS fractions already
use the AP convention, so the display negates GPS instead. Angular guidance also
needs the appropriate station/antenna range for gain normalization. During APR/BC
tracking the heading datum is pinned continuously to course. Keep the real
coupled-descent and panel-wiring tests when changing any of these paths.

**Guidance control priority.** Inputs and optional overrides feed the app; autoland
can command approach/configuration/flare/rollout; AP servos then own pitch/roll/yaw/
trim while engaged; autothrottle can own throttle when autoland does not. Captain
systems and brakes are mixed before physics. A debug override is not guaranteed
final authority over an engaged servo. Check main's actual ordering, takeover and
disconnect behavior rather than testing control-law functions in isolation.

**Player vs traffic geometry.** `buildPlayerAircraft` chooses dedicated baseline,
prop/glider or airliner builders. `fleet-mesh.ts` supplies cheaper traffic
archetypes. Boeing player variants except the exact installed 737-800 keep their
geometry and receive projected B738 artwork in `boeing-artwork.ts`. Projected
surfaces remove old procedural color, roughness and bump maps. The local Airbus
work retains non-A333 Airbus exteriors and fits the A330 cockpit. Other aircraft
may still use exact or uniformly scaled local exterior donors selected by
`xplane-proxy.ts::resolveLocalModel`. Failure keeps the procedural model.
Installed originals stream through `/xp/`, with animation and placement
calibration in `xplane-manifest.ts`. See [CURRENT-STATE](CURRENT-STATE.md) for
remaining rendering and fidelity checks.

**Local flight decks.** Main chooses the model, placement and state reader, then
`loadXpCockpit` owns its meshes, shared textures, live canvas and manipulator hit
boxes. `xpActionFor` maps authored controls to actions handled by `xpAct`.
Unsupported actions display their own control name. Boeing decks use `XpPanel`,
GA decks use their authored instruments/device screens, and the local Airbus
work uses `XpAirbusPanel` with measured A330 screen UVs. The A330 deck is fitted
to other Airbus noses by cabin width and eye-to-nose distance. Those fits share
the donor's layout and have explicit systems limits. See
[X-Plane integration](xplane-integration.md) for mappings and asset requirements.

**Material ownership.** The local material work shares seven generated 256²
RGBA detail tiles through `material-packs.ts`. `withSurfaceFinish` composes earlier
material shader hooks and keeps their maps. Quality and wear use shared uniforms.
Textures are application-shared resources, so individual aircraft disposal must
preserve them. Geometry tests and shader-string checks need rendered GPU checks
for visual and performance acceptance.

**Voice and safety.** `PushToTalk` owns capture/cancellation; recognition feeds the
same typed ATC classifier/controllers. Local Whisper is preferred when available;
Web Speech is the visible fallback. `SafetySpeechController` arbitrates warnings,
radio and copilot playback through `BrowserSpeechDriver`; safety can cancel PTT
to prevent echo commands. Read [voice-atc.md](voice-atc.md) for current behavior.

**Traffic truth.** Simulated AI participates in the tower state machine. Live
ADS-B is display/TCAS traffic, dead-reckoned using wall time; it does not become
an aircraft controlled by the simulated tower. Respect stale timestamps and feed
throttling when diagnosing missing or delayed traffic.

## Where to extend the app

Put numeric/state-machine behavior in the owning pure module and verify realistic
scenarios there. Wire it through main's existing state and reset paths; update
displays, snapshot/loading migration and controller paths when affected. Keep
rendering changes in the appropriate builder/shader/camera and verify the rendered
result separately. New API behavior belongs in the shared handler so Vite and the
standalone host remain consistent. Update this map when ownership changes.
