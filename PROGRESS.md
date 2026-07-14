# OpenHorizon — PROGRESS

Contract: `../FLIGHT-SIM-MASTER-PROMPT.md`. One phase per session (§24).

## Commands

- `npm run dev` — Vite client (:5173) + Express server (:8787)
- `npm test` — full Vitest suite
- `npm run validate` — POH validation harness (populated in Phase 1)
- `npm run build` — type-check + production build

Node v24.18.0 (installed user-locally at `~/.local/node` — machine had no
Node; add `~/.local/node/bin` to PATH).

## Phase status

| Phase | Status | Notes |
|---|---|---|
| 0 — Skeleton | ✅ done | 61 fps measured, 14/14 tests green |
| 1 — Flight model | ✅ done | POH table 10/10, handling 5/5, browser takeoff verified |
| 2 — The US | ✅ done | real terrain/airports verified, KSFO landing flown, rebase seamless |
| 3–10 | not started | Phase 3 (cockpit & systems) next |

## Phase 2 — evidence (2026-07-14)

- Suite 40/40, validate 10/10, tsc clean. New regression tests:
  `tests/nan-ground.test.ts` (NaN terrain must never reach the integrator),
  `tests/geo.test.ts` (tile/ENU/terrarium/flattening/CSV parsing).
- **KHAF spawn**: real runway 30, hdg 307°, alt 42 ft, AGL 4 ft on gear,
  182 tiles; night scene shows real coast-range silhouette + runway edge
  lights (screenshots in transcript).
- **KTRK spawn**: alt 5,901 ft (real field 5,904), Sierra terrain visible.
- **KSFO 28R final spawn → landing**: trimmed −3° path from 915 AGL at
  69 KIAS; scripted approach touched down at −345 fpm and stopped ON 28R
  at 37.6151/−122.3615, field elev 16 ft (real 13). The two "crashes" en
  route were honest: a scripted stall-flare (−2505 fpm) and a frozen-controls
  CFIT into Montara during a tool-call gap — crash guard fired correctly
  both times.
- **Floating-origin rebase**: 13 km flight from the anchor crossed the
  10 km rebase in the air; max per-step position jump 6.0 m over 3,600
  steps (= one frame at 85 kt) — zero discontinuities.
- **fps**: 60 fps on the HUD with the tab fronted at KHAF (182 tiles);
  automation-throttled readings (1–3 fps) are not meaningful. Full §19
  perf gate re-check due at Phase 9 with heavy traffic.
- **Root cause of the "intermittent worker NaN" (Sonnet handoff)**: it was
  deterministic — `terrain-worker.ts` read `bitmap.width` *after*
  `bitmap.close()` (which zeroes it) → negative pixel indices → every tile
  decoded to all-NaN heights. Runway flattening masked it at airports;
  open water exposed it. Terrain had never actually rendered before this
  fix. Second kill path found: NaN ground elevation reached the *aero*
  model via AGL/ground effect (`Math.max(NaN, 0.1)` is NaN) — gear-side
  guard alone couldn't stop it. Fixes: width captured before close; worker
  rejects non-finite decodes; `elevationAt` falls through rings on bad
  samples; `Aircraft.safeGroundElev` finite-guards the choke point.

## Phase 2 deviations & known issues

- Airport buildings/aprons/terminals + PAPI deferred (Phase 8/9 polish);
  runways have strips, markings, edge lights, windsock.
- NLCD land-cover texturing → Phase 5 (elevation/slope color ramp for now).
- Ring LOD with skirts instead of full quadtree geomorphing; curvature via
  d²/2R vertex-shader drop (ellipsoid approximation).
- Water is visually ocean but physically solid ground at 0 elevation.
- Occasional terrain artifact (conical spike seen near KTRK horizon) —
  investigate with Phase 5 texturing work.
- Verification hooks added to main.ts: `__ohCtl` (persistent control
  overrides applied after keyboard polling), `__ohHold` (wings-leveler).
  Scripted flights must run in ONE javascript_exec call — the rAF-watchdog
  keeps flying frozen controls between calls (caused one CFIT).

## Phase 1 — evidence (2026-07-13)

