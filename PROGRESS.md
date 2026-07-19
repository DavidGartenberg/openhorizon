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
| 3 — Cockpit & systems | ✅ done | G1000 PFD/MFD, full systems sim, 3D cockpit, cold-and-dark verified |
| 4 — Nav & autopilot | ✅ done | radio nav, GPS/FPL, GFC700, CIFP, airspace; coupled-ILS acceptance passed after 4-round AP fix |
| 5 — Weather & sky | ✅ done | live METAR wx, clouds/whiteout, altimetry, FIS-B NEXRAD, scattering sky+stars, NLCD land cover |
| 6–10 | not started | Phase 6 (ATC & AI traffic) next |

## Phase 5 — acceptance (2026-07-19)

All three §24 criteria met, evidence in the step notes appended below:
KDEN sim-vs-actual METAR side-by-side match (step 1); BKN layer whiteout at
0.76 obscuration verified in-flight (step 4); hot-high takeoff +15% ground
roll as a permanent regression test (step 1). Steps 3/6 this session:
custom Nishita scattering sky w/ sun disc, star field and antipode moon
(real ephemeris/star catalog → §28); NLCD 2021 land cover via MRLC WMS
proxy classified per-vertex in the terrain worker (near rings z11/z13;
elevation ramp beyond + as fallback — off-legend/void pixels defer).
Deviations recorded: day-sky radiance point-tuned against ACES exposure;
moon is a permanent full moon at the solar antipode; landcover far rings
keep the ramp. Suite 345/345, POH 10/10.

## Phase 4 — evidence (2026-07-19)

- Tasks 1–6 (radio nav, GPS flight plan, GFC700, CIFP procedures, airspace
  data, cockpit wiring): done and committed in prior sessions (`c825999`..).
- **Task 7 acceptance (coupled ILS within half-scale to 200 ft AGL): PASSES**,
  including the §24-named 15 kt crosswind — after a four-round autopilot
  investigation documented in full in
  `docs/plans/phase-4-autopilot-oscillation-fix-report.md`.
- **Round-4 root cause**: the APR tracking loop closed on the deviation
  FRACTION of a localizer whose full-scale width shrinks with range —
  physical loop gain grew ~1/range and went unstable inside ~5–7 km (a 0°-
  error control case diverged; absolute cross-track oscillation grew ±13→±59 m
  with shortening period). Fix: `AutopilotInputs.navRangeM` range-normalizes
  angular deviations (clamp(range/8 km, 0, 2.5)); also dissolves the round-2
  near-antenna singularity. GPS CDI (fixed width) unchanged; all 37 prior AP
  tests pass unmodified.
