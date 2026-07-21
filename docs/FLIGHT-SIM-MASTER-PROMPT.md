# MASTER PROMPT — "OpenHorizon" Flight Simulator

You are Claude (Fable), acting as the sole engineering team for **OpenHorizon**: a
browser-based flight simulator built with **Three.js + TypeScript**, covering the
**entire continental United States** with real terrain, real airports, real
airspace, real weather (including live NEXRAD radar), a study-level Cessna 172S
G1000, working ATC with voice, AI traffic, TCAS logic, terrain awareness warnings
(GPWS/TAWS), a flight recorder with graded debriefs, a persistent pilot logbook,
FAA-standards-based flight training, and scored landing challenges and bush trips.

This document is the contract. Read it fully before writing any code. Build it
phase by phase, in order. Every phase has acceptance criteria; a phase is not done
until they pass.

---

## 1. Mission and honesty rules

The goal is the most realistic flight simulator a single web codebase can honestly
be. "Realistic" is defined by measurable things, not vibes:

1. **Physics realism** means the simulated C172S matches the real Pilot's Operating
   Handbook performance numbers within the tolerances in §5.6 — verified by
   automated headless tests, not by eyeballing.
2. **World realism** means real USGS-derived elevation for the whole US, real
   airport/runway/frequency/navaid/airspace data, and real live weather — all
   streamed from the free public-domain sources in §26.
3. **Systems realism** means every gauge, annunciator, and warning is driven by the
   simulation state. **Never fake an instrument.** No canned animations, no
   hardcoded readouts, no "close enough" displays that don't read real state.

Binding honesty clauses:

- If a requirement in this document cannot be met as written, do **not** silently
  degrade it. Implement the best honest version, and record the gap explicitly in
  `PROGRESS.md` under a "Deviations" heading with the reason.
- Never claim a phase is complete without running its acceptance criteria.
- Never stub a system to "return plausible values." A stub must be visibly labeled
  INOP in the UI until it is real.

---

## 2. How to work (binding process rules)

- **Plan first, per phase.** Before coding each phase, write a short plan into
  `docs/plans/phase-N.md`: files to create, data flow, risks. Keep it under a page.
- **Test-driven for pure logic.** Flight dynamics, atmosphere, TCAS, GPWS, ATC
  state machines, maneuver grading, geo math, and data parsers are pure TypeScript
  modules with **Vitest** unit tests written alongside (or before) the
  implementation. Rendering code is exempt from unit tests but not from browser
  verification.
- **Headless validation harness.** The sim core must run without a renderer. Build
  `npm run validate` early (Phase 1): it trims/flies the aircraft numerically and
  asserts the POH performance table in §5.6. This runs in CI-style on every phase.
- **Verify in the browser.** After each phase, launch the dev server, fly the
  relevant scenario, and take screenshots. A phase verified only by "it compiles"
  is not verified.
- **Keep a `PROGRESS.md`** at the repo root: per-phase status, deviations, known
  issues, and the exact commands to run/test. Update it every session.
- **Commit per milestone** with clear messages. Keep `main` always runnable.
- **Performance is a feature.** Budget in §23 is binding; profile before adding
  visual features, and never merge a change that drops sustained FPS below target.
- **Stream, don't download.** Never bulk-download terrain/imagery datasets. Fetch
  tiles on demand, cache with LRU (memory + IndexedDB), respect the source's terms.
- **Every phase ships.** At the end of any phase the sim must be a runnable,
  playable thing — never leave it dismantled between phases.

---

## 3. Tech stack

- **TypeScript**, strict mode. **Vite** for dev/build. **Vitest** for tests.
- **Three.js** (latest) on **WebGL2**. Custom GLSL shaders where quality demands it
  (sky scattering, clouds, terrain splatting, water). No physics engine library —
  flight dynamics are written from first principles per §5. (A tiny rigid-body
  integrator for gear/ground contact is written by hand too.)
- **Web Workers** for terrain tile decode + mesh generation, and for AI traffic
  updates. Main thread owns render + player physics only.
- **WebAudio** for all sound (synthesized engine, radio-filtered voices).
- **Web Speech API** (`speechSynthesis`) for ATC/pilot voices.
- **Small Node companion server** (`server/`, Express): CORS proxy + disk cache for
  tile/METAR/radar/data fetches, plus build-time parsers that convert OurAirports
  CSV, FAA CIFP, and FAA airspace shapefiles into compact binary/JSON chunks
  served to the client. Dev runs both via one `npm run dev`.
- No heavyweight frameworks for UI. Cockpit displays are canvas-2D textures; menus
  are plain TS + DOM with clean CSS.

---

## 4. Architecture

### 4.1 Separation

```
/src
  /sim        pure simulation: physics, systems, autopilot, atc, traffic,
              tcas, gpws, weather, nav, recorder, grading — NO three.js
              imports allowed here
  /world      terrain streaming, airports, airspace, scenery generation (workers)
  /render     three.js scene, materials, shaders, cameras, cockpit 3D
  /cockpit    G1000 + gauge canvas renderers (draw functions take sim state)
  /ui         menus, settings, map, ATC window, debrief, logbook, lessons
  /audio      engine synth, callouts, radio effects
  /data       parsers + typed accessors for airports/navdata/procedures/airspace
  /math       geodesy (WGS84/ECEF/ENU), quaternions, atmosphere, units
/server       proxy + cache + build-time data pipeline
/tests        vitest suites incl. the POH validation harness
```

Enforce the "no three.js in /sim" rule with an ESLint restriction. The sim must be
importable in Node for headless tests.

### 4.2 Time

- Physics at a **fixed 120 Hz** timestep, accumulator pattern; render decoupled
  with interpolation. Sim-rate control (pause, 1x, 2x, 4x) scales accumulated time,
  never the timestep.

### 4.3 Coordinates and precision (critical for a US-sized world)

- Truth state is geodetic **WGS84** (lat, lon, ellipsoidal alt) + ECEF, in JS
  doubles. All /sim math is double precision.
- Rendering uses a **floating origin**: a local ENU frame rebased whenever the
  aircraft moves >10 km from the current origin, so Three.js f32 coordinates never
  exceed ~10⁴ m. Rebase must be seamless (no visible pop).
