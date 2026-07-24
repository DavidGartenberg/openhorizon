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
| 6 — ATC & AI traffic | ✅ done | live-freq tower/ground/ATIS, voices, AI pattern traffic, IFR CRAFT+handoffs; deviations recorded |
| 7 — TCAS & TAWS | ✅ done | tau/GPWS cores + scripted tests; live Tahoe escalation + KPAO TA; two spawn bugs found+fixed |
| 8 — Recorder/logbook/training | ✅ done | 10 Hz recorder, honest landing debrief, ACS grader, persistent logbook, landing challenges |
| 9 — Sound/polish/perf | ✅ done | sound core, save/load, perf gate, §27 flight flown at KSFO |
| 10 — Fleet (absorbed) | ✅ → Phase 11 | absorbed by the approved Phases 11–15 mega-plan |
| 11 — Fleet core | ✅ done | 3 Tier-A aircraft (C172S/J-3/737-800) validated + fleet UX; browser acceptance flown |
| 12 — Every plane (data) | ✅ done | 2,700-designator registry, archetype meshes, 120-type flyable roster (421 validation rows) |
| 13 — Graphics | 🔧 13a–13e done | shadows, airport detail, imagery, night, PAPI (+GS fix), METAR sea state + cloud light; 13f bloom = evaluate |

## Phase 9a — sound core (2026-07-20)

`src/audio/engine-sound.ts`: sample-free WebAudio synth — 4-cyl firing
fundamental (RPM/60×2: verified 25.6 Hz at 767 rpm idle, 79.4 Hz at 2382
rpm full throttle), gain/lowpass tracking shaft power, IAS² slipstream,
ground-roll rumble, touchdown thump one-shot, stall horn keyed to the aero
model's stallFraction (trips at AoA 13.7° ≈ 2.8° before the stall peak —
the vane's 5-8 kt margin — verified by a rate-limited decel in-browser;
silences on recovery). Gesture unlock + M mute (toggle verified; CDP `key`
events don't reach the page in this harness — synthetic KeyboardEvent used,
input path is the same). **Bug found in-browser:** first horn gate used raw
`stallFraction`, which is max(positive, *negative*) stall — a hard push at
70 kt fired the horn from the negative branch; real vane is positive-AoA
only → added `alphaDeg > 0` gate. Honest limit: automation verifies the
node graph (`__ohAudio`), not audibility — the ear check is the user's.

## Phase 9b — save/load + payload (2026-07-21)

O saves, P loads (`oh-save` in localStorage; `__ohSave/__ohLoad` hooks;
6 s HUD toast). Verified across a full page reload: airborne save at 955
ft/hdg 313/64.6 KIAS/payload 158.76 kg restored to 956 ft/312/64.7 kt
airborne on trim with payload bit-exact, fuel continuing from the saved
quantity, and the sim clock resumed (18:10:35Z on the HUD). Ground save
restores to the saved runway spawn point. `weight <lb>` search command
sets payload with honest gross/max-ramp warning. **Documented deviation
(§17):** a snapshot restores a *trimmed* state (position/alt/hdg/speed/
config/fuel/clock), not mid-maneuver 6-DOF rates; ground saves restore
the runway spawn, not the exact ramp spot. W&B envelope plot deferred —
payload entry + gross readout only.

## Phase 13a′ — airport surface detail (2026-07-22, user-requested)

FAA-geometry runway markings from the real runway dimensions: threshold
stripes by width class (4/6/8/12), painted runway numbers (canvas
textures, reading toward the arriving pilot), aiming point at 1,000 ft
(runways ≥4,200 ft), touchdown-zone bars at 500-ft stations (≥6,000 ft)
— all merged into ONE white geometry per runway. Distance-remaining
boards every 1,000 ft (both faces numbered for their own direction).
Procedural parallel taxiway + three connectors with yellow centerlines,
holding-position signs (white-on-red "LO-HI") and location signs
(yellow-on-black) at each connector; apron + terminal/concourse/jet
bridges/control tower at jet fields (≥7,000 ft), hangars + FBO at GA
fields. **Recorded deviation:** taxiway/terminal layouts are PLAUSIBLE
PROCEDURAL (OurAirports has no taxiway/building data); markings and
distance boards follow real FAA geometry rules. Browser-verified at
KHAF/KSFO (threshold stripes, yellow taxi line, red holding sign,
buildings, shadows); perf at KSFO: p50 5.8 ms, 140 calls, 31 textures
(sign/number canvases, cached by text). Suite 833 green.