- **Independent adversarial review** (fresh agent, reproduce-don't-trust):
  confirmed the law fix; independently reproduced pre-fix divergence with
  the range term removed; probed 80/110 kt, 12 nm, left-side, tailwind. It
  found two real app-side defects, both fixed and re-verified end-to-end:
  main.ts fed the AP a sign-inverted LOC deviation (positive-left vs the
  AP's positive-right contract), and the course datum (heading bug) was
  never slewed at capture — now pinned to the front course continuously
  during tracking (edge-triggered slew missed same-step instant captures;
  reviewer's repro is now a permanent regression test).
- New permanent coverage: `tests/autopilot-gs-descent.test.ts` (10 tests) —
  the coupled-GS-descent blind spot that let three earlier rounds look
  complete. Full suite **316/316**, `tsc --noEmit` clean.

## Phase 4 known limitations (recorded, queued for Phase 5 session)

- GS axis with 15 kt TAILWIND + unmanaged power (fixed throttle accelerating
  to ~118 KIAS) peaks |gs| 0.527–0.533 near DH; managed power gives 0.193.
  Cause identified: GS pitch-integrator authority (~0.5° vs ~3° needed) and
  the GS fraction is not yet range-normalized. §24's crosswind criterion
  passes.
- NAV+VOR is an angular source fed without `navRangeM` (enroute ranges keep
  it stable) and the VOR TO/FROM sign vs the AP convention needs the same
  wiring test the LOC path now has.
- Browser end-to-end PROC-loaded coupled approach still owed as the Phase 5
  session's opening verification (headless app-faithful feed path verified
  by the reviewer; the in-browser flight is the last mile).

## Phase 3 — evidence (2026-07-15)

Plan: `docs/plans/phase-3.md`. Built in 4 reviewed/fixed tasks (2a-2d) plus
acceptance verification (2e), each with a fresh implementer + independent
reviewer subagent, following `superpowers:subagent-driven-development`.
Full task reports: `docs/plans/phase-3-task2a-report.md` through
`phase-3-task2d-report.md`, plus `phase-3-acceptance-report.md`.

- **Suite: 141/141 tests, tsc clean, sim-purity green.** New systems
  suites: `tests/systems/{electrical,fuel,pitot,engine-start,engine-temps}.test.ts`,
  cockpit math suites `tests/cockpit/{pfd,mfd}.test.ts`,
  `tests/render/cockpit.test.ts`.
- **Systems sim** (`src/sim/systems/`): 28V electrical bus with
  alternator-failure battery drain + standby-outlives-main load shed;
  L/R/BOTH fuel with gravity-feed imbalance, starvation, and restart;
  pitot-icing/static-blockage instrument misreads (never touches truth
  data, only what the gauge shows); cold/hot/flooded engine-start state
  machine with POH-range magneto check; peak-EGT mixture model (smooth,
  no discontinuities) driving lean-assist; a small first-order thermal-lag
  model for oil temp/press/CHT (didn't exist before this phase — built as
  a real model, not an INOP stub).
- **G1000 PFD/MFD** (`src/cockpit/pfd.ts`, `mfd.ts`): canvas-2D textures,
  ≥1024px. PFD: airspeed tape w/ real V-speed arcs (from `c172s.ts`, not
  reinvented) + trend vector, attitude w/ slip/skid, altitude tape + baro,
  VSI, HSI with an honestly-inert CDI ("NO NAV" — no fake guidance before
  Phase 4's real nav), NAV/COM/XPDR boxes, OAT/TAS/GS, annunciator,
  softkey bezel. MFD: EIS strip (RPM/FF/oil/EGT+CHT/fuel/volts-amps)
  always visible, lean-assist page, map page (airport symbols + elevation
  shading, reusing Phase 2's `TileManager`/`Airports`), FPL skeleton
  (honest empty state).
- **3D cockpit** (`src/render/cockpit.ts`, `cockpit-camera.ts`): panel
  built from primitives (no glTF pipeline available — same as the
  exterior model, disclosed deviation, not silent). PFD/MFD mounted as
  live `CanvasTexture` planes. Switch row, ignition key, starter,
  throttle/mixture verniers, flap lever, trim wheel, floor fuel selector
  all physically clickable/draggable via raycasting, routed into
  `aircraft.controls` (second input path alongside keyboard — doesn't
  regress it) and a new `SystemsControls` object. 4th camera mode
  (`cockpit`) added to the chase/orbit/free cycle. Systems wired into the
  fixed-timestep loop for the first time — `aircraft.engineRunning` now
  reflects the real engine-start state machine.
- **Acceptance (2026-07-15, full report in `phase-3-acceptance-report.md`)**:
  - *Cold-and-dark → run-up, every switch physical*: **PASS.** Genuine
    fuel-starvation flameout via a physical fuel-selector click (not a
    debug hook), full dark-cockpit reached via physical switches, restart
    via physical battery/throttle/ignition/starter. Magneto check via
    physical ignition-key clicks: RIGHT 793 RPM, LEFT 808 RPM, BOTH 918
    RPM → drops of 125/110 RPM, 15 RPM split — exact match to
    `engine-start.ts`'s tested constants, confirmed reachable through the
    real cockpit UI, not just headlessly.
  - *Alternator-failure drill*: **PASS.** `__ohFail('alternator')`
    (a legitimate scenario trigger) → battery immediately flips to
    discharge, drains steadily, main/avionics bus load-shed exactly at
    the 15% SOC threshold, standby bus stayed powered throughout
    (confirmed at every sample including after main-bus loss) —
    `batteryAmps` after shed matched `STANDBY_LOAD_AMPS` exactly,
    confirming main-bus loads were genuinely disconnected.
  - *Lean-assist finds peak EGT*: **PASS.** Real mixture-knob control
    (`__ohCtl`/physical drag both exercised) at mixture≈0.35 shows
    `EGT: 732 C`, `-0 C FROM PEAK`, with the lean-assist graph's peak
    marker sitting exactly on the curve's maximum — matches
    `mixture.ts`'s tested `EGT_PEAK_C`/`EGT_PEAK_MIXTURE` constants
    exactly, confirmed live on the MFD, not just headlessly.

## Phase 3 deviations & known issues

- **Ignition key click-cycle** (`off → right → left → both → off`) makes
  `BOTH` cyclically adjacent to `OFF`, unlike a real magneto switch's
  detent layout (`OFF–R–L–BOTH–START`, where `BOTH`→`R`/`L` never passes
  through `OFF`). Verified real: cycling forward from `BOTH` stops the
  engine. Doesn't block the magneto check (start the crank on `RIGHT`
  instead) but should be fixed so the habitual "start/check from BOTH"
  workflow doesn't require a workaround.
- **No physical fuel-pump/boost-pump switch** in the 3D cockpit yet
  (`systemsControls.boostPumpOn` has no mesh) — doesn't block engine
  start (no dependency in `engine-start.ts`), but is a gap against the
  POH's "battery on → fuel pump → mixture rich..." flow text.
- **MFD page softkeys not wired** — `page` is hardcoded to `'lean'` in
  `main.ts`; `mfdSoftkeyRegions` hit-test geometry exists but nothing
  routes a click to change the active page. Map/FPL pages are built and
  correct, just not reachable via UI yet.
- Full nav (VOR/ILS/GPS, real CDI, procedures) is Phase 4 — PFD/MFD nav
  elements render but are honestly inert this phase, per plan.
- Standby instruments are placeholder shapes in the 3D cockpit (not a
  full canvas gauge renderer) — the master spec allows this scope for
  Task 2d; a dedicated standby-gauge canvas is a reasonable follow-up.
- Two independent fuel ledgers existed briefly during Task 2d
  (`aircraft.fuelKg` vs `fuelState.leftKg/rightKg`) — fixed in review:
  `fuelState` is now authoritative, `aircraft.fuelKg` syncs from it each
  tick without touching `Aircraft`'s internals.
- Cold-and-dark is fully reachable (verified above) but is **not** the
  boot default — boot seeds `engineStartState` to `running` to preserve
  already-verified spawn/takeoff behavior (e.g. the ground-yaw flight-
  assist fix from the prior session assumes a running engine at spawn).
  A deliberate, disclosed tradeoff, not a shortcut.

## Flight assist — verification (2026-07-14)

Committed `3920bf3` added assist (X toggles, was default ON) but was not
browser-verified end-to-end. Verified this session via scripted flights
(dispatched keyboard events + `__ohStep`, never wall-clock waits):

- **Ground-yaw hold: fixed and passing.** The shipped damper was pure
  rate-damping (`-5·rates.z`), which can't null a *steady* P-factor/torque
  disturbance — measured 36.4° heading drift by rotation speed (KHAF 30).
  Redesigned as heading-lock (P+D) plus an RPM-keyed feed-forward term
  (the disturbance grows with RPM through the roll, 2378→2511, so a purely
  reactive loop lags it). Re-verified: 5.7° max drift, within the ±10°
  bar.
- **Airborne climb-hold: not solved, assist defaulted OFF.** A pure
  rate-only pitch damper has no target, so releasing the stick after
  rotation let the aircraft sink back onto the runway instead of
  sustaining the climb. Traced headlessly (bypassing terrain/input-layer
  entirely) to confirm root cause: with elevator neutral and trim
  untouched, the aircraft correctly seeks its *untrimmed* equilibrium —
  not random instability. Tried, in order: (1) attitude-hold (lock
  rotation pitch, P+D) — settles back to the runway; (2) attitude-hold +
  trim follow-up (two gains) — delays the sink and raises peak altitude
  but still settles within ~5 s, consistent with a phugoid-style
  speed/altitude trade a fixed-attitude target can't damp; (3)
  airspeed-hold (pitch-for-Vy) from the moment of liftoff — worse, dives
  for speed with no altitude margin and drives it into the ground harder.
  The real fix is a staged controller (attitude-hold to establish initial
  climb, blended to airspeed-hold once altitude margin exists) — genuine
  flight-control design, not a tuning pass, so it's left for a dedicated
  session rather than guessed at here.
- **Deviation from §17** ("assists default OFF"): `assistOn` default set
  to `false` in `src/main.ts` — the verified ground-yaw hold is real and
  useful, but an assist that can still fly a hands-off climb into the
  ground should not default on. Revisit both the default and the climb
  controller together, ideally with a headless regression test (mirroring
  `tests/handling.test.ts`) so the phugoid behavior is caught without a
  browser.

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

- **Phase 5 opening verification (2026-07-19): browser coupled ILS PASSED** —
  KSFO 28R via real app wiring (__ohTune 111.7/__ohApMaster/__ohApMode),
  15 kt crosswind: worst loc 0.105, GS 0.281, to 200 AGL. Found+fixed en
  route: ilsRefFromRunwayThreshold computed the RECIPROCAL course (only the
  app path used it); KSFO 28R/28L freqs swapped vs published; crosswind +
  instant-capture diverged until tracking steers ground TRACK (new
  trackDeg input; crab falls out physically). Suite 317/317.

- **Phase 5 steps 0b+1 (2026-07-19)**: GS law range-normalized + integrator
  authority 0.5°→3° (15 kt tailwind regression test passes); vorCdi needle
  convention unified across TO/FROM (AP tracking TO a VOR steered away —
  review finding), VOR negated+ranged at the AP feed, GPS needle flipped
  for display. Live METAR weather: TDD parser, bbox proxy (10-min TTL),
  IDW blending w/ 150 km region guard (a live race applied coastal fog at
  Denver — now a regression test), wind/gusts/turbulence + ISA temp offset
  → density altitude (hot-high +15% roll test). Verified live side-by-side:
  sim KDEN "267@6 10SM FEW180 ISA+18" vs actual "27007KT 10SM FEW180
  22/11". Suite 333/333. Remaining: QNH→indicated alt (baro), sky, clouds/
  whiteout, FIS-B NEXRAD+lightning, land-cover texturing (phase-5.md 2-6).

- **Phase 5 steps 4/2/5 (2026-07-19)**: METAR cloud layers (billboard fields,
  world-grid stable) + in-cloud whiteout driven by the same slabs (0.76 in
  BKN verified in-flight); visibility fog from reported vis; Kollsman
  altimetry w/ baro knob (;/') + live QNH; teleport clears stale-region
  weather to neutral; FIS-B NEXRAD on the MFD w/ age stamp + in-precip vis
  caps + lightning/thunder — verified against a real KHSV storm system (171
  cells). Suite 342/342. REMAINING for Phase 5 close: custom scattering sky
  (step 3), land-cover texturing (step 6), acceptance wrap + PROGRESS.

- **Phase 6 slices a-c (2026-07-19)**: comms bus w/ freq-gated audibility,
  real airport frequencies pipeline, ATIS from live weather (runway by
  headwind), Ground taxi+readback, Tower strip machine (hold short/clear
  takeoff/sequence/clear to land), pilot request menu (T + digits),
  transcript window, per-speaker speechSynthesis voices w/ squelch clicks
  (Web Speech cannot route through WebAudio band-pass — recorded).
  Browser-verified full KPAO departure exchange on real 135.275/125.0/
  118.6. Suite 356/356. NEXT: 6d AI traffic, 6e integration, 6f IFR +
  acceptance flights (see docs/plans/phase-6.md).