- Earth curvature is real: terrain tiles are placed on the WGS84 ellipsoid, so long
  flights and high altitudes look correct at the horizon.
- Magnetic variation from the World Magnetic Model (implement the standard WMM
  coefficient evaluation, ship current epoch coefficients). All headings shown on
  instruments are magnetic; all internal math is true.

---

## 5. Flight dynamics (the heart — do not cut corners)

### 5.1 Model

Full **6-DOF rigid body**: state = position (ECEF), velocity (body + world),
attitude quaternion, angular rates; forces/moments summed in body frame from:

- **Aerodynamics**: coefficient buildup model.
  - Lift: `CL = CL0 + CLα·α` up to nonlinear stall region; model post-stall CL
    falloff smoothly (flat-plate blend) so stalls and falling-leaf behavior are
    flyable, not a cliff. Flap deflection shifts CL0/CLmax and CD.
  - Drag: `CD = CD0 + CL²/(π·e·AR)` + flap/gear increments + control deflection drag.
  - Side force, and full static + dynamic stability derivatives:
    `Cmα, Cmq, Cmα̇, Clβ, Clp, Clr, Cnβ, Cnp, Cnr, Cyβ, Cyr` and control
    derivatives `Cmδe, Clδa, Cnδa (adverse yaw!), Cnδr, Clδr`.
  - Downwash lag on the tail; ground effect (lift up, induced drag down) as a
    function of height/wingspan below ~1 span.
  - Propwash over tail (elevator/rudder authority increases with power at low
    speed) and **P-factor + slipstream swirl + torque** so a full-power climb
    genuinely needs right rudder.
- **Propulsion (C172S)**: Lycoming IO-360-L2A, 180 hp @ 2700 RPM, **fixed-pitch**
  prop. Model: engine torque map vs RPM/manifold-density/mixture → balances against
  propeller torque (blade-element-lite or Cp/Ct table vs advance ratio J) → RPM
  emerges dynamically. Mixture affects power and EGT (peak-EGT leaning must work on
  the G1000 lean-assist page). Density altitude correctly degrades power. Fuel flow
  from power (≈10 gph at 75%). Starter, magneto check drop (~100–150 RPM, max 50
  diff), fuel-injected hot-start nuance lightly.
- **Ground reactions**: three gear as spring-dampers with tire friction (static /
  rolling / lateral slip), nosewheel steering blended with rudder, differential
  braking, weathervaning in crosswind. Taxi, takeoff roll, crosswind landings, and
  wheelbarrowing must all behave plausibly. Grass/asphalt friction differ.
- **Mass**: weight & balance from a loading UI (pilot/pax/baggage/fuel per POH
  stations); CG position affects Cm and stall behavior; inertia tensor scales with
  loading. Fuel burn shifts weight live.

### 5.2 Atmosphere

Full **ISA model**: T/p/ρ vs altitude (troposphere+), plus METAR-driven deviations
(QNH, temperature). Compute and expose IAS/CAS/TAS/GS, Mach, density altitude,
pressure altitude correctly — pitot-static physics per §8.4.

### 5.3 Wind and turbulence

Layered wind (surface from METAR, winds-aloft interpolation), gusts, and a
**Dryden turbulence model** driven by a turbulence intensity setting/weather.
Thermals optional (stretch). Wind affects the air mass, so drift, crab, headwind
performance and groundspeed all emerge naturally.

### 5.4 C172S reference data (starting values — tune to pass §5.6)

- Geometry: wing area 174 ft², span 36.1 ft, AR 7.32, MAC ≈ 4.9 ft.
- Mass: MTOW 2550 lb, typical empty (G1000) ≈ 1680 lb, usable fuel 53 US gal.
- Inertias (slug·ft²): Ixx 948, Iyy 1346, Izz 1967, Ixz ≈ 0.
- Starting aero coefficients (per radian, from published C172 data — Roskam et
  al.): CL0 0.31, CLα 5.1, CLmax clean ≈1.6 / full flap ≈2.1, CD0 0.032, e 0.75,
  Cmα −0.89, Cmq −12.4, Cmδe −1.28, Clβ −0.089, Clp −0.47, Cnβ 0.065, Cnr −0.099,
  Cyβ −0.31, Clδa 0.178, Cnδa −0.053, Cnδr −0.043.
- Flaps: 0/10/20/30°, electric, with real travel times.
- V-speeds (KIAS): Vso 40, Vs1 48, Vx 62, Vy 74, Vfe 110 (10°)/85 (full),
  Va 105 @ 2550 lb, Vno 129, Vne 163, best glide 68.

### 5.5 Trim solver

Implement a numerical trim routine (given speed/altitude/power, solve for
α/elevator/throttle). It powers the validation harness and "start in cruise"
spawn options.

### 5.6 POH validation table (automated — `npm run validate` must assert these)

All at MTOW, ISA, sea level unless noted:

| Test | Target | Tolerance |
|---|---|---|
| Stall speed, flaps up, power idle | 48 KIAS | ±2 kt |
| Stall speed, flaps 30, power idle | 40 KIAS | ±2 kt |
| Max rate of climb at Vy (74 KIAS) | 730 fpm | ±60 fpm |
| Cruise 75% power, 8500 ft | 124 KTAS | ±4 kt |
| Max level speed, sea level | ~126 KIAS | ±4 kt |
| Glide ratio at 68 KIAS | ~9:1 | ±0.8 |
| Takeoff ground roll | 960 ft | ±15% |
| Landing ground roll | 575 ft | ±15% |
| Service ceiling (climb ≤ 100 fpm) | ~14,000 ft | ±1,500 ft |
| Static RPM, full throttle | 2300–2400 RPM | in range |

Also scenario tests: power-on stall requires right rudder; steady slip descends
faster; full-flap go-around pitches up requiring forward pressure; crosswind
component >15 kt makes centerline hold demand technique.

---

## 6. World: the entire US, streamed

### 6.1 Terrain

- Elevation from **Terrain Tiles on AWS** (terrarium PNG,
  `https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png`,
  public open data, no key). Decode in workers.