## Phase 13e — clouds + ocean sea state (2026-07-24)

**Ocean** now takes the METAR surface wind (new `WindModel.steadyMs`/
`steadyTowardRad` getters): pure `sim/weather/sea-state.ts` (4 tests)
maps wind → slope scale (glassy ≤4 kt … saturating 1.7) and whitecap
fraction (0 below 15 kt, 1 by ~25 kt); the wave field rotates so the
primary set runs downwind; sparse foam flecks (hash cells advecting
downwind, gated to wave crests, killed by att² before they smear
sub-pixel) mix in above 15 kt. The 9 m chop gets its own faster
distance rolloff on top of 13b's global fade — the shimmer band from
altitude is gone. **Clouds**: forward-scatter term from the real sun
direction — silver-lining rim on backlit puffs; thick layers darken
their bases (thickness × coverage: today's real OVC013×3,000 ft deck
reads convincingly heavy from below); dusk factor (sun within ±8° of
the horizon) warms the decks, strongest sunward. New `__ohSlabs`
manual-cloud hook (same manual-weather pattern as `__ohWind`).

**Verified in-browser** (KHAF 12 final over the Pacific): calm 3 kt =
glassy fresnel sheet; 25 kt = textured sea with sparse whitecap
flecks; real OVC013 base-darkening from 1,000 ft; manual SCT dusk =
orange-rimmed backlit puffs on the horizon. Two tuning iterations
recorded honestly: 6 m foam cells smeared into a milky wash at range
(fixed by 12 m cells + att² + crest gating), and a stale-HMR page
fooled two verification rounds (hard navigate now precedes shader
screenshots). **Perf:** 13e adds zero draw calls (shader-local by
design); absolute frame times were unstable across this session's
measurements (5.8→12→30 ms p50 on identical scenes — backgrounded-
pane GPU throttling suspected, tracks pane visibility not code); §23
p95 stayed <16.7 ms in every stable window, and the binding full
re-measure remains 15e. Suite 862 + validate 421, tsc clean.

## Phase 13d — PAPI + the glideslope fix it exposed (2026-07-24)

Pure `src/world/papi.ts`: standard 4-box angles 2.5/2.83/3.17/3.5°,
white-above / red-below per unit — 6 exact-transition tests (on-slope
2W2R, boundaries flip precisely at each unit angle). Render: one 4-box
Points array per lighted paved runway end ≥4,000 ft (placement
heuristic — no lighting-inventory field in the free data; recorded),
300 m in from the threshold on the approach's left, innermost box
steepest (white pair outboard on slope, AIM 2-1-2); colors recomputed
each frame from the CAMERA's elevation angle (dark outside a ±35°
approach-azimuth window — real boxes are baffled). `__ohPapi()` reads
the nearest array from the AIRCRAFT position — navigation truth,
independent of camera optics.

**The acceptance test caught a real nav bug.** Flying the coupled KSFO
28R ILS, the needle centered while the PAPI insisted 1W (2.78°): the
sim's glideslope beam was anchored AT the threshold at field elevation
— 0 ft TCH — reading ~0.2° below a correctly-sited PAPI (predicted
2.78° from that geometry; measured 2.778°). Fixed in
`ilsRefFromRunwayThreshold`: GS antenna now sits 300 m down the runway
→ the 3° beam crosses the threshold at ~52 ft (standard 50-55 band)
and meets the PAPI's aiming point — the two systems agree by
construction, as in the real world. Unit-tested (setback distance,
TCH, an explicit PAPI-agreement row); AP/GS-descent suites unaffected
(they fly the beam wherever it sits).