- **`npm run validate`: all 10 POH rows pass** — stall clean 48±2 KIAS (1-g
  level deceleration through the pitot calibration), stall flaps-30 40±2,
  Vy climb 730±60 fpm, 75% cruise at 8000 ft 124±4 KTAS, max level ~126±4
  KIAS, glide 9:1±0.8 (windmilling-prop drag modeled), takeoff roll 960 ft
  ±15%, landing roll 575 ft ±15%, service ceiling crossing 100 fpm between
  12.5–15.5 kft, static RPM 2300–2400.
- **Handling 5/5**: power-on P-factor/torque left yaw, forward-slip sink,
  full-flap go-around pitch-up, uncorrected-crosswind drift, brake hold at
  run-up power (slight creep at full power — real 172 behavior).
- Full suite 29/29; `tsc --noEmit` clean; /sim purity guard green.
- **Browser**: full-stack takeoff flown via dispatched *keyboard events*
  (the real input path): rotation at 55.9 KIAS, liftoff at 60.8 KIAS/9.3°
  AoA, stabilized climb +648 fpm at 95 KIAS to 600 ft; screenshots in
  transcript (on-runway and mid-climb). Hands-off at full power enters a
  left torque spiral — correct, and matches the headless scenario test.
- Notable bugs found by the harness: sigmoid stall blend capped effective
  CLmax at ~1.31 (replaced with tangent-parabola cap peaking at true CLmax);
  trim Newton stalled at the throttle=1 clamp (boundary-aware Jacobian);
  rudder sign convention inverted in flight (Roskam +δr vs pilot +input);
  engine friction double-counted against the brake-power rating.

## Phase 1 deviations & known issues

- World is local flat NED at sea level; geodetic/ECEF + floating origin
  arrive with Phase 2 (per §24 ordering). The Phase-1 island/runway is
  placeholder scenery; ocean is physically solid ground until Phase 2.
- Mixture is a simple power factor; EGT/lean-assist lands in Phase 3 (§8.3).
  Engine always running (start procedure is Phase 3).
- No crash/damage model yet: a crashed aircraft skids absurdly instead of
  breaking. Damage modeling is §28 roadmap; a minimal "crash → reset" gate
  should come with Phase 2's real terrain.
- W&B settable only in code (`payloadKg`); loading UI is Phase 8 (§17).
- Prop Ct/Cp are point-tuned piecewise tables (documented in
  propulsion.ts) — physically-shaped, tuned to the POH rows, not McCauley
  data (which is proprietary).
- Automation environment suspends rAF entirely (verified: 0 rAF in 3 s), so
  fps can't be measured under automation; a watchdog timer now keeps the
  sim running when rAF stalls, and `window.__ohStep/__ohData` provide
  deterministic hooks for scripted verification. Real fps re-check due at
  Phase 2's perf gate with the pane visible.

## Phase 0 — evidence (2026-07-11)

- `tsc --noEmit` clean; `npm test`: 3 files, 14 tests, all pass
  (loop timing, solar position, sim-purity guard).
- Browser (Vite dev, WebGL2): steady-state **61.4 fps / 16.3 ms** measured via
  `window.__oh` with the tab active. No console errors or warnings.
- Sun cycle verified live: 15:46Z spawn showed sun +30.7° (correct for 08:46
  PDT); scrubbing +11.5 h produced sunset at −2.8° with twilight horizon band
  and sun-glint trail on the water. Screenshots in session transcript.
- Pause (Space) and rate keys (1/2/3) verified; fixed-timestep accounting
  matches the loop tests.
- Server: `/health` → `{ok:true}`; `/proxy/*` → 501 INOP (honest stub until
  Phase 2).

## Deviations

- **§4.1 ESLint boundary rule** implemented as a test instead
  (`tests/sim-purity.test.ts`): scans `src/sim` + `src/math` for three.js/DOM
  usage. Same enforcement, fewer dependencies. Revisit if a real lint setup
  lands later.
- **§7 sky**: Phase 0 uses three.js's `Sky` addon (Preetham-style) as the
  baseline; the custom scattering sky remains owed by Phase 5, per plan.
- **Ocean** is a Phase 0 placeholder shader (three analytic sine waves) —
  visibly repetitive up close; real land-cover-masked water is Phase 2/5 work.
- Preview-tab rAF throttling makes HUD fps read low when the tab is
  backgrounded; measurements above were taken with the tab active.

## Known issues

- Input is processed after the physics advance within a frame, so a pause
  keypress takes effect one frame late (~8 ms at 120 Hz). Harmless; revisit if
  input-to-sim latency ever matters for control feel (Phase 1).