- **Quadtree LOD** centered on the aircraft: high zoom (z12–14) nearby, falling off
  to z7–8 at the horizon; geomorphing or skirts to hide LOD seams; normals computed
  from the heightfield. Horizon distance ≥ 150 km at altitude.
- Collision/AGL queries against the loaded heightfield (radio altimeter, GPWS,
  gear contact) — never against render meshes.

### 6.2 Texturing and seasons

- Primary: **procedural splatting driven by land-cover class** (NLCD-derived tile
  layer or a downsampled land-cover raster baked at build time): forest, cropland
  (with field-grid detail noise), grassland, desert, urban, water, snow. Detail
  textures generated procedurally (noise-based), tinted per biome — this keeps the
  whole US good-looking with zero licensing risk.
- **Seasons**: the sim date drives biome appearance — snowline by latitude,
  elevation, and month; deciduous forest turns fall colors in October; croplands
  brown after harvest; frozen lakes in deep winter at northern latitudes. Season
  follows the (real or user-set) date automatically.
- Optional imagery mode: USGS National Map NAIP imagery tiles (public domain)
  through the proxy for photoreal ground near the aircraft, blending to procedural
  at distance. Feature-flag it; procedural is the default and must stand alone.
- **Water**: flat animated-normal water for oceans/lakes (land-cover mask), sun
  specular.
- **Night**: emissive city lights masked by urban land cover, visible from
  altitude.

### 6.3 Airports (all of them)

- Source: **OurAirports** public-domain CSV (airports, runways, frequencies,
  navaids). Build-time pipeline compacts these into regional JSON chunks.
- Every US airport gets: correctly placed/oriented/sized runway(s) with surface
  type, threshold/centerline/touchdown-zone markings and numbers, edge lights,
  PAPI/VASI on instrument runways, REIL, rotating beacon, windsock (animated,
  reads sim wind!), simple apron + procedural hangars/GA buildings scaled to
  airport size; big hubs get a generic terminal + tower.
- **Pilot-controlled lighting** at unattended fields: key the mic 7/5/3 times
  within 5 seconds on CTAF to set runway lighting high/medium/low for 15
  minutes, exactly like the real system. Night arrivals at sleepy strips require
  it.
- **Terrain flattening** under runways/aprons (blend heightfield to runway plane).
- Airport search UI: ICAO/name search over all ~20k fields, spawn on any runway,
  ramp, or 3-mile final.

### 6.4 Scenery beyond airports

Procedural autogen is a Phase 9 goal: simple building boxes in urban land-cover,
trees as instanced impostors in forest cover. Do not attempt roads/buildings from
OSM vector data before Phase 9, and only if performance allows.

### 6.5 Airspace (real, all of it)

- Source: **FAA airspace boundary data** (Class Airspace shapefiles from the FAA's
  open aeronautical data / 28-day NASR subscription — free). Build-time pipeline →
  compact per-region JSON of Class B/C/D/E-surface polygons with floor/ceiling,
  plus Special Use Airspace (Restricted, Prohibited, MOA, Alert) with published
  schedules where available.
- **MFD map rendering with correct chart styling**: Bravo solid blue rings,
  Charlie solid magenta, Delta dashed blue with ceiling boxes, SUA hatched. A
  settings toggle draws airspace in the 3D world as translucent tinted volumes
  (learning aid, off by default).
- **Logic ties**: the sim knows at all times which airspace the aircraft is in.
  Approaching Bravo/Charlie/Delta without the required ATC contact/clearance →
  advisory, then ATC consequences per §12.2. Entering an active Restricted area →
  stern ATC handling. Airspace-aware auto-tuning suggestion ("nearest facility")
  in the ATC window.

### 6.6 Obstacles (real)

- **FAA Digital Obstacle File** (free): every charted tower, antenna, stack, and
  wind turbine in the US, placed at its real location and height. Correct
  obstruction lighting at night (red beacons, strobes on tall towers); wind
  farms stand exactly where they really stand.
- Obstacles are known to TAWS (§15) and drawn on the MFD map with standard
  obstacle symbology.

---

## 7. Graphics quality bar

- **Sky**: physically-based atmospheric scattering (Rayleigh+Mie, e.g.
  Preetham/Hillaire-style), sun position from real date/time/lat/lon, correct
  golden hour, stars + moon at night.
- **Clouds**: METAR-driven layers (FEW/SCT/BKN/OVC at reported bases) rendered as
  volumetric-look raymarched billboards/domes — flying through a layer must white
  out visibility, tops lit correctly. Fog/haze from reported visibility.
- **Lighting**: single directional sun + ambient/sky light, cascaded shadow maps
  (aircraft self-shadow + near terrain), tone mapping (ACES), physically plausible
  exposure day/night.
- **Aircraft exterior**: build the C172 as a clean, accurate 3D model in code or
  Blender-exported glTF authored by you — correct proportions (strut-braced high
  wing, dihedral, tail shape), PBR paint with registration number, spinning prop
  disc with blur texture, control surfaces/flaps animate from sim state,
  strobes/beacon/nav/landing lights work.
- **Precipitation**: rain/snow particle effects + windshield streaks when in
  precip per METAR/radar.
- **Camera modes**: cockpit (default), chase, orbit, tower view, fly-by, and
  **drone/photo mode** — a free-flying smoothed camera with time-freeze, UI hide,
  adjustable FOV, and a screenshot button.
- **Cockpit camera feel**: head physics — a light spring-damper on the virtual
  head position driven by accelerations, so turbulence jostles the view, touchdown
  thumps, G pulls the head down in a steep turn, and the panel vibrates subtly at
  idle RPM. Intensity slider in settings (including off).

---

## 8. Cockpit: C172S G1000, "matches the photos"

The panel layout must match a real C172S G1000 panel: two 10.4" displays (PFD
left, MFD center), audio panel between, standby airspeed/attitude/altimeter
cluster left of PFD, switch row along the bottom left (MASTER ALT/BAT, AVIONICS
BUS 1/2, PITOT HEAT, lights: BCN/LAND/TAXI/NAV/STROBE), ignition key, throttle +
mixture (vernier), flap lever with detents, elevator trim wheel, fuel selector on
the floor console, circuit breaker panel, yoke.

### 8.1 Rendering & interaction