**Verified in-browser:** coupled approach 5.1→3.5 km — five paired
samples with the needle inside ±0.16 and `__ohPapi` whites=2 at
2.885–3.079° the whole way; low-side pairings twice (needle −0.71/−1.0
fly-up ↔ 0W at 2.498°/below); ground still frame at the 28R threshold
shows the red array at the correct left-side station (0.23° → 4R).
Chase-cam screenshots can't show the pilot's exact 2W2R honestly (the
lens rides ~10 m above the eye → reads high) — the aircraft-position
hook is the acceptance instrument; cockpit-cam framing was too cramped
in this session's small pane (revisit in 15d). Perf: p50 5.8 ms / 294
calls at KSFO (+29 for the arrays, §23 green). Suite 858 + validate
421, tsc clean.

## Phase 13c — night lighting (2026-07-24)

Pure `src/sim/lights.ts` drives every flash: rotating red beacon 45 cpm
(35% duty), double-flash strobes (~86 ppm), civil airport beacon
white/green ~26/min (AIM 2-1-9) — 6 exact-transition tests. **City
glow:** the terrain worker emits an NLCD developed-class `urban`
attribute (dev-open 0.35 → dev-high 1.0) and the terrain shader adds a
warm procedural speckle at night — sparse 12 m hash cells (~7% lit)
faded in 150–700 m so altitude reads a point-field while the near
ground stays dark. **Airports:** lighted runways grow a night Points
layer (constant-pixel additive sprites — perspective attenuation sank
real-light points below a pixel at range): MIRL edge glow, green
threshold / red end rows, floodlit windsock, midfield mast beacon
flashing on the AIM cadence. **Aircraft:** nav (red/green/white),
beacon, strobes as glow points at archetype anchors (bbox fallback for
Tier-A), L-key landing light with a projected ground-spot ellipse
(+0.3 m lift so the sloped runway strip can't swallow it). All lights
need the electrical bus — the no-electrical J-3 Cub flies dark and L
answers "NO ELECTRICAL SYSTEM — NO LIGHTS" (toast verified).

**Critical bug caught in-browser (lesson recorded):** the first 13c
frag shader used `vUrban`/`vWXZ` without declaring the varyings — the
terrain program failed to compile from the WIP commit onward, so NO
terrain rendered, and the night scenes masked it (runways/lights/ocean
carried the frames). Found by painting vUrban and reading the GLSL
compile log; day-render check is now part of shader-edit acceptance.
Mid-slice a user takeoff report also surfaced the C172-era crash-guard
bound (75 m/s ground speed) freezing 737 takeoffs — fixed + TDD in
commit b91aad0.

**Verified in-browser (night):** KSFO 28R 3-nm final — both runway
outlines in edge lights, thresholds, taxiway strings, stars, ship
nav/beacon lights; ground rollout with the landing light painting the
threshold stripes; GFC700-coupled ILS 28R descent flown to short final
under lights. KSJC Cub night: dark ship over the city speckle; KSJC
day: imagery intact post-fix. **Perf gate (same scene, valid shader):**
day p50 4.9 ms/265 calls → night 6.5 ms/265 calls — +1.6 ms, zero
added draw calls, p95 ≤ 13.9 (§23 green). Suite 850 + validate 421,
tsc clean. **Deviations:** city glow is procedural cells, not real
light points (no VIIRS); threshold/end lights approximate
bidirectional lenses as two colocated rows; beacon mast sits by the
windsock (real beacon sites absent from free data); the white/green
beacon flip is cadence-unit-tested + shares the proven sprite path but
a per-pixel color screenshot wasn't captured (small pane — 15d sweep
item); strobes/nav tie to bus power (no separate switches until 15c);
painted markings are unlit materials, faintly visible at night (15c);
AI traffic stays unlit until 14d.

