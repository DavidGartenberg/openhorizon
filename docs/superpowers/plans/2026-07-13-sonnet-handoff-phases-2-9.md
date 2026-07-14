# OpenHorizon Phases 2–9 Implementation Plan (Sonnet 5 handoff)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Finish Phase 2 (US terrain/airports) and execute Phases 3–9 of the
flight simulator exactly as specified in `../FLIGHT-SIM-MASTER-PROMPT.md`.

**Architecture:** Pure-TypeScript sim core (`src/sim`, `src/math` — no
three.js, test-enforced) integrated at fixed 120 Hz; Three.js render layer;
floating-origin geodetic world streaming real USGS terrain + OurAirports data
through a Vite-middleware/Express shared proxy. Every gauge reads sim state.

**Tech Stack:** TypeScript strict, Vite 6, Three.js 0.180, Vitest 3, Express;
Node 24 at `~/.local/node/bin` (export PATH first — machine default has none).

## Global Constraints (read before every phase)

- **The spec of record is `../FLIGHT-SIM-MASTER-PROMPT.md`** (repo parent
  dir). Its §2 process rules are binding: plan doc per phase in
  `docs/plans/phase-N.md`, TDD for all /sim logic, `npm run validate` green
  before/after every phase, browser verification with screenshots, update
  `PROGRESS.md` (evidence + deviations), commit per milestone with
  `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>`.
- **Never fake an instrument; never silently degrade a requirement** —
  record deviations in PROGRESS.md. Never loosen a POH tolerance to pass.