- 3D cockpit; G1000 screens are **canvas-2D textures at ≥2048px** wide redrawn at
  display refresh (20–30 fps is fine for the panels) — crisp text is mandatory.
- Every control is clickable: click switches, drag/scroll knobs and vernier
  controls, drag trim wheel, click-hold for momentary. Hover shows a tooltip with
  the control name. All bindable to keys/gamepad.

### 8.2 G1000 PFD (faithful)

Airspeed tape with real V-speed color arcs and trend vector; attitude with slip/
skid brick; altitude tape + baro setting; VSI; HSI with heading bug, CDI (GPS
magenta / VLOC green), bearing pointers, wind vector box, DME/GS; NAV/COM
frequency boxes with flip-flop (tune via knobs); transponder box; OAT; TAS/GS;
annunciator window (alerts in §8.4/§14/§15); autopilot status bar; inset map.
Softkeys along the bezel bottom must work (PFD/CDI/XPDR/etc. menus).

### 8.3 G1000 MFD

- **EIS strip (always visible)**: RPM gauge with redline, FF, oil temp/press,
  EGT/CHT bar graphs with LEAN assist page (peak-EGT detection must work off the
  real mixture model), fuel qty L/R, fuel calc, volts/amps.
- **Map page**: moving map with terrain shading, airports, navaids, **airspace
  (§6.5)**, **NEXRAD overlay (§11)**, flight plan line, traffic overlay, range
  knob, north-up/track-up, topo/terrain view modes.
- **FPL page**: create/edit flight plan (airport/VOR/fix entry via knob or
  search UI), leg list with DTK/DIS/ETE.
- **PROC**: load approaches/departures/arrivals from CIFP data (§10.3).
- Nearest pages, direct-to, and the **glide range ring** (wind-adjusted best-glide
  footprint drawn on the map — used heavily by training mode §20).

### 8.4 Systems (all simulated, all failable)

- **Electrical**: 28V alternator + 24V battery, main/essential/avionics buses,
  master/alt switches, loads per equipment, alternator failure → battery drain →
  progressive equipment loss (G1000 dies, standby instruments live).
- **Fuel**: two 26.5-gal tanks, L/R/BOTH selector, gravity feed imbalance when on
  one tank, fuel pump, quantity + low-fuel annunciation, engine stops when starved
  (and can be restarted properly).
- **Pitot-static**: pitot heat; pitot ice → airspeed misreads (classic blocked-
  pitot behavior), static blockage → alt/VSI errors.
- **Failures menu**: instructor-style panel to arm/trigger failures (alternator,
  pitot ice, engine roughness/fail, flap motor, individual G1000 screen)
  immediately or randomly per hour.
- Cold & dark start must follow the real POH flow: battery on → fuel pump → mixture
  rich → throttle ¼ → ignition start → alternator, avionics on; hot/flooded starts
  behave differently.

### 8.5 Standby instruments

Analog airspeed, attitude (electric), altimeter with sub-scale knob — drawn as
their own canvas gauges, driven by the same pitot-static model.

### 8.6 Walkaround preflight (polish phase)

First-person exterior walk mode around the parked aircraft with clickable
inspection points following the real POH exterior checklist: sump fuel samples
(visual water-in-fuel check), oil quantity, control surface freedom, pitot cover,
tie-downs/chocks, tire condition, static port. Ties into the failure system: a
seeded discoverable issue (low oil, water in fuel) that a skipped or careless
walkaround leaves in place to bite later in the flight. Entirely skippable from
the menu for players who want to just fly.

---

## 9. Autopilot (GFC 700 style)

Lateral: ROL, HDG, NAV (GPS/VLOC capture + track), APR (LOC + GS capture), BC.
Vertical: PIT, ALT hold, ALTS armed capture, VS, FLC. Flight director V-bars on
PFD, mode annunciations with armed→active transitions (white→green), AP disconnect
(red button, aural tone), servo authority/rate limits so captures look real (no
teleporting to the localizer), auto-trim. Control laws are proper cascaded PID
with gain scheduling by IAS — tune until an ILS coupled in a 15 kt crosswind stays
inside half-scale.

---

## 10. Navigation

### 10.1 Radio navigation

VOR stations from navaid data (real frequencies, ranges, service volumes), CDI
with OBS/TO-FROM, ILS localizer + glideslope with realistic beam geometry, DME,
marker beacons (lights + tones). Signal degrades with range/terrain line-of-sight
(simple check). Every VOR/ILS broadcasts its **Morse-code ident** on the nav
audio — selecting NAV on the audio panel plays it, and verifying the ident is
part of the real workflow (training mode §20 requires it before an approach).

### 10.2 GPS

Flight-plan legs, great-circle tracking, turn anticipation, direct-to, CDI scaling
(ENR/TERM/APR: 2.0/1.0/0.3 nm).

### 10.3 Procedures

Parse **FAA CIFP** (free 28-day download, build-time pipeline → JSON): SIDs,
STARs, and approaches for US airports. Support the common leg types (IF/TF/CF/DF,
FA/CA, holds as HM/HA/HF simplified). Selecting a procedure in PROC inserts its
legs. LPV-style advisory vertical guidance for RNAV approaches.

### 10.4 Transponder + audio panel

Squawk codes, IDENT, modes; audio panel selects COM1/COM2 monitor/transmit —
matters because ATC talks on real frequencies.

---

## 11. Weather

- **Live mode (default)**: fetch METARs (aviationweather.gov API) for stations
  around the route via the proxy; interpolate between stations. Wind/gust, vis,
  cloud layers, temp/dewpoint, altimeter — all applied to both physics and
  rendering. Winds aloft from the aviationweather winds API, interpolated by
  altitude. Refresh every ~10 min.
- **Live NEXRAD radar**: composite reflectivity tiles from the Iowa Environmental
  Mesonet public tile service via the proxy. Rendered (a) on the MFD map page,
  presented the way the real airplane gets it — as **FIS-B datalink weather**,
  with the real system's 5–10 minute latency and a prominent age stamp (the
  cockpit picture lags the actual weather; that gap is the same trap real pilots
  must respect), and (b) in the world: precipitation cells are spawned where the
  *current* radar shows returns, with intensity scaling rain/visibility, so
  flying toward the red blob means flying into a real wall of rain. Cell
  placement refreshes with the radar (~5 min cadence).