## Phase 13b — satellite imagery terrain (2026-07-23)

USGS National Map `USGSImageryOnly` tiles (public domain) on the near
terrain rings. Server: `/proxy/imagery/{z}/{x}/{y}` (ArcGIS path order
tile/z/y/x), disk-cached, **magic-byte validated** — the cache can never
hold an upstream error page (`isImageBuf` in parse.mjs, unit-tested);
content-type follows the actual bytes (blank no-coverage tiles are
transparent PNGs). Worker emits per-vertex UVs (`tileGridUv` in geo.ts,
unit-tested: v=1 = north; height rows and web-mercator imagery are both
uniform in tile-pixel space, so the mapping aligns pixel-for-pixel).
Client: z13/z11 tiles get per-tile ShaderMaterial clones sharing the
base material's uniform OBJECTS (light/fog writes hit every clone) and
its GLSL (three compiles ONE program); imagery weight = uHasImagery ×
texture alpha (no-coverage pixels fall back per-pixel to the stylized
ground — offshore/cross-border never goes black) × a 38–46 km fade (no
hard seam at the z11 ring edge); photo albedo gets a flattened normal
term (real sun shading is baked into the photo). Loader: concurrency 4,
auto-off after an 8-failure streak (console-warned; `IMAGERY ON`
retries), textures+materials disposed on tile evict and on `IMAGERY
OFF`. `IMAGERY ON|OFF` search verb persists in localStorage (default
ON). `__ohTiles(probe?)`/`__ohImagery(on)` acceptance hooks.

**Two pre-existing depth bugs found by the imagery (as old as the
rings) and fixed render-side (physics `heights` untouched, proven by
unchanged ground spawns/AGL):** (1) coarse-ring tiles span up to ~60 km,
so neighbors whose CENTERS pass the annulus skip still reach under the
aircraft, and their coarse height sampling crested through z13/z11 —
with imagery this rendered as organic flat-green invaders (diagnosed
with a UV-debug shader after per-tile CPU state checked out); fix:
per-ring render depth bias (z11 −0.5 m, z9 −6 m, z7 −18 m) so finer
rings win the depth test deterministically. (2) sea-clamped terrain
(h<0→0) was exactly coplanar with the y=0 ocean plane — view-dependent
z-fighting over the whole South Bay; fix: sea-clamped verts render at
−0.15 m (runway-flattened verts exempt). Also faded the ocean's wave
slope beyond ~1 km (1/(1+d²·2.5e-6)) — the analytic waves aliased into
glaring moiré bands from altitude; full METAR sea state remains 13e.

**Verified in-browser:** KSJC 30L final = continuous urban photo with
the street grid reading toward the runway; KSFO 28R final = coherent
bay (photo shoreline, ocean shader water, NAIP-green marsh flats);
KHAF ground = photo surroundings, 13a′ pavement carries the detail.
IMAGERY OFF/ON round-trip through the real search box (textures 134→0→
134 from disk cache, localStorage persisted). Zero console errors.
**Perf gate (same live scene, A/B):** OFF p50 10.2 ms/334 calls/53 tex
→ ON p50 9.8 ms/333 calls/104 tex — imagery cost below run variance,
zero added draw calls, p95 13.6 < 16.7 ms, calls ≪ 600 (§23 green).
**Deviations:** US-only coverage (matches sim scope); z13 ≈ 15 m/px is
the resolution ceiling — soft at eye height (airport pavement/markings
carry near-field detail; a z14/z15 composite is possible later);
imagery fades to the stylized ground beyond ~46 km and on z9/z7 rings;
above-datum tidal flats render their NAIP photo (green marsh), not
simulated water. Suite 841 + validate 421 green (tsc clean).

## Phase 13a — sun shadows + perf gate (2026-07-22)