- Commands: `npm test`, `npm run validate`, `npx tsc --noEmit`,
  `npm run dev` (client :5173 serves /proxy/* and /api/* via Vite plugin).
- `/sim` + `/math` must stay three.js/DOM-free (tests/sim-purity.test.ts).
- Conventions that already bit us — do not rediscover:
  - Body x fwd / y right / z down; NED world, z down, altitude = −z.
    Render: x=east, y=up, z=south; mesh rotation order 'YXZ',
    y=−heading, x=+pitch, z=−roll.
  - Pilot +rudder input = nose right; aero derivative sign is Roskam
    (+δr = TE-left) → `ai.rudderRad = -c.yaw * max` (aircraft.ts).
  - Trim solver Jacobian must probe away from clamped boundaries.
  - Browser automation suspends rAF: use `window.__ohStep(dt)`,
    `__ohData()`, `__ohSpawn(q)`, `__ohWind(dir,kt)`, `__ohTime(h)`
    hooks (main.ts) — never rely on wall-clock waits or HUD fps.
  - Tune physics ONLY in `src/sim/aircraft/c172s.ts` + the Ct/Cp tables
    in `src/sim/propulsion.ts`; rerun the whole validate suite after any
    change (rows interact).

## Escalation protocol: when to STOP and ask Fable

Stop work and produce a question block (paste-ready for the user to give
Fable) when ANY of these hit:

1. The same test/bug survives **2 distinct fix attempts**.
2. A physics change makes one §5.6 row pass but regresses another and one
   more iteration doesn't converge.
3. NaN/instability in the integrator, or anything requiring a change to
   the 6-DOF core (`aircraft.ts` step order, quaternion math, gear model).
4. An architecture decision not answered by the master prompt (§4) or this
   plan (e.g., worker protocol changes, new dependency, data format).
5. You are tempted to widen a tolerance, stub a system, or skip a
   verification step to make progress.

Question block format:

```
FABLE ESCALATION — Phase N, Task M
What I'm trying to do: …
What happened (exact output/numbers): …
What I tried (attempt 1 / attempt 2): …
My best hypothesis: …
Specific question: …
Files touched: …
```

---

### Task 1: Finish Phase 2 — verification + commit (IN PROGRESS, ~95% built)

Phase 2 code is complete and uncommitted (`git status`): geo math, terrain
worker/tiles, airports, flattening, floating origin, crash guard, search UI.
38/38 tests green, tsc clean. What remains is browser verification, PROGRESS,
commit.

**Files:** no new code expected; `PROGRESS.md`; possibly small fixes.

**Interfaces produced (later phases rely on these):**
- `TileManager.elevationAt(lat, lon): number` (m MSL, flattened via
  `Airports.flattenElevation`) — TAWS (Phase 7) reuses this.
- `WorldFrame.toLocal/fromLocal`, `frame.anchor` rebase pattern.
- `Airports.find/near`, `AirportData {i,n,la,lo,e,t,r[]}`.
- `aircraft.groundElevAt`, `aircraft.crashed`, `data.aglFt`.

- [ ] **Step 1:** `export PATH="$HOME/.local/node/bin:$PATH"`; run
  `npx tsc --noEmit && npm test` → expect 38 passed.
- [ ] **Step 2:** Start preview (launch.json name `openhorizon`). In the
  page: wait ~7 s, run `window.__ohData()` → expect
  `spawn:"KHAF 30"`, `gnd:true`, `tiles>150`, `airportsLoaded:true`,
  lat≈37.509, alt≈40–70 ft. Screenshot.
- [ ] **Step 3:** Mountain elevation proof: `__ohSpawn('KTRK')`, wait for
  tiles (~8 s), `__ohData()` → alt ≈ 5800–6000 ft, `gnd:true`. If alt≈0,
  tiles didn't load — check `/proxy/terrain/...` in network log (escalate
  after 2 attempts).
- [ ] **Step 4:** Dusk landing: `__ohSpawn('KSFO 28R final')`;
  `__ohTime(10)` (or enough hours for sun elevation just below 0 — read
  HUD); screenshot on final (city + bay terrain + runway lights at dusk).
  Let it fly the trimmed −3° path (real time or repeated `__ohStep(0.5)`
  loops); expect touchdown near threshold, `gnd:true`, `crashed:false`,
  and rollout to a stop with brakes (hold KeyB via dispatched keydown).
  A firm landing that trips the crash guard = tune nothing; retry with a
  small flare (ArrowDown tap at 20 ft AGL via dispatched keys).
- [ ] **Step 5:** Rebase check: `__ohSpawn('KHAF')`, full-throttle takeoff
  via dispatched keys (W held; ArrowDown 0.7 s at 57 KIAS; then small
  right-aileron taps to counter torque), fly ~6 min sim (use rate 4 via
  Digit3) heading north; confirm no jitter/pop when crossing 10 km
  (`__ohData().lat` keeps advancing; `tiles` stays >100; no console
  errors).
- [ ] **Step 6:** With the preview pane visible (not automated), read HUD
  fps ≥ 60 target / ≥ 30 minimum near KSFO. Record the number.
- [ ] **Step 7:** Update PROGRESS.md: Phase 2 evidence (numbers from steps
  2–6), deviations already listed in `docs/plans/phase-2.md` (buildings
  deferred, NLCD → Phase 5, ring LOD, curvature-drop approximation, PAPI
  deferred — add PAPI explicitly). Mark Phase 2 ✅.
- [ ] **Step 8:** `git add -A && git commit` — message:
  `Phase 2: streamed US terrain, real airports, floating origin, terrain physics`.

### Task 2: Phase 3 — Cockpit & systems (§8, §24)

Write `docs/plans/phase-3.md` first (§2). Build order within the phase:

- [ ] 2a. **Systems sim first, TDD** (`src/sim/systems/electrical.ts`,
  `fuel.ts`, `pitot.ts`, `engine-start.ts`): 28 V bus model per §8.4,
  L/R/BOTH fuel with imbalance + starvation/restart, pitot/static
  blockage effects re-routing `kiasFromKcas` inputs, magneto/starter state
  machine (mag drop 100–150 RPM, max 50 diff), mixture→EGT curve with
  peak-EGT detection. Tests: cold-and-dark start sequence per POH;
  alternator failure drains battery until G1000 dies (standby survives);
  each failure mode. Wire into `Aircraft.step` behind a `SystemsState`.
- [ ] 2b. **G1000 PFD** as canvas-2D texture ≥2048 px (`src/cockpit/pfd.ts`
  drawing from `FlightData` + systems): airspeed tape w/ V-speed arcs,
  attitude, altitude tape + baro knob, VSI, HSI w/ heading bug, wind box,
  nav/com boxes, annunciations. Softkeys clickable (raycast → region map).
- [ ] 2c. **MFD + EIS** (`src/cockpit/mfd.ts`): EIS strip (RPM/FF/oil/EGT
  lean-assist/fuel/volts), moving map reusing tile heightfields for
  terrain shading, FPL page skeleton (full nav Phase 4).
- [ ] 2d. **3D cockpit** (`src/render/cockpit.ts`): panel per §8 layout,
  yoke/throttle/mixture/flap/trim/fuel-selector/switch meshes, click+drag
  interactions routed to `aircraft.controls` and systems; cockpit camera
  mode added to the C-key cycle.
- [ ] 2e. Acceptance (§24): cold-and-dark → run-up via real checklist,
  every switch physical; alternator-failure drill; lean-assist finds peak.
  Browser-verify with screenshots; PROGRESS; commit.

### Task 3: Phase 4 — Nav & autopilot (§9, §10)

Plan doc, then: `src/sim/nav/` (radio nav VOR/ILS/DME geometry + Morse
idents, GPS flight plan legs w/ turn anticipation, CDI scaling), FAA CIFP
build-time parser in `server/` (download 28-day CIFP, parse
SID/STAR/approach legs → JSON chunks; escalate to Fable for the ARINC 424
leg-type subset if parsing stalls), GFC700 (`src/sim/autopilot.ts` —
cascaded PID, gain-scheduled by IAS, modes ROL/HDG/NAV/APR/ALT/ALTS/VS/FLC,
auto-trim, servo rate limits). TDD every mode (step-response tests + capture
scenarios). Acceptance: coupled ILS 28R KSFO in 15 kt crosswind inside
half-scale to 200 AGL (headless scenario test + browser flight).

### Task 4: Phase 5 — Weather & sky (§11, §7)

METAR/TAF/winds-aloft proxy routes (aviationweather.gov) + parser (TDD with
fixture METARs); weather → `WindModel` layers + ISA deviations (QNH/temp →
altimetry: pressure altitude plumbing into `atmosphere.ts`); FIS-B-latency
NEXRAD tiles (IEM) on MFD + world rain cells + lightning w/ distance-delayed
thunder; cloud layers (billboard/raymarch domes per §7), visibility/fog;
custom scattering sky replacing the three.js Sky addon; NLCD-style
land-cover texturing upgrade of the terrain color ramp. Acceptance per §24
(KDEN METAR side-by-side; BKN layer whiteout; hot-high takeoff longer).

### Task 5: Phase 6 — ATC & AI traffic (§12, §13)

`src/sim/atc/` facility state machines (ATIS gen from live METAR, CD/GND/
TWR/APP/CTR handoffs), phraseology templates + readback menu UI,
speechSynthesis voices through a WebAudio radio filter (band-pass 300–3000 Hz
+ noise + squelch); `src/sim/traffic/` point-mass AI (per-class performance),
airline schedules at hubs + GA at small fields, lifecycle gate→gate, traffic
on frequency, worker-side updates 1–5 Hz interpolated. Acceptance flights
per §24. This is the largest phase — expect to escalate on sequencing logic.

### Task 6: Phase 7 — TCAS & TAWS (§14, §15)

Pure modules + scripted-geometry unit tests FIRST (tau tables, DMOD, RA
sense selection, reversal; GPWS modes 1–6 envelopes, RAAS runway
advisories, look-ahead TAWS using `TileManager.elevationAt` along predicted
path, approach inhibition near runways). Then displays (traffic symbols on
MFD, VSI fly-to cues) and aurals. Acceptance: all scripted encounters/CFIT
tests pass ±1 s; normal ILS silent.

### Task 7: Phase 8 — Recorder, logbook, training, activities (§18–§21)

Flight recorder ring buffer (10 Hz states + events) → replay scrubber +
debrief screen (landing fpm/centerline/touchdown point, graphs); logbook +
persistent airframe (IndexedDB, export JSON); ACS-graded training scripts
(steep turns ±100 ft/±10°/±10 kt, pattern, short-field within 200 ft,
engine-out with glide ring); landing challenges + bush trips as JSON
scenario files. TDD the graders with synthetic recorded flights.

### Task 8: Phase 9 — Polish (§16, §17, §19)

Sound design (WebAudio engine synth keyed to RPM/power, stall horn ramp,
gear/flap/trim, aurals), settings + bindings UI, save/load snapshots, W&B
loading UI with envelope plot, graphics polish (night city emissive, PAPI,
autogen if budget holds), performance pass to §19 budget at KLAX
real-traffic storm dusk. Then the §27 definition-of-done flight, PROGRESS
final, commit. (Phase 10 stretch — 737/Cub — only after §27 is met.)

## Self-review notes

- Spec coverage: Tasks 1–8 map to master-prompt §24 Phases 2–9; the master
  prompt carries the detailed per-system requirements (§5–§21) — this plan
  deliberately references rather than duplicates them; each phase's
  `docs/plans/phase-N.md` (required by §2) is where Sonnet expands tasks
  into code-level steps like the existing `phase-0/1/2.md` examples.
- Type consistency: interface names in Task 1 match the committed code.
- No placeholders: Task 1 (the only in-flight work) is fully specified;
  Tasks 2–8 are phase gates whose detailed specs live in the master prompt
  by design.