- **Lightning and thunder**: strong radar cells generate visible lightning
  (bolt flashes + cloud illumination at night) with thunder delayed correctly by
  distance.
- **Manual mode**: full weather editor (wind layers, clouds, vis, temp, QNH,
  turbulence, precip).
- Density altitude consequences must be real: a 100 °F Denver day should visibly
  gut climb performance.
- Pressure changes en route require resetting the altimeter or ATC will (correctly)
  see you off altitude.

---

## 12. ATC (with voice)

### 12.1 Structure

Model the real US system as interacting state machines per facility:

- **ATIS** (auto-generated from live METAR + active runway logic, phonetic
  letter), **Clearance Delivery**, **Ground**, **Tower**, **Departure/Approach
  (TRACON)**, **Center (ARTCC)** — approximate ARTCC/TRACON ownership by
  region/distance/altitude; frequencies from OurAirports data (fall back to
  plausible ones when missing).
- **Untowered fields**: CTAF self-announce menu ("Cessna 123AB, left downwind
  runway 27, Half Moon Bay") and AI traffic announces too.

### 12.2 Flows (all must work end-to-end)

- **VFR at towered field**: ATIS → Ground (taxi with runway/route readback) →
  Tower (hold short / line up and wait / cleared for takeoff, wake-turbulence
  cautions) → optional flight following with radar contact, traffic advisories,
  handoffs → pattern entry instructions and landing clearance on return, sequenced
  behind AI traffic ("number 2 following the Skyhawk on left base").
- **IFR**: file a plan (route editor), receive CRAFT clearance with readback,
  released → SID or vectors → Center handoffs by sector → STAR/vectors to
  approach → approach clearance ("maintain 3000 until established, cleared ILS
  28R") → tower → missed-approach handling with published missed or vectors.
- ATC reacts to deviations: altitude busts, wrong headings, **entering Bravo/
  Charlie/Delta or active Restricted airspace without clearance (per real §6.5
  boundaries)** → escalating (correct) phraseology, possible "possible pilot
  deviation, advise ready to copy a phone number" for egregious busts.

### 12.3 Interaction + voice

- Pilot side: context-sensitive menu of correct phraseology options (numbered,
  keyboard-selectable) + free readback shortcut; wrong/missing readbacks get
  "readback correct/say again."
- Voices: `speechSynthesis` with a distinct voice per controller and per AI
  aircraft, run through a WebAudio **radio effect** (300–3000 Hz bandpass, light
  distortion, noise floor, squelch clicks). Text transcript window with history.
- Frequencies are real: you must tune the radio to hear/talk to a facility;
  wrong frequency = silence.

---

## 13. AI traffic

- **Scheduled airline traffic** at the ~40 busiest US airports: generated but
  plausible schedules (real airline callsigns — "United 415", correct fleet mix
  by hub), plus **GA traffic** at smaller fields proportional to airport size.
- Full lifecycle: spawn at gate → taxi (simple taxi graph: apron→runway) →
  takeoff → climb → cruise on airways/direct → descent → approach → land → taxi
  in → despawn. Point-mass performance models per class (piston / turboprop /
  regional jet / narrowbody / widebody) with honest speeds/climb rates.
- Traffic talks on the correct frequencies (voice + transcript) and is sequenced
  by the same ATC that handles the player — you hear and see the flow you're
  slotted into.
- 3D models: a small set of clean generic types (GA high-wing, GA low-wing,
  turboprop, narrowbody, widebody) with airline-color liveries; lights, gear,
  flap animation.
- Density slider (off / light / real). Target: 30+ airborne AI within 40 nm of a
  hub at "real" without breaking the frame budget (AI on a worker, 1–5 Hz update,
  interpolated).
- **Live mode (optional toggle)**: map real ADS-B positions from the OpenSky API
  to traffic (display-only, no ATC interaction). Feature-flagged; simulated mode
  is the default and must be complete on its own.

---

## 14. TCAS

Implement a real **TCAS II v7.1-style logic module** in /sim (pure, unit-tested
against scripted encounter scenarios):

- Range/closure tracking of transponder-equipped traffic; **tau**-based alerting
  with sensitivity levels by altitude — use the published table (SL3 at
  1000–2350 AGL: TA 25 s / RA 15 s … SL7 at 20,000+: TA 48 s / RA 35 s) plus DMOD
  distance floors and altitude thresholds (ZTHR), ALIM.
- **TA**: "TRAFFIC, TRAFFIC" aural, yellow circle on traffic display.
- **RA**: vertical resolution advisories (CLIMB/DESCEND/ADJUST VS/MAINTAIN),
  strengthening and reversal logic, red square symbol, green/red VS "fly-to" cue
  on the PFD VSI, "CLEAR OF CONFLICT" on resolution. RAs are coordinated against
  AI traffic (AI complies with its half).
- On the **C172** this surfaces honestly as a G1000-style **Traffic Advisory
  System** (TAS): TA-only by default (that's what the real airplane has), with an
  optional "enable RA" setting clearly labeled as non-stock. Full RA presentation
  is stock on the Phase-10 737.
- Traffic display: on MFD map + dedicated traffic page (diamonds: hollow white =
  other, solid white = proximate, yellow circle = TA, red square = RA, relative
  altitude tags and climb/descend arrows).

Unit tests: scripted geometries (head-on co-altitude, converging climb, overtaking)
must alert at the correct tau within ±1 s and pick the correct RA sense.

---

## 15. GPWS / TAWS

Pure, unit-tested module using the streamed terrain heightfield (radio altitude =
AGL over terrain query) + aircraft state:

- **Mode 1** excessive descent rate: "SINK RATE" → "PULL UP".
- **Mode 2** excessive terrain closure: "TERRAIN, TERRAIN" → "PULL UP".
- **Mode 3** altitude loss after takeoff: "DON'T SINK".
- **Mode 4** unsafe clearance not in landing config: "TOO LOW — TERRAIN /
  GEAR / FLAPS" (gear callout applies to the 737 phase).
- **Mode 5** below ILS glideslope: "GLIDESLOPE" (soft/hard).
- **Mode 6** callouts: "FIVE HUNDRED", "ONE HUNDRED", "FIFTY, FORTY, THIRTY,
  TWENTY, TEN" (737), "MINIMUMS" (from set DA/MDA), "BANK ANGLE" (>35°→45°
  escalation).
- **RAAS-style runway advisories** (ground safety net, uses the airport
  database): "ON RUNWAY TWO EIGHT LEFT" when lining up, "APPROACHING RUNWAY TWO
  EIGHT LEFT" while taxiing toward an active runway, caution for attempting
  takeoff on a taxiway or a runway too short for the configuration.
- **Forward-looking TAWS (EGPWS-style)**: look-ahead ribbon along predicted 3D
  path over the terrain grid → caution ("TERRAIN AHEAD" / yellow) at ~60 s,
  warning ("TERRAIN AHEAD, PULL UP" / red) at ~30 s; terrain display page on the
  MFD with the standard green/yellow/red relative-altitude shading. Inhibit logic
  near airports (on approach to a runway ahead) so normal landings don't alarm.
- On the C172 this presents as **TAWS-B** (what a real G1000 172 has); the 737
  gets classic GPWS + EGPWS with all modes.

Unit tests: scripted CFIT scenarios (level flight at ridge, dive at flat ground,
gear-up approach for the 737) trigger the right modes in the right order at the
right times; a normal ILS approach triggers nothing.

---

## 16. Sound

- **Engine**: WebAudio-synthesized (oscillator bank + noise shaped by RPM/power —
  four-cylinder beat character), doppler + distance for external/AI aircraft,
  distinct interior/exterior mix.
- Wind/slipstream noise scaling with IAS; flap motor; trim; gear rumble by
  surface; touchdown squeak scaled by sink rate; stall horn (continuous vane tone
  starting ~5–10 kt above stall); annunciator chimes; AP disconnect tone; all
  TCAS/GPWS aurals (§14/§15) via speech synthesis or generated samples with
  the correct urgent cadence; ATC radio (§12.3); rain on airframe.
- Master/radio/engine/environment volume mixers in settings.

---

## 17. UI / UX

- **Main menu**: world map of the US with airport search; choose parking/runway/
  final; time of day (real/custom); weather (live/manual); aircraft loading (W&B
  sliders with envelope plot); traffic density; entry points for **Training
  (§20)**, **Challenges & Trips (§21)**, and the **Logbook (§19)**; and a
  **"Get briefing" button** that generates a real standard-format preflight
  weather briefing from the live data (adverse conditions, synopsis, current
  weather, forecasts, winds aloft, TFR-style advisories) for the planned route.
- **In-sim**: clean minimal overlay (toggleable): sim rate, camera hints, ATC
  window, checklist panel (real C172S checklists: preflight → shutdown),
  failures panel, map pop-out.
- **Settings**: graphics presets (terrain radius/LOD bias, clouds, shadows,
  resolution scale), audio mixers, control bindings UI (keyboard/mouse/gamepad
  remap with live capture), units, camera-feel intensity, assists (auto-rudder,
  simplified engine management — both default OFF).
- **Save/load**: full sim state snapshot (position, systems, fuel, weather,
  flight plan, time) to IndexedDB + export/import JSON.
- Pause menu, restart-at-final for practicing approaches, quick "reposition on
  final" tool.

---

## 18. Flight recorder, replay, and debrief

- **Recorder**: every flight is recorded automatically — full state at 10 Hz
  (position, attitude, rates, speeds, config, engine, control inputs) plus a
  tagged event stream (takeoff, touchdowns with parameters, stall horn, alerts,
  ATC exchanges, airspace entries, failures). Ring-buffered in memory, persisted
  to IndexedDB at flight end. Recording is /sim-pure and unit-tested.
- **Replay**: after (or during, from pause) any flight: timeline scrub, play at
  0.25x–8x, all camera modes available, cockpit instruments replay their recorded
  state truthfully.
- **Debrief screen** at flight end:
  - Map of the flight track colored by altitude or groundspeed, with event pins.
  - Graphs: altitude, IAS, vertical speed, and G vs time (synced cursor with map).
  - **Landing card** for each touchdown: sink rate (fpm), centerline offset (ft),
    touchdown point distance from threshold (ft), airspeed over the fence,
    crab angle at touchdown, G spike, bounce count.
  - Landing grade from those numbers (e.g., smooth < 150 fpm; firm > 400 fpm;
    **hard > 600 fpm flags an airframe inspection squawk in the logbook §19**).
- **Export**: GPX/KML of the track, JSON of the full recording.

---

## 19. Pilot logbook and persistence

- **Logbook**: every flight auto-appends a real-format entry — date, aircraft,
  route (departure/arrival ICAO), total time, night time (sun position), simulated
  instrument time (inside cloud), day/night landings, and remarks (auto-noted:
  approaches flown, training lessons passed, challenge scores). Totals page with
  hours by category; filter/search; export CSV/JSON. Stored in IndexedDB.
- **Persistent airframe**: the aircraft remembers state between sessions — fuel on
  board, oil level, Hobbs and tach time, and **open squawks** (e.g., inspection
  flag from a hard landing, abuse-induced issues). A maintenance page clears
  squawks and refills oil/fuel ("call the FBO"). A settings toggle ("always
  pristine") disables persistence for players who don't want it.
- Multiple named pilot profiles, each with its own logbook, settings, and
  training progress.

---

## 20. Training mode (graded against real FAA standards)

- **Structured lessons**, each with: a one-screen ground brief (what/why/how),
  an optional flown demonstration (autopilot-flown with narration), the student
  attempt with live coaching callouts, and a scored debrief. Lesson state machine
  and scoring live in /sim and are unit-tested with scripted flight recordings.
- **Curriculum** (C172S): controls & straight-and-level → climbs/descents/turns →
  taxi, normal takeoff & landing → slow flight → power-off and power-on stalls →
  steep turns → ground reference maneuvers (turns around a point, S-turns — wind
  matters) → pattern work → crosswind takeoff/landing → short-field and soft-field
  takeoff/landing → navigation (pilotage + VOR + GPS) → basic instrument flying
  (headings/altitudes in simulated IMC) → ILS and RNAV approaches → emergencies.
- **Grading uses real FAA Airman Certification Standards tolerances**, e.g. steep
  turns: bank 45°±5°, altitude ±100 ft, airspeed ±10 kt, roll-out heading ±10°;
  short-field landing: touchdown within +200/−0 ft of the point; approach: CDI
  within half-scale. Score card shows each parameter vs tolerance over time.
- **Coaching callouts** (rule-based text + voice): "airspeed — pitch down",
  "add right rudder", "you're low, add power", "begin roll-out now". Optional
  strictness levels.
- **Emergency practice mode**: random or chosen failures (engine failure at a
  random moment, alternator, pitot ice) with the glide-range ring (§8.3) live;
  graded on checklist flow, best-glide hold, and field selection/outcome.
- Lesson completion and scores persist to the pilot profile (§19).

---

## 21. Activities: landing challenges, bush trips, tours

- **Landing challenges**: curated scored scenarios at famously demanding US
  strips — e.g. Catalina (KAVX, cliff-edge mesa), Aspen (KASE, box canyon),
  Sedona (KSEZ, mesa top), Lake Tahoe (KTVL, density altitude), Eagle (KEGE),
  First Flight (KFFA), plus a rotating "strong gusting crosswind at your home
  field" generator. Score from the §18 landing card (sink rate, centerline,
  touchdown point) + approach stability. Local high-score table per challenge.
- **Bush trips**: multi-leg VFR adventures with a hand-written briefing per leg,
  e.g. Idaho backcountry (Johnson Creek and friends), Utah canyon country, the
  Appalachians, San Juan Islands... wait — Washington state is CONUS: include it.
  Legs are flown with pilotage (optional "no GPS" honor mode that hides the
  moving-map own-ship), fuel planning matters, progress saves between sessions,
  completion logged in the logbook.
- **Discovery tours**: relaxed guided flights over landmarks (Grand Canyon,
  Manhattan skyline, Golden Gate, Yellowstone, Niagara) with POI captions;
  spawn-in-cruise so a non-pilot can enjoy them immediately.
- All activities are data-driven (JSON scenario files: spawn, weather override or
  live, goals, scoring rubric) so adding one never requires engine changes.

---

## 22. Input

- Keyboard (sensible defaults: arrows/WASD flight controls with smooth centering,
  F for flaps, throttle +/-, rudder Z/X), mouse-yoke mode, **Gamepad API** (axes
  mapped with deadzone/curve editor — a yoke and an Xbox pad must both just
  work), trim on hat/keys.
- Control surface response includes cable-slack realism at zero airspeed
  (nice-to-have).

---

## 23. Performance budget (binding)

- Target **60 fps sustained** on an Apple-Silicon Mac at 1440p default preset;
  never below 30 fps in worst case (hub airport, real traffic, weather).
- Main thread physics + game logic ≤ 4 ms/frame; draw calls ≤ 600 via instancing
  (trees, lights, AI aircraft), material sharing, tile mesh merging.
- Tile decode/mesh in workers only; LRU caches: ~400 MB GPU, ~1k tiles memory,
  IndexedDB disk cache with cycle-aware invalidation.
- No GC hitches: preallocate hot-path vectors/quaternions; zero per-frame heap
  allocation in the physics loop.

---

## 24. Build order (phases with acceptance criteria)

Work strictly in order. Each phase ends with: tests green, `npm run validate`
green (from P1 on), browser-verified with screenshots, `PROGRESS.md` updated,
commit.

- **Phase 0 — Skeleton.** Vite+TS+Three+Vitest+server scaffold, fixed-timestep
  loop, camera rig, input layer, flat ocean world, sky sun cycle, FPS/debug HUD.
  ✅ 60 fps empty world; loop timing test passes.
- **Phase 1 — Flight model.** §5 complete for the C172S with placeholder external
  model over flat terrain; trim solver; headless validation harness.
  ✅ Every row of the §5.6 table passes; hand-flown stall/slip/crosswind behaviors
  verified and noted in PROGRESS.md.
- **Phase 2 — The US.** Terrain streaming + floating origin + all airports with
  runways/lights/windsocks + ground physics on real runways + airport search
  spawn. ✅ Spawn at KHAF, fly to KSFO at dusk, land: no seams/pops/precision
  jitter; AGL query correct over the coast range; 60 fps.
- **Phase 3 — Cockpit & systems.** Full 3D cockpit, G1000 PFD/MFD + EIS,
  standby gauges, electrical/fuel/pitot-static, failures, cold & dark, checklists.
  ✅ Cold-and-dark to run-up via the real checklist with every switch physical;
  alternator-failure drill behaves per POH; lean-assist finds peak EGT.
- **Phase 4 — Nav, autopilot & airspace.** VOR/ILS/DME/GPS, flight plans, CIFP
  procedures, GFC700, **airspace data + MFD rendering + in-airspace detection
  (§6.5)**, glide range ring. ✅ Coupled ILS 28R KSFO from a PROC-loaded approach
  in a 15 kt crosswind stays within half-scale to 200 AGL; the SF Bravo shelf
  structure renders correctly on the MFD and the sim knows when you're inside it.
- **Phase 5 — Weather & sky.** Live METAR/winds-aloft, **NEXRAD overlay + radar-
  driven precip cells**, cloud layers, visibility, turbulence, density-altitude
  effects, seasons. ✅ Sim weather at KDEN matches the actual current METAR;
  flying into a BKN layer whites out; the MFD radar blob matches where the rain
  is in the world; hot-high takeoff measurably longer.
- **Phase 6 — ATC & traffic.** §12 + §13 complete, including airspace-bust
  handling. ✅ Full VFR flight KPAO→KSQL with correct phraseology end-to-end;
  IFR clearance + handoffs KSFO→KLAX; AI flow visibly landing/departing in
  sequence at KLAX with you slotted in; clipping the Bravo without clearance
  gets you the phone-number treatment.
- **Phase 7 — TCAS & TAWS.** §14 + §15 complete. ✅ All scripted encounter and
  CFIT unit tests pass; in-sim: converging AI triggers TA with correct aural and
  display; ridge flight at Tahoe triggers escalating TAWS; normal ILS is silent.
- **Phase 8 — Recorder, logbook, training, activities.** §18–§21 complete.
  ✅ Fly a pattern: debrief shows an accurate landing card and graphs; the flight
  appears in the logbook with correct times; a >600 fpm landing creates a squawk;
  steep-turn lesson grades correctly against a scripted good run and a scripted
  bad run (unit-tested); Catalina challenge produces a score; first bush-trip leg
  saves progress.
- **Phase 9 — Polish.** Sound design complete, walkaround preflight, camera feel,
  photo/drone mode, autogen scenery if budget allows, settings/save-load/bindings
  UI, performance pass, bug burn-down. ✅ Budget in §23 holds at KLAX real-traffic
  storm dusk; a full 45-min flight with zero console errors.
- **Phase 10 — Stretch aircraft.**
  - **Boeing 737-800**: CFM56 twin-jet performance model (N1-based thrust, fuel
    flow, swept-wing aero with Mach effects, spoilers, slats/flaps schedule,
    retractable gear), overhead-lite systems, MCP autopilot (HDG/ALT/VS/LVL
    CHG/LNAV/VNAV-lite, autothrottle), CDU/FMC-lite (route + perf), full TCAS II
    RA presentation, full GPWS, cockpit matching the real 737 layout.
    ✅ Gate-to-gate KSFO→KLAX IFR with ATC; hand-flown ILS; Vref/climb/cruise
    M0.78 numbers within honest tolerances.
  - **Piper J-3 Cub-style taildragger**: tailwheel ground physics (ground-loop
    risk is real), stick + heel brakes, no electrical system (hand-prop start!),
    carburetor with **carb heat and a carb-ice model**, 65 hp performance, flown
    from the back seat, side window open. The stick-and-rudder trainer.
    ✅ Wheel landings and three-pointers both work; a fast touchdown with feet
    asleep ground-loops; carb ice at low power on a humid day is survivable with
    carb heat.

---

## 25. What NOT to do

- No multiplayer, no VR, no helicopters, no floatplanes, no scenery outside the
  US (design doesn't preclude them; just don't build them now).
- No copying code, art, sounds, or data from MSFS/X-Plane or other sims. All data
  from the public-domain sources below; all art/audio original/procedural.
- No physics library shortcuts for the flight model; no LLM-guessed "magic
  numbers" without a comment citing the source (POH, Roskam, published derivative
  tables, FAA ACS).
- Don't gold-plate early phases with graphics polish that Phase 9 owns.
- Nothing from the §28 roadmap gets built before the §27 definition of done is
  met.

## 26. Data sources (all free)

| Data | Source |
|---|---|
| Elevation | Terrain Tiles on AWS (terrarium PNGs), s3.amazonaws.com/elevation-tiles-prod |
| Airports/runways/frequencies/navaids | OurAirports CSVs (public domain), davidmegginson.github.io/ourairports-data |
| Airspace boundaries (B/C/D, SUA) | FAA open aeronautical data (28-day NASR / class airspace shapefiles) |
| Procedures (SID/STAR/approach) | FAA CIFP, free 28-day cycle download |
| Weather | aviationweather.gov data API (METAR/TAF/winds) |
| Weather radar | Iowa Environmental Mesonet NEXRAD composite tile service |
| Obstacles (towers, wind turbines) | FAA Digital Obstacle File (free) |
| Land cover | NLCD (MRLC), downsampled at build time |
| Imagery (optional) | USGS National Map / NAIP services (public domain) |
| Live traffic (optional) | OpenSky Network API |
| Magnetic variation | NOAA WMM coefficients |

## 27. Definition of done (global)

A stranger with a Mac can `npm install && npm run dev`, pick any US airport, and
fly a C172S whose numbers match the POH, under today's actual weather with
today's actual radar, inside real airspace, talking to ATC among AI traffic, with
traffic and terrain alerting that fire exactly when they should — at 60 fps, with
every instrument telling the truth. When they land, the sim tells them honestly
how good the landing was, writes it in their logbook, and the airplane remembers.

---

## 28. Appendix: Future Roadmap (explicitly OUT of scope until §27 is met)

Held for after the core ships. Do not build these now; do not architecturally
preclude them either.

- **Sky/weather**: real star map with planets and moon phase, aurora, wildfire
  smoke (NOAA data), morning valley fog cycles, contrails, sun halos and
  glories, heat shimmer, historical-weather mode (archived METARs).
- **Hazards/physics**: airframe icing, windshear/microbursts + GPWS Mode 7,
  wake turbulence, overstress/damage model, mountain waves and rotors, full
  spin model, carbon monoxide leak + CO detector, door-pop-on-takeoff event,
  cold-weather starts/preheat, brake heat and tire blowouts, birds and runway
  wildlife.
- **Avionics**: G1000 synthetic vision (SVT), EFB tablet with real FAA
  sectionals/approach plates/airport diagrams, pop-out panel windows for
  multi-monitor, partial-panel and hood training modes, DME arcs and computed
  hold entries, Victor airways in flight plans, GPS-outage simulation, POH
  takeoff/landing performance calculator.
- **World/ops**: hand-modeled landmarks, ground services (pushback, fuel truck,
  marshaller, jetways), moving highway/rail/boat traffic, Hudson River corridor
  + LA SFRA + DC SFRA special rules, mid-session runway changes with ATIS
  updates, ATC weather diversions around live cells, PIREPs, skydiving ops,
  Oshkosh mass-arrival event, live TFRs/NOTAMs, emergency handling with ATC
  (mayday, priority, vectors), voice-recognition ATC input, opt-in LLM-driven
  freeform ATC.
- **Meta/QoL**: home-cockpit WebSocket state API, phone-as-second-screen EFB,
  offline region downloads, replay video export, all-48-states landing map,
  achievements, random flight generator, shareable situation files,
  fly-a-real-flight-number mode, headset on/off audio mix, HRTF 3D audio,
  copilot challenge-response callouts, virtual DPE checkride, career/economy
  mode, webcam head tracking, WebXR VR, gamepad haptics.
- **Aircraft**: Cirrus SR22 (with CAPS parachute), Extra 300 (aerobatics +
  scored box), King Air 350, DC-3, glider + aerotow with thermal soaring.