renderer PCFSoft 2048 shadow map; the sun repositions 600 m sunward of a
target tracked on the aircraft (directional lights use only direction —
lighting unchanged) with a ±120 m ortho frustum, texel-snapped in the
light plane against shimmer. Receivers: runway strips + a ShadowMaterial
catcher pinned to terrain height under the aircraft (opaque pavement
draws over it — no double-darkening). New `__ohPerf` hook (frame ring
p50/p95/max + renderer.info). **Gate:** KSFO heavy scene baseline p50
9.3 ms / 126 calls → after 4.3 ms / 128 calls — the shadow cost is
smaller than run-to-run variance (both far inside 16.7 ms); p95 spikes
in both runs are tile-upload frames. Screenshot: the C172's wing/
fuselage shadow on the runway at low sun. **Deviations:** the terrain
custom shader does NOT receive shadow maps (the catcher approximates —
exact over flattened airport ground, approximate on slopes); cockpit
self-shadowing not specifically tuned.

## Phase 12d — roster expansion to 120 flyable types (2026-07-22)

Wave 2: ~28 curated B1 types with full rows (C152→P-51D Mustang→Extra
300L→PC-12→ATR 72→Q400→Citation X→G-V→757/787/A350/A330/777-300ER/A380/
C-130H…). Wave 3: ~77 B2 family variants through `variant()` (2-row
sanity: calibrated stall + cruise ±10% / jet thrust-envelope; climb not
asserted) — 737/A320/E-Jet/CRJ/767/777/787/A330/A350/747 families,
Citation/Gulfstream/Challenger/Falcon lines, King Airs, Dash 8s, racing
gliders, and an An-2 biplane. Totals: **120 flyable types, 421
validation rows green (+4 honest glider skips)**; whole suite 833.

**Model corrections earned by the expansion:** the trim solver's
elevator search now includes trimmable-stabilizer authority (heavy jets
in landing flap need −0.33..−0.40 rad total and railed at the
elevator-only clamp — 11 approach rows failed until then); the governed-
prop η scale applies inside physical bounds (a "better prop" cannot
exceed 88% conversion — over-unity η slipped in via an external
multiplier; a "worse prop" scales its whole curve). Spec errors caught
by rows: A321/A321neo approach speeds were unrealistically slow (now
Vref-class 145/147); A380 needed the Trent 972 rating; Citation X the
AE3007C1 rating and its real M0.90 drag divergence; the P-51's 3,200 fpm
book climb is the combat-weight figure (MTOW target 2,150, documented).
All ~30 per-type tunings are inline-documented in roster-ext.ts —
never silent widening. FLY <designator> flies any of the 120 (browser:
the Mustang held 121 kt on final, Merlin governed at 3,000 rpm).

## Phase 12c — Tier-B roster generator + 15 proving types (2026-07-22)

`derive.ts` (spec → AircraftParams, the honesty ladder documented in its
header: stall CALIBRATED from the published anchor, cruise/climb
PREDICTED, handling INHERITED from class anchors — Tier B is
performance-validated, NOT handling-validated). 15 proving types span
every powerplant/gear/flap combo: P28A/SR22/C182/PA18/BE58 pistons,
TBM9/B350/DHC6 turboprops, C25A/E75L/A320/B739/B763/B744 jets, AS21
glider. Validation: 58 rows green (stall ±3 kt, prop cruise ±5%, jet
cruise thrust-envelope [35–92%], climb ±20%, glide L/D ±20%, approach
trim; glider approach honestly skipped — no spoilers modeled).

**Modeling added by the slice (all params-gated, C172 path bit-exact):**
turboprop flat-rating (`thermoMargin`, min(1, margin×GaggFerrar) — margin
values calibrated to hold flat rating through the piston-shaped lapse,
documented per type); an explicit GOVERNED-PROP model (`propGoverned`:
governor pins redline, thrust = η(J)·P/V with a low-J efficiency ramp +
momentum-theory static cap; the Ct/Cp-table hack could not coarsen pitch
and either overspun the King Air 27% past redline or starved it at
altitude — both found by probes); per-type η scale (`propEtaScale`).
Constant-speed pistons (SR22/C182/BE58) use the governed model too. Bug
found on the way: twin power was double-counted (specs were total,
derive multiplies by count — the 894-hp Baron briefly had 1,200 hp).

**Documented per-type tunings** (roster.ts comments): SR22/TBM9 cd0 from
their cruise anchors; PA18 draggier than class; DHC6 both knobs (climb
props + barn-door drag — cd0 0.085, η×1.22); B744 mdd 0.86 (its wing
cruises AT M0.85; the M0.82 default is 737-class); P28A prop −10%.
`FLY <designator>` flies any roster type (archetype silhouette as the
ship — no detailed exterior, honest). Browser: TBM9 spawned on final in
its own approach config, governor at 2000 rpm, rode the trim. Suite
493+1skip; validate 81+1 (C172 10 / Cub 7 / 737 6 / roster 58).

## Phase 11 — Fleet core close (2026-07-22)

11a–11g complete (per-slice evidence in the commit messages). Three
Tier-A aircraft, each with its own validation table beside the untouched
C172 POH rows (suite totals: 424 tests, validate 23 = 10 C172 + 7 Cub +
6 737): params threading with the silent-default trap killed; carb ice /
hand-prop / pitot-cal / taildragger-rest piston extensions; the J-3 Cub
with EMERGENT ground-loop physics; the CFM56 turbofan; jet/retract/Mach
plumbing proven on a synthetic jet first; the 737-800 (trimmable-stab
authority modeled after full-aft came up 0.7° short of the stall break);
fleet UX (FLY verbs, per-aircraft arcs/EIS/HUD/sound/meshes, U/H/K keys).

**Browser acceptance.** Cub at KHAF under real coastal fog (temp/dewpoint
spread 0 °C): FLY swap, three-point rest 8.8°, mags-cut windmill-down +
hand-prop restart, takeoff 46.5 kt, climb 364 fpm — and the carb-ice
model accreted for real at glide power (intake factor 0.935), carb heat
clearing it (0.9 heat penalty). 737 at KSFO: GFC700 flew the coupled
approach at transport inertia (the flagged gain risk did NOT materialize
— VS ±100 fpm hunting, no divergence); gear-up at 465 ft drew "TOO LOW,
GEAR" at 286 ft; relatched gear; touchdown firm 349 fpm, 842 m past
threshold, R49 m of centerline (runway edge — the debrief said so),
rolled to a stop. **Bug found by that landing:** the gear normal-force
clamp was hardcoded at the C172's 40 kN — a 59-tonne 737 collapsed
through its own gear; now per-leg `maxNormalN` (default bit-exact).
Parked-737 idle-thrust-vs-brakes verified stationary over 20 s.

**Honest notes:** FIFTY…TEN callout cadence is proven in the headless
b738 suite; the browser scripts sample the safety line on a 0.5-s
real-time cadence and can miss individual words (harness artifact, not a
sim gap). One post-run anomaly (a stopped 737 later found rolling at 97
kt after unattended throttled frames with stale override state) is the
documented between-calls harness hazard, not reproducible from a clean
boot. Deviations carried from the plan: no MCP/CDU/FMC UI, G1000-style
PFD with an honest jet EIS (N1/FF; piston gauges omitted, not faked), no
autothrottle servo, no spoilers, no CLB derate, hand-prop is a key
action, 737/Cub pitot cal absent → IAS=CAS.

## Phase 9c — performance gate + the §27 flight (2026-07-21)

**Perf (§23):** headless full-frame cost (physics+logic+`renderer.render`,
via 180 timed `__ohStep(1/60)` calls) at KSFO 28R with 219 tiles: mean
8.3 ms, p95 17.7; with AI traffic + live wx + safety layer: p50 10.1 ms,
max 15.2 — every frame inside the 16.7 ms/60 fps budget. Sustained
on-glass fps can't be measured under automation (rAF suspended); the live
HUD read 60 fps in this session's visible-boot screenshots, matching
Phase 0's 61 fps. Honest limit recorded.

**§27 definition-of-done flight** (one boot, KSFO, today's live weather —
ATIS picked 1L by the real wind): taxi clearance + readback ("readback
correct", Ground 121.80) → held short while a real AI arrival landed
("N42PK, cleared to land"; tower said "hold short, traffic on final" until
the runway freed — correct sequencing, initially misread as a bug) →
"cleared for takeoff" (Tower 120.50) → bay-side right pattern at 900 ft
among AI traffic (2 TCAS targets; TAWS checked every leg and stayed
quiet) → "number 2, follow the traffic ahead, report final" → "cleared to
land" → touchdown and full stop on 1L. Debrief: **"LANDED KSFO: 240 fpm
(smooth) · 1228 m past thr · R22 m of CL"** — honestly long (the harness
pilot's descent law lacked glidepath feed-forward and arrived high; the
analyzer said so). Logbook entry (KSFO→KSFO, 9 min, smooth) survives a
full page reload — the airplane remembers.

**Sim bugs found and fixed by the flight:** ATC menu transmitted on
whatever COM1 held instead of tuning the labeled frequency (calls went to
118.00 and no controller heard); ground spawns kept the previous flight's
trim/flaps/throttle (a KSFO 1L takeoff refused to rotate at 65 KIAS on
stale nose-down trim; KeyR always reset these — search-box/hook spawns now
do too); added `__ohRate` (synthetic Space is only polled on real rAF
frames, so scripted pauses landed out of phase and the plane flew
unattended between tool calls — two CFITs traced to this).

**Known polish items (recorded, not fixed):** TAWS mode-5 "GLIDESLOPE"
line on a KPAO downwind (a receivable KSJC/KSFO ILS GS while low is
arguably in-envelope but reads spurious at a no-ILS field); one "SINK
RATE" while parked (ground inhibition gap); crashed arrivals leave AI
planes parked on the runway visual-only; failures menu UI still hook-only
(`__ohFail`); PAPI/night-emissive/overlay-UI deferrals stand.

## Phase 8 — close (2026-07-20)

8a-8d done (evidence in the appended step notes): recorder/analyzer/grader
cores TDD'd; auto-debrief + localStorage logbook verified across reload;
landing challenges (Catalina/Aspen/Tahoe) launch from the search box and
score via the same analyzer — a deliberately off-course approach at KAVX
scored an honest 0. Deviations recorded: debrief is a HUD line (overlay UI
→ Phase 9 polish); training curriculum beyond the steep-turn grader, bush
trips/discovery tours → roadmap; challenge par values are simple documented
formulas, not calibrated pars; IndexedDB→localStorage. Suite 384/384.

## Phase 7 — acceptance (2026-07-19)

All §24 criteria met. Scripted suites: TCAS (7 tests — head-on TA/RA at
exact published tau ±1 s, RA sense, DMOD slow overtake, ZTHR gate, TA-only
C172 TAS mode; hysteresis bug promoting RAs 5 s early via the TA's widened
gate caught and fixed) and TAWS (7 tests — modes 1-6 + look-ahead; a full
normal ILS produces exactly ['FIVE HUNDRED']). Wired live (0.5 s cadence):
AI traffic → TCAS, terrain/GS/runway context → TAWS, aurals via speech,
HUD safety line, MFD traffic diamonds with relative-altitude tags.
In-sim: **Tahoe** — level 7,100 ft westbound at the Sierra crest: △ TERRAIN
AHEAD (t=158) → ⛰ TERRAIN AHEAD, PULL UP (t=172), escape clean. **KPAO** —
AP-steered intercept of the pattern AI: ⚠ TRAFFIC, TRAFFIC at t=170.
Two real bugs found by these runs and fixed with comments citing them:
onFinal spawns converted 70 KIAS→TAS at sea-level density (stall-mush at
Tahoe's 7,100 ft); applyTrimState set GROUND velocity to the requested TAS
(10 kt tailwind spawned 10 kt slow through the air — trim is an airmass
condition, wind now added). Suite 378/378.

## Phase 6 — acceptance (2026-07-19)

Both §24 criteria evidenced (details in the step notes appended at the end
of this file): **VFR KPAO→KSQL full-phraseology** — headless ordered-log
test (taxi/readback/takeoff at KPAO 118.6/125.0 → inbound/number-2/cleared
at KSQL 119.0, frequency discipline asserted) + the live-browser KPAO half
(real freqs, live-fog ATIS choosing runway 13, AI N77GA cleared in the
pattern, wrong-frequency call honestly unanswered — screenshots in
transcript). **IFR KSFO→KLAX** — CRAFT clearance (all five elements,
reserved squawks avoided) + ordered center handoffs to SoCal Approach +
once-only ILS 24R approach clearance, tested. Suite 364/364.

Phase 6 deviations (recorded, § references):
- Airline schedules/jet performance classes (§13) not built — AI traffic
  is GA pattern aircraft at the active towered field. Hub banks → roadmap.
- Untowered CTAF self-announce (§12.1) not wired — towered fields only.
- IFR is headless-core + tested; the cockpit menu exposure for filing/
  flying it end-to-end in-app lands with Phase 8's fuller UI.
- Web Speech cannot route through WebAudio: voices get squelch clicks, not
  the §12.3 band-pass (platform limitation; server-side TTS → roadmap).
- ARTCC center frequencies are representative and flagged `approx` (no
  free ARTCC boundary/frequency dataset in the pipeline; §28).

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

- **Phase 6 slices a/b/d/e (2026-07-19): ATC + AI traffic pure cores** —
  comms bus w/ tuned-freq audibility, frequencies.csv pipeline, live-wx
  ATIS + wind-based active runway, ground readbacks, strip-based tower,
  AI pattern pilots flying through the same tower/bus as the player.
  Sequencing bug caught by the two-plane radio log: distance-sorted queue
  double-cleared the runway (downwind-abeam closer than base) → FIFO
  sequence numbers, go-arounds rejoin at the back; test asserts one
  clearance at a time. Suite 361/361. NEXT: slice 6c (transcript window,
  readback menu, speechSynthesis voices + WebAudio radio filter, main.ts
  wiring at the nearest towered field, browser KPAO flow), then 6f (IFR
  CRAFT + handoffs, §24 acceptance flights) per docs/plans/phase-6.md.

- **Phase 6 slice 6c (2026-07-19): ATC voice/UI live at KPAO** — transcript
  window + T-menu (numbered requests, readbacks), speechSynthesis voices
  w/ squelch clicks (Web Speech cannot route through WebAudio band-pass —
  recorded platform limitation), COM1 audibility gating verified live
  (wrong-frequency call went unanswered; correct 118.6 call cleared).
  Real KPAO freqs (TWR 118.6/ATIS 135.275), ATIS from live fog (220@4
  0.75SM OVC003 → runway 13), AI N77GA cleared and flying the pattern.
  Tower self-conflict fix: own fresh takeoff clearance no longer blocks a
  repeat request. Suite 361/361. NEXT: 6f — IFR CRAFT + handoffs + the two
  §24 acceptance flights, then close Phase 6.

- **Phase 8a-8c (2026-07-20): recorder, debrief, ACS grader, logbook** —
  10 Hz recorder ring; landing analyzer (touchdown fpm/threshold/centerline/
  grade) consuming ONLY recorded samples; ACS steep-turn grader (±100 ft/
  ±10 kt/45°±5); auto-debrief on touchdown to HUD + logbook persisted in
  localStorage (IndexedDB→localStorage recorded deviation) with reload-
  survival verified live (KHAF landing: 297 fpm smooth; a drifted scripted
  approach was honestly reported short-right — the debrief tells the truth
  about bad flying). Two wiring fixes: departure field = nearest airport
  (was the ATC facility), threshold = course-matched end (was nearest end
  after rollout). Suite 384/384. NEXT: 8d landing challenges + debrief/
  logbook overlay UI, then Phase 9.
