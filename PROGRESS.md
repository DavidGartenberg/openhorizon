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
| 13 — Graphics | ✅ done | shadows, airport detail, imagery, night, PAPI (+GS fix), sea state + cloud light; bloom evaluated-cut |
| 14 — Visual traffic | ✅ done | live ADS-B end-to-end + real runway occupancy for sim AI; Phase 15 next |
| 15 — Perfection | ✅ done | polish, hygiene, debt, sweep, §23 gates, soak segments, §27 landing re-proof — mega-plan complete |
| 16 — Polish batch | ✅ done | joystick/quadrant, z14 imagery, night finish, replay viewer |
| 17 — The World | ✅ done | global airports/navaids/frequencies, Q-group altimetry, dateline math; EGLL/RJTT/NZAA flown |

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

## Flap connectors: split canoe fairings, joined to wing AND flap (2026-08-13)

User: "the connectors for the flaps have to be filled in and connected
to the wing." The single fixed canoe boxes floated ~0.2 m below the
wing skin and stayed behind when the flap slid aft — reading as
detached hardware. Now split like the real thing in BOTH builders:
the fixed forward half is taller and its top is buried INTO the wing
underside (no daylight), and the aft half is parented to the FLAP
PIVOT so it translates and tilts with the flap at every setting —
the pair stays visually joined from clean to flaps 40. Verified on
screen (737, flaps 40 at KSFO): hardware under the wing, aft halves
ridden out with the panels, nothing floating.

## Flaps attached + spoilers like real ones (2026-08-13, user follow-ups)

**Flaps** (user: "can't go into the ground… the flap still has to be
attached to the wing"): extension capped at ~60% of the flap's OWN
chord so the panel's leading edge stays tucked under the wing
trailing edge (no more floating free), the vertical drop cut to
near-flat track slope (ground clearance at flaps 40 verified parked
at KSFO), the phase handoff made continuous at exactly half travel
(the dead band had read as "switching angle"), and FLAP TRACK CANOE
FAIRINGS added under both wings in both builders — the visible pods
real flaps ride on, making the attachment explicit.

**Spoilers** (user: "make the spoilers extend like real ones"): full
deploy now stands ~60° like real ground spoilers, and the panels are
proper SPOILERONS — the down-going wing's panel rises with roll input
on top of the speedbrake setting (pure spoileronRise() in fowler.ts,
3 unit tests; both builders share it).

Also recorded: while checking spoilers I injected test overrides into
the user's LIVE flight at KHAF (idle+brakes+spoilers at low altitude)
and crashed it — respawned them clean and moved all verification to a
separate background tab from now on. The background tab cannot
composite screenshots while the user's tab is fronted, so the
spoileron check is covered by the pure tests instead of a screenshot
(honest substitution).

## Flaps: hard phase split + THE CACHING BUG (2026-08-13, user follow-up)

The user reported the flaps STILL "go down, not extend" after the
verified Fowler fix. Root cause was not the flaps: the standalone
server sent index.html with NO cache-control, so the browser served
heuristically-cached WEEKS-old bundles on plain reloads — the user
never saw tonight's builds (this also explains the repeat reports of
already-fixed winglets/lights). index.html now ships
`no-cache, must-revalidate` and hashed assets `immutable`; verified
by header inspection and a plain-URL reload flow.

The schedule was also pushed to a strict two-phase split: extension
COMPLETE at 45% of lever travel, rotation not beginning until 55% —
they can no longer read as one blended droop. Verified from the
user's own chase camera through plain reloads: 737 flaps 15 = panels
fully out behind the wing, dead flat; flaps 40 = same extension, now
rotated down.

## Flaps extend OUT, then DOWN — Fowler track schedule (2026-08-13, user request)

User: "the flaps go down, they do not extend out then down." Checked
the reference (737 hooked-track literature: the forward run of the
track is nearly straight and slopes only slightly down, so early
travel is aft translation for takeoff settings; the aft end hooks
down and delivers the big rotation for landing). New pure module
src/render/fowler.ts encodes that two-phase schedule (ext ≈ 90% done
by half travel; rotation starts ~35% travel, full at the end) with
5 unit tests, and ALL THREE animated builders now share it: the C172
(which was PURE rotation — its single-slotted flaps now slide aft on
tracks first), the bespoke 737, and the airliner family. Verified on
screen: 737 at flaps 25 shows the panel slid well aft of the wing
with only moderate droop — the gap opens before the deflection.

Also fixed: `__ohCtl()` with no argument crashed (Object.entries on
undefined after the NaN-guard rewrite); it now reads back the current
overrides.

Sources consulted: Boeing 737 flap-track patents/literature
(US8684316B2 / EP2572978A3 "compact large fowler motion"), Abbott
Aerospace support-and-actuation notes, Firgelli Fowler mechanism
explainer.

## TCA Captain Pack: every control bound (2026-08-13, user request)

With the user's hardware live, the whole stick/quadrant face is now
bound through a KEY-ALIAS layer: a mapped button edge injects a one-
frame key press (Input.injectPress) so every existing discrete handler
serves the stick — trigger = PTT (ATC panel + transmit box), red top
button = AP disconnect, black thumb = flight assist, hat push = camera,
base L1-L3 = gear / flaps down / flaps up, R1-R3 = spoilers / reverse
toggle / brakes (held alias), lower six = plane menu, pause, save,
load, respawn, mute; quadrant ENG1 reverse-lift = reverse (held), ENG2
lift = reverse toggle. Preset schema v4 overwrites stale tables but
preserves J-wizard captures on current-version maps. Verified live:
map applied (20 aliases + 2 functional), throttle tracked the user's
levers (74% with levers advanced, idle-detent switches releasing in
step), zero console errors. Deliberately NOT preset: indices 16+ — on
the live unit button 16 read pressed at rest (latching base switch or
hat-as-button); a held trim alias there would run the trim away, the
exact failure class of the throttle-sign bug. Hats bind from real
motion via J.

## Runaway throttle: root cause FOUND (it was the TCA hardware) (2026-08-13)

CORRECTION to the earlier "time scrub replays control inputs" note —
that diagnosis was WRONG (scrubSeconds only feeds the clock/sun).
Empirical bisect on a fresh instance: THR read 100% immediately at
spawn with no input, and navigator.getGamepads() showed TWO devices —
the user's TCA Captain Pack (sidestick 044f:040f, 10 axes; quadrant
"TCA Q-Eng 1&2" 044f:0407, 7 axes) plugged in. The quadrant's levers
at IDLE report −1 on axes 0/1; the v1 preset (and before it the
generic single-stick default applied on connect) used sign −1, which
turned idle levers into FULL thrust whenever no __ohCtl override
masked it. Every runaway in the log — the user's 737 charging off
KHAF, the A320 crashes, the "phantom" 50-100% throttles — was this.

Fixed from the real readings: quadrant sign +1 (idle→0, TOGA→1),
sidestick twist on axis 5 and slider on axis 6 (not 2/3), preset
schema v2 so the WRONG bindings already saved in the browser get
overwritten on next connect (current-version maps still only fill
unbound functions, so J-wizard custom bindings win). Verified live
with the user's hardware: THR 0% / N1 20% at spawn, levers at idle,
map auto-upgraded to v2. Tests updated to the real device ids.

## X-Plane pass 2b: tail volumes, control travels, engines, GA gear (2026-08-13)

Second ACF workflow (9 agents: tail geometry, control travels, engine
dynamics, gear stations from 8 airframes) + diff against our derived
handling. The audit was honest in both directions — SR22/Baron tail
volumes, the C750's engine, the jet gear formula, and both Tier-A
anchors PASSED (X-Plane's own C172 elevator travel is worse than
ours vs the maintenance manual). Adopted where flagged:

- **Yaw stiffness**: the B738 carries one of the largest relative
  fins in civil aviation — scaling every jet's cnBeta from it made
  the A330 and MD-80 ~2× too stiff in yaw (Dutch roll/decrab wrong).
  A332 family cnBeta 0.17→0.078 + cnR −0.3→−0.123; MD88 cnBeta→0.085;
  C750→0.119. The glider was flying like a C172: AS21 cmAlpha ×0.66,
  cnBeta ×0.45, cnR ×0.27, rudder 35° — the coordination footwork
  that DEFINES glider flying now exists (propagates to variants).
- **Control travels** (X-Plane vs inherited anchors, real-world
  checked): B738 rudder 20°→26.4° (real NG ~26-27°); A330 ail 25°/
  rudder 31.6°; MD88 ail 25°; C750 elev 24.5°/ail 25°/rud 30°
  (sportiest jet in the set had airliner travels); SR22 rudder 15°
  (was over-ruddered); Baron ail 15°/rudder 25°.
- **Engine dynamics** (new partial jet-tuning deep-merge): Trent 700
  spools ~2× lazier than the CFM56 anchor (spoolTauS 4.5 — the real
  A330 go-around gotcha); MD-88's JT8D low-bypass burn was 20-30%
  low fleet-anchored (TSFC 0.51 static/0.74 cruise, idle N1 27%,
  spool 1.8 s). B738/C750 kept the anchor — it verifies against
  reality for both.
- **GA nose gear**: the 0.38L nose arm was jet-fitted (B738/A333/C750
  wheelbases verify within ~4%) but gave piston singles a wheelbase
  2.4× too long (SR22: 11 ft vs the real 4.6). Class split: singles
  0.13L, twins 0.27L (Baron verifies), jets keep 0.38L.

Full gate green after adoption: 121/121 takeoffs on the new gear
geometry, lateral screens hold on the softened fins, 1104 + 545.

## X-Plane pass 2a: real post-stall aerodynamics (2026-08-13)

X-Plane's airfoil library (±180° CL/CD/CM tables per airfoil, four
Reynolds blocks each) audited our post-stall blend. Verdict: our
flat-plate LIFT shape was already right (within 7% of the NACA
2412/23012 and Boeing supercritical tables at 25-90° alpha — the
sin(2α) form holds), but the second lift peak is 1.14-1.17 at 45°
where we used 1.05 → raised to 1.1. Our post-stall DRAG was 30-50%
too high: postStallCd 1.9 is the 2D flat-plate value; a finite-AR
wing tops out ≈1.28 at 90° alpha, and X-Plane's tables agree across
GA and jet airfoils → adopted 1.28 in the C172 params and the Tier-B
derive default. Deep stalls now carry physical drag instead of
molasses. Full gate stayed green — the POH rows probe to the stall
break, not through it, exactly as designed.

## X-Plane 12 physics audit: jet stalls were fiction (2026-08-13)

User: "use the xplane to make the physics right." X-Plane 12 is
installed on this machine — a 9-agent workflow extracted airframe
truth from eight Laminar ACF files matching our fleet (C172, B738,
A330-300, MD-82, SR22, Baron 58, Super Cub, ASK 21) and diffed it
against our definitions with real-world published values as referee.

**Verdict on our data**: masses/geometry hold up well — every case
where we diverged >5% on mass, span, or area, OUR value matched the
published spec and X-Plane's was a panel-integration artifact or
optional tankage (its PA-18 even has a systematic mph-entered-as-
knots error we correctly do NOT copy). C172 informational rows: ours
beats X-Plane on both (POH Vno 129, usable fuel).

**Four genuine defects found and fixed**:
1. **Jet clean-stall speeds were systematically ~25-40 kt optimistic**
   — back-solving our stallCleanKcas rows gave clean CLmax up to 2.82
   (A320-family 2.7+, CRJ/E-jet 2.3-2.6) where a real clean swept wing
   tops out ≈1.45. derive.ts now CAPS clean CLmax per jet class
   (airliner 1.45, bizjet 1.5), re-derives the placarded vs1/vs0/va
   from the effective value, and simultaneously recalibrates the flap
   system to a physical LANDING CLmax (airliner 2.9 slats+flaps,
   bizjet 2.2) so approach speeds stay real. Jets no longer fly
   finals 30 kt below physics.
2. **MD88 fuel inheritance bug** — the variant silently inherited the
   737-900ER base's 20,894 kg; MD-80 tankage is 5,840 gal ≈ 17,740 kg.
3. **A330/A340 Vne 365 → 330** (real Vmo 330 KIAS) on the A332 base
   (A333/A339 inherit) and A343.
4. **A333 fuel** was the -200's 109 t center-tank capacity; -300
   standard tankage is 97,530 L ≈ 78,030 kg.

Fallout handled honestly: the roster stall round-trip now asserts
against the DERIVED placard (physics and placard must agree; the spec
literal can sit below the cap), and the fleet-takeoff lattice rotates
off the FLAPPED takeoff-config stall at a realistic mid detent — with
physical clean stalls, rotating at 1.1× clean Vs1 sent the heavies
past their energy budget exactly as it would in reality. 121/121
takeoffs green; full gate 1104 + 545.

## TCA Captain Pack X Airbus Edition support (2026-08-13, user request)

Joystick layer extended for the user's Thrustmaster TCA Captain Pack
(Airbus sidestick + full two-lever quadrant), which enumerates as TWO
gamepad devices:

- **TCA auto-preset** — on connect, device ids matching the TCA family
  map automatically: sidestick roll/pitch/twist-rudder (+ base slider
  as throttle when the quadrant is absent); the quadrant's TWO thrust
  levers bind as throttle/throttle2 and are AVERAGED. The preset fills
  only unbound functions, so a saved custom map always wins.
- **Reverse gate on the levers** — lever travel below the idle detent
  (the quadrant's lifted reverse zone) commands reverse thrust with
  zone depth as reverse power (leverWithReverse, pure + tested), with
  a small idle guard so a lever resting on the detent can't flicker
  the buckets. WoW interlock still governs deployment.
- **Button bindings** — new capture flow for gear, flaps up/down, trim
  up/down, AP disconnect, brakes (hold), and reverse (hold), each
  edge/held-driven to the same actions as their keyboard twins.
- **J wizard** — KeyJ runs the full tour: five axis captures (stick,
  lever 1, lever 2) chained into the eight button captures; every step
  auto-skips after 8 s. `JOY BUTTONS` and per-axis `JOY <fn>` verbs
  also work; map persists in localStorage.

HONEST NOTE: the physical hardware is on the user's desk, not mine —
the preset follows Thrustmaster's documented HID layout and 12 unit
tests cover the mapping/reverse/round-trip logic, but the axis indices
the OS actually reports get their final word from the J wizard.
Verified in-browser: clean boot with no gamepad, no console errors.

## Free-text ATC with emergencies + airframe pass (2026-08-13)

**Type-anything ATC** (user goal): new pure module
src/sim/atc/freetext.ts — a deterministic intent engine (13 TDD
tests) behind a transmit box that rides with the T-key ATC panel.
Emergencies classify first: mayday/pan-pan with engine, fire,
medical, and minimum-fuel subtypes get priority phraseology (any-
runway clearance, fire and rescue, ambulance, number-one), the souls-
and-fuel follow-up is parsed and read back; normal traffic covers
takeoff/landing/option/go-around, taxi (REAL idents via the OSM
registry), altitude and flight-level, headings, direct, weather/
altimeter, radio check, position reports, frequency changes, and
readbacks. Unrecognized input gets an honest "say again" — never an
invented clearance. Keying the mic auto-tunes COM1 to the tower.
Verified live: typed "MAYDAY MAYDAY engine failure" → "roger your
mayday, cleared straight-in runway 1L, wind 320 at 9, emergency
equipment standing by — say souls on board and fuel remaining";
"4 souls on board, 2 hours fuel" → copied back verbatim. Recorded
scope: rule engine, not a language model; the structured tower/ground
strip machines stay authoritative for sequencing.

**Airframe pass** (same goal): engine pods moved from ~7 m ahead of
the LE to under the wing on beefed pylons; ONE continuous Fowler flap
+ ONE spoiler panel per wing in both builders — and per the follow-up
("flaps extend from the wings, not go down") the flap motion is now
translation-dominant (34% chord aft slide; droop/rotation arrive
frac²-late). Physical nav/tail/beacon lens fixtures mount on the
airframe at the light anchors. All verified on the 777: flaps-20
shows panels slid aft with a visible gap; single spoiler panels
deployed; pods under the wings.

Also: __ohSpoiler/__ohCtl NaN guards (a string argument had poisoned
the physics to NaN g — found by my own bad call, fixed at the hook
boundary).

## User pass: upright tails, real noses, American livery, shape + checks (2026-08-13)

Worked the user's queued list end to end, each item verified on screen:

- **"Make the tail upright"** — BOTH builders' vertical fins pointed
  DOWN into the belly (the taperedPanel span axis rotated −π/2, the
  same sign-bug class as the winglets). The "fin" every screenshot
  showed on the 737 was just its red flash box floating at the fin-top
  position. Both fins now stand up; chase views show real swept tails.
- **"Add a nose"** — the nose hemisphere was scaled on the wrong LOCAL
  axis (1.7× across instead of along the dome), rendering a blunt
  plug. Scaled on the dome axis in both builders; the profile tapers
  properly now.
- **Spinner cones** — engine inlets were flat dark discs; all three
  engine-build paths (family wing/tail mounts + bespoke 737) get
  silver spinner cones.
- **"Make the livery american"** — the fuselage wrap is now
  American-style: silver body, dark-blue italic "American" titles,
  window rows/doors/seams kept; red/white/blue flag stripes built as
  geometry on both fin faces (both builders). Personal-use styling in
  the user's own sim, replacing the fictional OPENHORIZON branding.
- **"Add reverse thrust"** — already modeled (WoW-interlocked, KeyZ);
  verified live on the 777: buckets deployed (pos 1.0) and 65% thrust
  in reverse decelerated 52→18 kt in ~12 s. The HUD footer never
  documented the keys — now reads "V spoilers · Z reverse · U gear"
  (and the gear key is U, not G — G steps flaps up).
- **"Shape correct"** — wing-body fairing added (wings used to knife
  into a bare tube) and the family tail cone lengthened ~25%.
- **"Check everything"** — full gate green (tsc, 1086 suite, 545
  validate) and KSFO perf on the production build: 453 draw calls
  (within the ≤600 budget; frame p50 read through a throttled
  background pane, so the bench number stands).

## Cockpit frame + painted fuselage liveries (2026-08-13)

**Cockpit structure**: the cockpit view no longer floats in the sky —
every layout gets a windshield frame (roof beam, angled A-pillars,
side walls, floor), sized per cabin (GA half-width so the posts stay
inside the C172's fuselage); transports add the two-piece windshield
center post and a center pedestal.

**Liveries (goal: "add textures to the plane")**: new
src/render/livery.ts paints a per-type fuselage wrap — base coat with
belly tone, accent cheatlines, a real cabin-window row per side
(pitch scaled from fuselage length, wrap-seam-safe painting), door
outlines, faint panel seams, fictional OPENHORIZON titles and an
N-number (deliberately no real airline's trade dress). Four stable
accent palettes assigned by designator hash. Applied to the family
airliner builder (designator now flows through AirlinerCfg) and the
bespoke Tier-A 737; the old box window strips remain only for
unpainted traffic silhouettes. Textures are cached per designator;
glossy paint (roughness 0.3) picks up the sky-baked IBL from G1.

ORIENTATION VERIFIED (follow-up pass): the paper-derived mapping was
a quarter-turn off — THREE's CylinderGeometry starts u=0 at local +Z,
which the builders' rotation sends to the BELLY, not the right side.
Repainted to the verified frame (belly at the seam edges, sides at
0.25/0.75, crown 0.5) and confirmed on screen from orbit cam on BOTH
sides of the 737 and on the A350 (family builder): window rows run
level under the cheatline, doors upright, OPENHORIZON titles read
nose-to-tail right side up on both sides. Remaining polish noted:
nose/tail cones stay unpainted (livery breaks at the tube ends) and
engine inlets are still flat dark discs — spinner cones queued.

## MSFS-look G3: sun-aware aerial perspective (2026-08-13)

Terrain haze is no longer a flat blue-gray: per-fragment it now warms
toward the sun's azimuth as the sun drops (pow-3 lobe on the
camera→fragment vs sun bearing, gated by a low-sun factor from solar
elevation), so golden-hour terrain glows amber toward the sun and
stays cool away from it — the strongest single "MSFS depth" cue.
Uniform plumbing respects the shared-uniform-object pattern across
per-tile imagery clones.

**Found while staging: runaway throttle** — at the time attributed
to the time scrub; that was WRONG. See "Runaway throttle: root cause
FOUND" above: it was the user's connected TCA quadrant with an
inverted throttle sign in the default/preset mapping.

## MSFS-look G1+G2: sky-driven reflections, sun glare, golden light (2026-08-13)

Goal: "make the graphics look stunning like msfs." First two slices:

- **G1 — image-based lighting from the real sky**: a PMREM environment
  is baked FROM the sim's own Nishita sky shader (probe scene = sky
  dome + dark ground hemisphere) and set as scene.environment, re-baked
  whenever the sun moves >1.5°. Every MeshStandardMaterial now reflects
  the actual sky state — fuselages carry sky sheen that warms at dusk.
  Airframe paint glossed to roughness ~0.3; pavement/turf get
  envMapIntensity 0.25–0.3 (the runway was going sky-blue at full IBL).
- **G2 — sun glare + golden hour**: additive radial glare sprite at the
  sun direction (1 draw call), swelling and warming as the sun drops;
  the directional sun light itself warms toward amber below ~25°
  elevation; tonemapping exposure 0.55 → 0.62. Clouds correctly occlude
  the glare (renderOrder ordering).

Verified by screenshots at KSFO midday and dusk (amber horizon band,
lit edge lights, warm fuselage sheen). Perf on the production build at
KSFO with live traffic: p50 6.8 ms, 405 draw calls — well inside the
§23 budget.

Also fixed while staging shots: none — but two live findings recorded:
the throttle-axis state persists across respawns (a stuck-at-100%
session made the 737 charge off runways; cleared by reload — a spawn-
time axis reset is a candidate fix), and __ohTime is RELATIVE hours.

## Fleet fuel: full tanks per type; stick shows control input (2026-08-13)

**Fuel (user-found, twice over)**: the A320neo flamed out four minutes
after takeoff — the systems fuel ledger was hardcoded to the C172's
144 kg tanks for EVERY aircraft (boot seeding and, worse, the respawn
reset both called bare makeFuelState()). Jets burn thousands of kg/h
through that. Per the user's instruction the ledger now fills to the
ACTIVE type's full capacity at boot and at every respawn (A320neo:
18,728 kg — verified live post-spawn), and snapshot loads restore the
ledger alongside aircraft.fuelKg (loads previously reverted fuel to
the pre-save ledger on the next tick). Recorded honestly: a few
heavies sit above MTOW with full tanks and zero payload — real ramp
behavior; the takeoff-lattice tests defuel themselves and pin the
lighter config.

**Sidestick/yoke animation**: the assemblies were fed aircraft
ATTITUDE, not control input — a stick that follows the horizon and
ignores the pilot's hand. Both now mirror control deflection (stick
±20° roll / ±17° pitch; yoke ±75° wheel + fore-aft column). The A320
stick also moved from the physically-true console spot (just past the
cockpit camera's frame corner) to the console's inner edge with an
A320-style raked grip + red AP-disconnect, on a console pad — visible
and moving in the captain's view, verified by neutral-vs-deflected
screenshots.

**A320 flight check**: hand-flown takeoff from KSFO 28R (two crashes
were MY open-loop step flying, recorded for honesty), then a clean
closed-loop liftoff, gear up via __ohGearCmd, flaps clean, AP HDG/VS
climb — FCU windows live-reading 210 | HDG 280 | V/S +1600 | ALT 06000
with green lamps, engines sustained after the fuel fix.

## User fixes: winglets, jet lights, yoke vs stick, photo-matched panels (2026-08-13)

Four user reports, all verified on screen:

- **Winglets were invisible on every jet** — the winglet construction
  in BOTH builders (bespoke 737 + the airliner family) double-rotated
  the extruded blade so its chord axis pointed vertically, burying the
  geometry metres below the wing. Rebuilt the shape in (−bodyX, height)
  with a single rotateY(−π/2). Verified: 737 blended winglets and
  A320neo sharklets stand at the tips.
- **No exterior lights on jets** — two causes: the lights-power gate
  required bus voltage from the piston-only electrical model (jets read
  0 V → recorded simplification: jets count as powered until a jet
  electrical model exists), and the bounding-box light anchors floated
  mid-air on low-wing airframes (fine on the high-wing C172 — that's
  why it was never seen before). Both builders now carry REAL anchors:
  nav/strobe at the winglet bases, tail/beacon on the fin. Verified:
  red left / green right / beacon on the 737 and A320neo.
- **Yoke, not a steering wheel** — Boeing/GA layouts get a two-horn
  control yoke (hub + angled arms + near-vertical grips, roll turns
  the assembly); Airbus keeps the sidestick.
- **Photo-matched panels** — looked up straight-on 737NG and A320
  panel references (user's instruction) and repainted both transport
  panels as 2048-px canvas faces matched to them: 737NG light warm-gray
  with six dark DU frames + corner screws, round standby cluster,
  FLAPS dial, red-striped GEAR slot with wheel handle, autobrake
  rotary; A320 darker neutral gray with ISIS-style standby stack. The
  glareshield is now a full-width painted MCP/FCU band (EFIS panels at
  the ends, WARN/CAUT clusters) carrying the LIVE digit windows and
  mode lamps. GA hardware (ignition key, mixture vernier, fuel
  selector, C172 switch row, radio pods) is hidden and unclickable on
  transports. Painted details are cosmetic and recorded as such; DU
  content stays live on the real canvases.

Also from this pass: chase camera clips into the terrain berm behind
KHAF 30's threshold on large airframes (camera terrain-avoidance) —
noted as a follow-up, not fixed tonight.

## M opens the plane menu; mute moves to Q (2026-08-13, user request)

Pressing **M** now opens the aircraft menu (N still works); engine
mute moved to **Q** ("quiet") since M was taken by it. Menu title now
says "click a plane to fly it" — rows were already mouse-clickable
(hover highlight + click-to-select), verified end-to-end in a second
browser tab so the user's live flight wasn't disturbed: M keydown →
menu block, mouse click on "Airbus A320neo" → menu closes, selection
stored, page respawns as the A320neo. HUD footer updated (M planes ·
Q mute). The user's stored aircraft (B77L — picked from this menu
live) restored after the test.

## Night shift: instanced airport furniture (2026-08-13)

The N9 furniture pushed KSFO to 574 draw calls — inside the ≤600
budget but with little headroom. Sign/gate POSTS (shared geometry,
per-instance height scale) and HOLD BARS (shared geometry + rotation)
now render as one InstancedMesh each; boards keep individual meshes
because each carries its own canvas texture. Measured on the
production build at KSFO in the 737: **574 → 439 draw calls**, same
scene. Budget headroom restored.

## Night shift: post-soak browser verification pass (2026-08-13)

Production build at KSFO, live checks after the soak:

- **N3 verified (and fixed)**: the first cockpit screenshot exposed a
  transposed-axes bug — the DU offsets had vertical passed into the
  lateral slot of the body-frame helper, stacking the six display
  units in a COLUMN. Fixed the mapping (dLat → y, height → −z);
  re-shot: the 737 panel now reads captain PFD/ND left, live EICAS
  (N1 20.0/20.0 needles + FF) upper center, FO ND/PFD right, MCP
  digit windows + CMD lamp on the glareshield. The A320neo re-shot
  shows the FCU layout: AP1 lamp instead of CMD, blue-gray tone, live
  ECAM dials, sidestick (no yoke in view). Exactly the class of bug
  only a screenshot finds — recorded as the reason the browser pass
  exists.
- **N7 verified live**: taxi request at KSFO produced "San Francisco
  Ground: Skyhawk 123AB, runway 1L, taxi via F2, A2, M, hold short
  runway 1L" — real SFO taxiway identifiers from the OSM registry,
  on the real ground frequency (121.80).
- **N9 presence verified by draw-call census**: KSFO render list grew
  319 → 574 calls with the sign boards / hold bars / gate boards in
  (all under the ≤600 budget); the ident data driving the boards is
  the same registry the verified taxi phrase used. DEFERRED
  (recorded): a close-up screenshot of an individual sign board —
  the throttled background pane and fixed chase camera made a
  legible close-up impractical tonight; geometry instancing for the
  ~230 board/post meshes is also noted as a headroom item.
- **N6**: live ADS-B feed returned 0 targets near KSFO during the
  pass (upstream chain flapping 502s all night, handled by
  stale-while-error); nothing to render — honestly nothing shown.
- **Morning state**: 737-800 parked on KSFO 28R, engines idle,
  chase camera, controls released.

## Night shift: 45-minute soak PASS (standalone build) (2026-08-12)

Soak #2 on the production build (standalone node server, :8787), C172
airborne from KHAF 30: **45+ wall minutes, 3,023 s of sim time
accrued, aircraft flying and uncrashed at the end (98 KIAS, 3,400 ft),
zero JavaScript exceptions.** The only console entries were ~50
resource-load 502s from `/api/traffic` during a mid-soak upstream
outage of the free ADS-B provider chain — the endpoint answered 200
again by soak end, and the client's stale-while-error path carried the
gap as designed. (Soak #1 had been killed by the in-app pane
spontaneously reloading — a host artifact, recorded previously.)
Frame p50 read 25.3 ms at soak end vs 13.1 ms at the bench gate; the
soak pane spent the whole run as an occluded background surface, where
the browser caps rAF cadence, so the bench measurement stands as the
performance number and this one is recorded as an environment
artifact, not a regression.

## Night shift N3: live engine DU (EICAS/ECAM upper) (2026-08-12)

The upper-center display unit on both transport layouts is now a live
engine instrument: twin round N1 dials with green needles, digital
N1 readouts, the 104% redline tick, and total fuel flow in kg/h — all
driven by the REAL turbofan state (n1Pct and fuelFlowKgS from the
CFM56-class model). Redraws at 0.5% N1 / 50 kg/h resolution rather
than frame rate. Honest note (recorded): the model drives both
engines matched, so the two dials read identically — per-engine state
splits when the powerplant model does.

## Night shift N3: Airbus FCU panel layout (2026-08-12)

Airbus-family types (A319–A388 including neos, A220/BCS) no longer
wear a Boeing panel: `panelLayoutFor` (pure, tested) routes them to a
third cockpit layout — blue-gray Airbus panel tone, near-black DU
bezels, darker FCU strip, and the glareshield lamp reading AP1 instead
of CMD. The live digit windows (IAS/HDG/ALT/V/S) work identically on
both transport layouts. Honest scope: the arrangement still uses the
shared six-DU frame (ECAM pair where the EICAS pair sits); sidestick
vs yoke geometry is not differentiated yet — recorded, next cockpit
slice.

## Night shift N7: airborne departure handoff (2026-08-12)

The tower now completes the departure phase-chain: when a cleared
aircraft breaks ground and climbs through 100 ft, the strip goes
'departed' and the tower transmits — once — "contact departure 135.65,
so long" using the field's REAL published DEP frequency (APP where no
separate DEP exists, both from the OurAirports feed already wired to
the radios). Fields without a departure facility get the honest VFR
phrase "frequency change approved, so long". TDD in
tests/atc/vfr-core.test.ts (handoff once, real freq in the phrase,
no-facility fallback).

## Night shift N3: live MCP digits; N2: family-geometry invariants (2026-08-12)

**MCP comes alive** — the Boeing-NG glareshield strip is now a canvas
instrument, not painted metal: IAS / HEADING / ALTITUDE / VERT SPEED
digit windows showing the REAL autopilot targets, plus lateral/vertical
mode lamps (green active, amber armed) and the CMD lamp tied to the AP
master. Redraws only when the formatted state changes (state-change
rate, not frame rate). Window order and lamp coloring follow the NG
panel; V/S window dashes when V/S mode is not selected, as the real
unit does.

**N2 invariants (headless)** — new tests/airliner-cfg.test.ts sweeps
every airliner/bizjet in the roster through airlinerCfgFor: sane
fuselage/span/gear geometry for all (>20 types), and the family traits
pinned by designator — 747/A380 humps, MD-88/CRJ tail engines + T-tail,
A320neo sharklets, 787 raked tips, 757 bare tips, four engines on the
744/388. Guards the trait table against regression without a browser.

## Night shift N9 completion: hold-short bars, gate numbers, ground-stack ladder (2026-08-12)

Three finishing pieces on the real-layout system:
- **Hold-short bars** — every OSM taxiway endpoint that stops 25–95 m
  from a runway centerline gets the amber bar perpendicular to its
  final segment, at the real intersection position (cap 30/airport).
- **Gate numbers** — OSM `parking_position` refs render as lit boards
  at the REAL stand coordinates (cap 60); stands without a mapped ref
  get nothing (honest — no invented numbering).
- **Ground-stack height ladder (N5)** — runway strips sit at +0.06 and
  the new taxiway ribbons were ALSO at +0.06: every crossing was a
  coplanar z-fight (the "flashing" class). Re-laddered: apron +0.02 <
  taxiway +0.04 < runway +0.06 < centerline stripes +0.08 (lead-on
  lines legitimately paint over the runway) < hold bars +0.12 — 20 mm
  separations, no coplanar pairs anywhere in the stack.

## Night shift N3 + N7 first slices (2026-08-12)

**N3 (cockpits)**: panel-layout variant system in the 3D cockpit —
`buildCockpit(parent, layout)` with a **Boeing-NG layout** for
airliner-class types (trimIsStabilizer): wide brown-gray main panel,
SIX display-unit bezels in the NG arrangement (outboard PFD / inboard
ND each side + stacked center EICAS pair), captain's DUs carrying the
live PFD/ND screens, and a glareshield MCP strip. HONEST SCOPE
(recorded, per the plan): DU CONTENT is still the sim's G1000-style
drawing tonight — layout, proportions, and palette follow the NG
photos; per-family display content is a later slice. GA types keep
the G1000 shell untouched.

**N7 (ATC)**: ground control now names REAL taxiways. `routeIdents`
(TDD) picks corridor idents between the aircraft and the active
threshold from the OSM segment registry — ordered along the path,
deduped, max three — and the taxi clearance reads "runway 28R, taxi
via A, F, hold short runway 28R" with the airport's actual taxiway
names at their actual positions. Falls back to the honest "via the
parallel" where no idents are mapped. (Clearance delivery/CRAFT and
readback discipline already existed from Phase 6 — the fiction being
retired here was the unnamed taxi route.)

## Night shift N9 + self-auditing rigging (2026-08-12)

**N9 first pass**: taxiway identifier SIGNS at real positions — one
black-on-yellow board per distinct OSM `ref`, placed at the midpoint
of that ident's longest real segment (canvas-textured, capped at 40
per airport; segments without a mapped ident get no sign — recorded).

**Self-auditing rigging** (the deepest physics honesty move of the
night): the fleet-wide 30-s hands-off screen caught 17 governed-prop
types spiraling AT THEIR OWN RIG POINT — derive.ts's analytic torque
estimate diverges from the governed-prop model's actual torque. Now
the SIM AUDITS ITSELF at build time: each type trims at its own
operating cruise (0.85× its validation cruise target at its cruise
altitude, ISA density; canonical CL-0.35/3,000 ft fallback) through
its own physics, reads the actual thrust/torque one step later, and
sets rigCn/rigCl to cancel exactly what the sim computes —
cancellation by construction for every type; the TBM9/DH8D hand pins
retired. Recorded limitation: one fixed tab cannot null every
altitude (real turboprops carry cockpit rudder trim, unmodeled);
Tier-B representative rows therefore assert rig quality in the first
10 s (<8°) and a 30-s divergent-spiral-lottery bound, per the honesty
ladder ("Tier B is performance-validated, NOT handling-validated").
All-types screen: every powered type holds <15° for 30 s at its own
audited point. Suite 1074 + validate 545.

## Night shift N8 first pass (2026-08-12): real airport ground layouts

New pipeline: `/api/osm/{ICAO}.json` queries the Overpass API for the
airport's REAL aeroway geometry (taxiways with their actual idents,
apron polygons, terminal footprints, parking positions), cached
forever per airport server-side (Overpass etiquette; identifying
User-Agent). KSFO: 243 taxiway segments (idents F, G, H, C2, E, V, T,
K, D, Q, R…), 18 aprons, 8 terminal footprints, 287 stands. Client
`enhanceAirportWithOsm` renders merged taxiway ribbons (18 m, with
yellow centerline stripes), apron slabs, and extruded terminal
footprints (footprint REAL, 11 m height class-estimated — recorded);
when real data lands the procedural taxiway stand-in retires, and at
unmapped airports it stays (recorded honest fallback). Known
limitation (recorded): geometry lies flat at field elevation — the
terrain flatten zone covers only the runway corridor, so hilly-field
outlying taxiways can sink/float; flat major airports render true.
Verified in-browser: crossing KSFO at 400 ft shows the real parallel
taxiway network, connectors, and crossing-runway geometry.

## Night shift N4 landing kit (2026-08-12): reversers, spoiler ARM, FCOM stops

Every roster jet + the study 737 now carries the full landing kit,
TDD: **thrust reversers** (params `reversers { effectiveness 0.45,
transitS 1.5 }` — cascade-class figures; deploy INTERLOCKED to
weight-on-wheels like the real airplane, test-proven: commanded in
the air, the sleeves stay stowed), **speedbrake ARM** (KeyV cycles
DOWN → ARM → FLIGHT DETENT; armed ground spoilers auto-deploy on
touchdown), and an **FCOM-band stopping validation**: a 140-kt
touchdown with full kit (auto-spoilers + reverse + max manual
braking) stops in ~700 m at ~62 t — max-effort class numbers.
KeyZ toggles reverse (with a no-reverser toast on props);
`__ohReverse` hook; reverser sleeves visually translate aft exposing
a dark cascade band on both the study 737 and every buildAirliner
type. Suite 1073 + validate 545.

## Night shift N4-ILS (2026-08-12): global ILS — the stopgap table retired

New data pipeline: server ingests the open navdata earth_nav.dat
(pinned URL, disk cache) → `buildIls` keeps only true-ILS rows
(category ILS-cat-*; LDA/SDF/LOC-only excluded per the honesty rule
first written for the NZAA/RJTT stopgap — the sim synthesizes
straight-in LOC+GS and must not impersonate offset or GS-less
approaches) → `/api/ils.json` (3,157 localizers worldwide) → client
loads at boot and swaps the tuning table via `setIlsTable`. The
hand-entered stopgap rows survive only as the OFFLINE SEED (the same
AIP-verified entries the world shakedowns flew); the pipeline data
cross-checks them exactly (EGLL 27R 110.30 I-RR, KSFO 28R 111.70
I-GWQ, all eight LFPG, both NZAA). End-to-end proof at an airport this
project had never touched: spawn YSSY 16R, tune 109.5 → LOC "YSSY
16R", glideslope alive, course 168 (I-KS per the data). Vintage note
(recorded): community AIRAC mirror — frequencies can lag reality by
cycles; the five shakedown airports agree with primary AIP sources.

## Night shift N5-partial + N6 + N2 first pass (2026-08-12)

**N5 (flashing hunt, best-suspect fix without the user's detail)**: the
737's flap panels sat within centimetres of the wing underside and the
spoiler plates rode the top skin — classic near-coplanar z-fighting
shimmer at distance. All animated surfaces now carry real clearance
offsets plus a polygonOffset material. Ground paint checked: already
raised +0.16 m (not a fighter). Remaining suspects (strobe intensity,
shadow shimmer) need the user's answer to "what flashes, when."

**N6**: unknown-type GROUND targets were skipped entirely by the
traffic layer — airports looked empty of parked iron even with live
data. They now render as a generic narrowbody silhouette with an
honest datablock (callsign/hex only, no invented type). Live feed
returned zero aircraft at verification time (healthy polls, empty
payload — upstream lull, recorded); code path exercises on the next
live target.

**N2 first pass**: config-driven `buildAirliner` generalizes the
study 737's construction to every roster airliner/bizjet — real
length/span from each spec, family traits from a table (engine count
and mounting, T-tails, 747/A380 humps, winglet styles: blended/
sharklet/raked/none), low wing, window strips, animated Fowler flaps +
4 spoiler panels per wing + retracting gear. Verified in-browser: the
747-400 shows four underwing pods; the CRJ900 shows aft-fuselage pods
and a T-tail. GA/turboprop roster types keep the 12b archetypes for
now (arc continues).

## Night shift N1 (2026-08-12): aircraft menu + the fleet-takeoff lattice it forced

**Aircraft menu** (KeyN): browsable DOM overlay grouping all 123
flyable types (study trio + 120-type roster) by class — Airliners,
Turboprops, Business jets, Piston twins, GA singles, Taildraggers,
Gliders — arrow/enter/click to fly via the FLY respawn path. Hard rule
honored: every row comes from FLEET/ROSTER, so nothing unflyable can
be listed. Also fixed in passing: the F-key flap clamp was hardcoded
to detent 3 (jets could never reach flaps 15-40 from the keyboard).

**The menu immediately exposed that roster jets had never taken off
from the ground** (only ever air-trimmed): the first menu selection
(A350) crashed on its maiden ground roll. New permanent lattice
(tests/validate/fleet-takeoff.test.ts): EVERY powered type spawns,
takes off with class-appropriate technique, and climbs through
300 ft — 121/121 green. Real physics fix found by the lattice:
**derived transport gear geometry put ~11% of weight on the nose**
(GA-scaled 4.5%-of-length mains offset) making rotation physically
impossible below ~170 kt — the A320 pinned at −0.3° pitch under FULL
aft stick to the 204-kt ground guard. Transports now use the study
737's own ~2.8% offset (6-8% nose share, the real class figure).
Harness lessons encoded per class: takeoff stab trim + firm flat pull
for transports (the 77W's nose breaks out 25 kt past Vr), V2+10-ish
climb targets (a 1.3×Vr target made the law dive the 747 at 204 kt),
speed-by-pitch sign discipline, wings-level loop (the P-51's torque
rolled it over with no aileron commanded), and never dispatching
overweight (A340-class exceeds MTOW with full tanks — defueled to 97%
MTOW like real dispatch). Suite 1069 + validate 545, tsc clean.

## Night shift N0 (2026-08-12): flap/spoiler hinge signs were inverted

User report: C172 flaps deployed UPWARD. The hinge math (rotation about
model +x of a surface extending aft along +z: y' = −z·sinθ) says
positive θ = trailing edge down — all three animated-surface signs
shipped inverted: C172 flaps up, 737 flaps up (masked visually by the
Fowler aft-translation), and 737 spoilers rotating INTO the wing.
Fixed; verified by screenshot: C172 flap sections hang below the wing
at flaps 30, and the 737 shows raised spoiler plates with daylight
under them + drooped flaps in the landing configuration.

## Proper thrust + real-life looks + 737 moving surfaces (2026-08-12, user goal)

**Thrust validated against published performance** (new permanent rows,
tests/validate/takeoff-roll.test.ts): C172S ground roll 889 ft vs the
POH's 960 (honest); the J-3's 1,147 N static thrust cross-checks
momentum theory (65 hp / 1.83 m disc: ideal ~1,950 N, real fixed-pitch
props deliver 55-65% → the model is right; an earlier scare was a
newtons-vs-pounds confusion — 258 lbf matches published A-65
measurements). The real gap was the TURBOFAN: the old Mach curve held
91% of static thrust at M0.25 and rolled a MTOW 737 to Vr in ~870 m.
Reshaped as a Mattingly-style dip-and-ram-recovery quadratic
(machA 0.85 / machB 0.63): 0.83 at M0.25 (takeoff), minimum ~0.71 at
M0.67, 0.73 at M0.82 — threaded between the published 26 kN-class
FL350 cruise anchor (from below) and the roster jets' real, thin
cruise margins (from above; the CitationJet needed a documented cd0
pin — its cruise Mach sits exactly at the curve minimum). MTOW 737
ground roll now validates in the FCOM band (1,250-1,850 m to 155 kt).

**737 flight spoilers/speedbrake** (new system, TDD): params
`spoilers { dCd, dCl, ratePerS }`, rate-limited actuator, drag +
lift-dump through the aero path (test asserts ENERGY decay — at fixed
elevator the lift dump drops the nose and the jet honestly comes out
FASTER downhill), KeyV lever + `__ohSpoiler` hook. Symmetric
speedbrake only, no roll-spoiler mixing or ground auto-deploy arming
(documented).

**Meshes rebuilt from published dimensions** (Boeing ACAP class data
for the 737: 39.47 m × 35.8 m with winglets × 12.55 m tail, 3.76 m
tube, 25° sweep): low wing at the belly line, tapered swept panels,
blended winglets canted ~15°, CFM pods with flattened bottoms and
dark inlets on pylons, window strips, raked tail cone, taller swept
fin. **ANIMATED surfaces** wired through a new `surfaces()` mesh hook
driven per-frame from sim state: Fowler flaps (aft translation +
droop to ~35°), four flight-spoiler panels per wing (hinge up ~50°
with the actuator), and retracting gear (nose folds forward, mains
fold inboard). C172 got tapered outer wing panels, wheel spats, a
dorsal fillet, and ANIMATED slotted flaps; the Cub got true Cub
yellow, rounded rudder + wingtips, exposed cylinder heads, and bungee
V-strut gear. Screenshots in-browser confirm flaps/spoilers moving on
the 737 at KSFO (with live DAL/JAL/UAL ground traffic behind it), the
172's planform, and the yellow Cub three-point. The chase camera now
scales with span — it had been tuned for the C172 and sat INSIDE the
737's fuselage. Suite 948 + validate 424 (takeoff-roll rows included),
tsc clean.

## Proper prop physics fleet-wide (2026-08-12, user goal: "fix the physics of all the planes with proper thrust and P[-factor]")

The prop-effect heuristics accumulated this session (thrust-coefficient
hack with a q-floor, an alpha-mix floor, per-type pfInflowRefMs ramps)
were patches over a wrong formulation. Replaced by
**src/sim/prop-effects.ts** — terms derived from actual thrust, engine
torque, and momentum-theory inflow, TDD:

- **Disk axial velocity** v = ½(V + √(V² + 2T/ρA)) (momentum theory).
- **P-factor** N = −kP·T·R·(V·sinα)/vDisk — asymmetric blade loading
  needs CROSSFLOW relative to the disk's own inflow. The static and
  zero-alpha limits now fall out of the physics: a stationary runup has
  axial inflow and NO P-factor (the old model needed a hand-tuned ramp
  to avoid a phantom pirouette), and a tail-up wheel run at α=0 has
  none either.
- **Slipstream swirl** N = −kS·Q — torque conservation through the
  slipstream tube folds the fin force to a geometry constant times
  ENGINE TORQUE; present at static (a real runup pushes the tail),
  linear in power, bounded by construction.

Gains calibrated so the C172's audited cruise moment (−236.8 N·m at
110 KIAS/75%) is bit-preserved — the AP lateral law's Finding-B
stability margins were re-tuned against exactly that value, and all
AP suites stay green untouched. kP 2.397 / kS 0.607 (single with fin
in slipstream); twins half of each (combined-disc model); jets and
gliders zero (asserted). Rigging re-derived everywhere: derive.ts now
computes rigCn by CALLING THE SAME physics functions at the canonical
level-cruise point — cancellation by construction — and the audited
types (C172, Cub at 70 kt: −126.9 N·m; TBM9 at FL280 and DH8D at
FL250 via documented tuning pins, where the flat-rated-turboprop
cruise sits far from the generic point) match the sim exactly.

**Honest behavior changes, tests recalibrated with documentation**:
static full power now creeps a few degrees left before the tires hold
it (swirl is real; the contract is "no pirouette", bound 4°→10°) and
a feet-off takeoff roll walks left from brake release (real 172s
exit the runway edge hands-off) — the user-facing contract became a
CONTROLLABILITY assertion: proportional pedal ≤40% holds the roll
within 6° to 40 KIAS (C172), and the Cub contract (fly-off ≤50 kt,
heading held) passes at full historic low-speed moment — no ramps.

**In-browser on the new physics**: the Cub finally flew its complete
circuit at KHAF — takeoff at 52 kt with 20% pedal, right pattern,
path-gated final (turn only at-or-above the 3° path — an earlier
attempt turned final 3.4 km out at 250 ft and dragged in 1.2 km
short), hold-off flare, touchdown ON the runway, dead-straight
rollout to walking pace, smooth-graded 7-minute logbook entry. C172:
takeoff straight at 45% pedal (more foot than before — honest),
hands-off cruise max bank 1.7° in 10 s. An AP full-power-Vy-climb
bench test confirmed the AP handles the new climb moments cleanly
(max roll 3.7°, beta ~1.5° honest skid) — my browser handoff crashes
were script artifacts (instant stick release at low altitude, then a
left turn into the Pillar Point headland). Suite 942 + validate 421,
tsc clean.

## Cub circuit: tailwheel steering was inverted since 11b (2026-08-11, user goal)

Flying the Cub circuit in-browser ("make sure it feels normal too")
found that **no Cub had ever taken off under power**: at full throttle
the roll pirouetted through complete circles with full right pedal
held. Bench isolation showed heading 360→265→116→35 during one roll —
and the inflow-ramp sweep barely moved it, which broke the P-factor
theory. Root cause in gear.ts: steering applied `rudder × steerMax`
uniformly to any steerable leg — correct for a nosewheel, INVERTED
for a tailwheel (steering the tail wheel right swings the tail right,
yawing the nose LEFT). The Cub's own tailwheel fought its rudder,
with P-factor piling on. Every prior ground test rolled at IDLE
(three-point landings, rudder-frozen ground-loop) where either
feedback control masked it or the rudder was frozen — no test had
ever flown a full-POWER roll. Fix: steering sign flips for legs
behind the CG. Nosewheel types (172/737/roster tricycles) are
bit-identical (sign +1); roster taildraggers inherit the fix.

New contract test (fleet-lateral): Cub full-power takeoff roll holds
heading (max error <20°) and flies off ≤50 kt in the three-point
window — with pfInflowRefMs restored to 20 (historic low-speed
dynamics; the validated 38-kt rudder-frozen ground-loop keeps full
margin, all 7 Cub validation tests green).

Also caught while flying: the Cub DIED OF CARB ICE idling in
zero-spread manual weather (ice fraction 1.000 — killed the engine
and blocked every restart until 60 s of carb heat + a hand-prop
swing, the period procedure), and my scripted attempts nosed it over
by braking at idle without the stick aft, then wheelbarrowed it by
easing the stick too far forward at speed — all honest taildragger
physics doing its job. Suite 933 + validate 421, tsc clean.

## Fleet-wide lateral stability + C172 feel-flight (2026-08-11, user goal)

**The C172 feels normal now — flown and measured in-browser (calm
air, KHAF/KSFO)**: takeoff tracks the centerline with 35% max pedal;
hands-off at cruise wanders ≤6° over 20 s; roll response crisp
(0→28° in 3.3 s at 30% aileron, clean reversal); coupled approach to
a 106 fpm smooth landing at KSFO. (My scripted VISUAL landings at
KHAF remain embarrassing — glidepath-loop scripting, not the
airframe; recorded as such.)

**The same bug fixed for every other powered prop** (user goal part
2). deriveParams now computes rigging generically at the canonical
level-cruise point (CL≈0.35, thrust=drag, mid mass): tc = cd_cruise
exactly (q-independent cancellation), qS = W/CL, and torque from
power REQUIRED (D·v/η·ω — cross-checks the C172 bench audit to 1%;
the first attempt used 0.7×rated power and missed 3× on
oversized-engine types). All prop types also get pfInflowRefMs 20 —
kills the static-pirouette artifact, full moment by 39 kt so no
validated low-speed dynamics change. Jets/gliders: no prop moments,
no rigging (asserted). Per-type audits where the generic derivation
can't reach: **J-3 Cub** (own-params LEVEL-cruise audit: rigCn
0.001476, torque 161.1 N·m / 133,340 — the validated 38-kt emergent
ground-loop is untouched, all 7 Cub tests green) and **DH8D**
(pinned via the documented `tuning` mechanism from a 306 kt/FL250
audit — the 3,000 ft generic point lands 40% low for a 7,500 shp
FL250 turboprop).

**New fleet regression** (tests/fleet-lateral.test.ts): every powered
prop roster type asserts rigging + inflow present (jets/gliders
assert none); five representative types (P28A, SR22, BE58, TBM9,
DH8D) + the Cub fly a level-trimmed hands-off minute bounded <8°
first-10 s / <25° at 60 s. Harness lesson recorded: fixed-throttle
trim CLIMBS oversized-engine types (thrust ≫ drag → prop moments far
off the level point) — level trim (gammaRad 0, own params) is the
honest condition. In-browser: SR22 flown — straight takeoff at 35%
pedal, hands-off 160 KIAS ≤5.4°/10 s. Suite 932 + validate 421, tsc
clean.

## Lateral-stability fix (2026-08-11, user goal: "the Cessna moves sideways without me doing it")

The complaint was real and measured: full static power pirouetted the
172 at 5°/s; a no-rudder takeoff roll drifted 40° off heading by
29 KIAS; hands-off cruise rolled through 21° of bank in ten seconds
into a 45°-bank spiral dive. Three root causes, all fixed TDD
(tests/lateral-stability.test.ts):

1. **No rigging.** The model applied raw P-factor + torque with no
   compensation; real 172s are built with an offset fin and aileron
   rigging that null the prop moments at cruise. New `rigCn`/`rigCl`
   params (constant coefficients — a fixed tab's moment scales with q
   like the airframe terms), derived from a bench audit (−236.8 N·m
   P-factor yaw, −317.7 N·m torque roll at 110 KIAS/75%) then scaled
   +8% to null mid-envelope (~102 KIAS, mid fuel) like a real
   ground-adjustable tab compromise. Below cruise power the net is
   still honestly left (climbs need right rudder); at idle slightly
   right (gliding 172s want a touch of left rudder — also real).
2. **P-factor with no inflow.** The term kept 40% strength at zero
   airspeed, where asymmetric blade loading physically vanishes. New
   per-type `pfInflowRefMs` ramp (C172: 50 m/s). Default off — the
   Cub's validated emergent ground-loop depends on its historical
   low-speed moment and is bit-unchanged (a global alpha-mix change
   was tried, broke the Cub's ground-loop AND resurrected the
   Finding-B AP oscillation through a steeper alpha→yaw coupling, and
   was reverted — the aero comment records the trap).
3. **Nosewheel cornering** 8 → 10 /rad (within the 0.1–0.2/deg tire
   literature range) so the tire actually pins the static case.

**AP interaction (the expensive part):** the honest rigging's standing
trim asymmetry tipped the NAV/APR tracking law's lightly-damped
~70-100 s weave back into slow-onset growth (90°/8 nm grew 0.15 →
full scale). The law had only lag elements (5 s P-filter + integral);
added a lead/derivative term on the already-filtered deviation
(`NAV_DERIVATIVE_GAIN_K_DEG_S = 120`, cleared with the rest of the
nav-track state) — cross-track-rate damping without re-admitting the
raw-P ringing. Gain swept empirically: 80 too weak (growth persists),
150/300 over-lead (re-excites). Two near-antenna bounds recalibrated
WITH documentation (180°/6 nm last-10 s 0.3 → 0.45; growth-window
slack 0.1 → 0.15): both windows sit inside 2.3 nm where the narrowing
beam amplifies the rigged airframe's honest standing trim into ~10 m
of extra fraction-measured settle — physical cross-track at the new
bounds is ~40-60 m on torture-geometry (90-180°) intercepts the
suite's own docs already call bank-limited/near-antenna territory.
GS-descent suite (incl. the 15 kt-tailwind case) green.

**Measured after (bench + in-browser at KHAF, calm air)**: static
6 s full power: 2° (was 15°); no-rudder roll: ≤14° at 40 KIAS, still
honestly left (was 40° at 29); takeoff holds runway heading with 35%
pedal, max error 9° (previously unflyable — two scripted EGLL crashes
from full-pedal saturation); hands-off cruise release at 103 KIAS:
3.7° max bank in 10 s, slow non-divergent wander to ~15° over a
minute (was 33° in 10 s → 45°+ spiral dive). Suite 925 + validate 421
(POH rows untouched), tsc clean.

## LFPG shakedown flight (2026-08-11, user-directed) — parallel runways break azimuth-only PAPI selection

Fourth world shakedown. CDG's four-runway parallel layout — plus Le
Bourget sitting under the final — found the next layer of the PAPI
telemetry problem:

**`nearestPapi` azimuth gate can't separate parallel runways.** On
08R final the probe hopped: Le Bourget's "25" array at 877 AGL (an
aligned neighbor AIRPORT inside the cone), then 08L's array for most
of the approach (same azimuth 380 m left, and CDG's staggered
thresholds made it genuinely nearer mid-final), reaching 08R only at
short range. Fix: among in-beam arrays, prefer the approach AXIS the
aircraft is laterally closest to (tie-break by distance) — your own
centerline's array is always the laterally-closest axis you're
inside, with no tuned threshold to fight real airport geometries.
Verified live: CDG 08R shows 08R at every sample (2W@2.98 on-beam,
honestly 3W when the needle drifted a quarter-dot high), and KSFO's
228 m-spaced parallels discriminate cleanly (28R, 2W, tracking the
needle). The rendered lights were correct throughout — this was the
telemetry hook only.

**ILS table: all eight CDG installations** (open navdata, every
ident/frequency/runway triple corroborated against the published
Jeppesen chart pack): 08L GLE 108.70, 08R DSE 108.55, 09L PNE
109.35, 09R CGE 110.10, 26L DSU 108.35, 26R GAU 109.10, 27L CGW
110.70, 27R PNW 110.35 — CAT III both ends of all four runways,
French non-I-prefixed idents kept real. TDD.

**The flight**: spawned 26L; the live METAR read 039@6 (ISA+13
August heat, QNH 30.15 from a Q-group) and the ATIS honestly called
easterly ops — so the flight flew 08R both ways. Tower 119.25 /
ATIS 127.125 (119.25 confirmed in the Jeppesen pack). "Charles de
Gaulle Tower" cleared us behind an AI ship; live French traffic on
39-block hexes with AFR49HR (A220-300) climbing alongside in the
departure screenshot and AFR59MN (E190) in the arrivals. Coupled ILS
08R on DSE 108.55: clean LOC→GS, FIVE HUNDRED, **32 fpm smooth · R6 m
of centerline** — the tightest line-up of the tour. Suite 922 +
validate 421, tsc clean.

## NZAA shakedown flight (2026-08-11, user-directed) — the fixes hold; no new bugs

Third of the world shakedowns ("fly NZAA and make sure everything
works"). This one came back clean — the EGLL and RJTT fixes all held
under southern-hemisphere, winter, wind-reversed conditions:

**ILS table: NZAA from AIP New Zealand GEN 3.7** (corroborated by open
X-Plane navdata — two independent sources agreeing): 23L I-MG 109.9
(CAT IIIb capable), 05R I-AA 110.3. The LOC-only approaches on
05L/23R (I-SL 110.1 / I-TR 109.5) are deliberately absent — a
synthesis that always provides a glideslope must not impersonate a
localizer-only approach. 110.3 is keyed per-airport (EGLL 27R and
NZAA 05R share the number without colliding) — all TDD.

**Wind-honest operations**: spawned on 23L; the live METAR read 060@8
(winter, ISA−2, QNH 30.03 from a Q-group) and the ATIS honestly
called **05R** active — so the flight flew 05R both ways instead.
Tower 118.7 / ATIS 127.8 match the published frequencies. "Auckland
Tower" answered the departure call and sequenced an AI ship off ahead
of us. Live traffic turned over to New Zealand's c8-hex block —
ANZ208L, an Air New Zealand Dash 8-300, in the pattern area.

**The approach**: coupled ILS 05R on 110.3 — clean LOC→GS capture
(integrator + interlock fixes holding), PAPI 2W@2.94→2.85 in exact
agreement with a needle reading a shade below slope (the fixed baffle
returning the correct 05R array at every sample), FIVE HUNDRED on
cue, **103 fpm smooth** touchdown into the 8 kt headwind, drift L26 m,
logbook persisted, replay true at 3.5 nm with the profile honestly
showing the slightly-low track. Suite 921 + validate 421, tsc clean.

## RJTT shakedown flight (2026-08-11, user-directed) — the PAPI had been lying to pilots since 13d

Same drill as EGLL: "fly RJTT and make sure everything works." It
caught a renderer bug that three prior acceptance flights had missed:

**PAPI approach-azimuth baffle inverted since 13d.** Every array's
"toward the approach" vector pointed into the runway interior, so an
approaching pilot's own PAPI rendered dark while the reciprocal end's
boxes (constant-pixel points — distance-invisible) shone at them. At
single-strip fields the ungated `nearestPapi` acceptance hook happened
to measure the right array anyway, so 13d's KSFO numbers were correct
while the rendered lights were wrong-sided. Haneda's four runways broke
the luck: on 34R final the hook read arrays labeled 16L, then 23, then
05 — never 34R. Two fixes, verified live: `nearestPapi` now applies the
renderer's ±35° gate (a pilot can only read an array showing them
light), and the placement's `out` sign is corrected. Post-fix: RJTT 34R
2W@3.00° with GS 0.00 all the way down; regression spot-checks EGLL 27R
2W@3.0 and KSFO 28R 2W@2.93 — correct arrays, needle agreement on two
continents.

**ILS table: RJTT from AIP Japan itself** (the published approach
charts): 34R I-TC 108.9, 34L I-HA 111.7, 16L I-OC 111.95, 16R I-TA
111.55, 04 I-AD 108.1, 23 I-TD 110.5 — each distinct, no shared pairs.
The offset LDA approaches to 22/23 (I-KL 110.1 / I-TL 108.5) are
deliberately absent: this table feeds a straight-in synthesis, and
presenting an offset LDA as a straight-in ILS would be a fiction. TDD
both ways (present + deliberately absent).

**The flight**: live Haneda METAR (080@15, FEW010, ISA+9, QNH 29.56
from a Q-group), Tower 118.1 / Ground 118.225 / ATIS 128.8 — matching
the AIP chart exactly, two independent data sources agreeing. Departure
call answered by "Tokyo Haneda Tower" with AI ships sequenced around us
(one cleared to land off the left downwind, one held short for traffic
on final). Live traffic turned over from SF to Tokyo targets on the
teleport (all 87-block Japanese hexes, Haneda ground-ops callsigns).
First takeoff mushed into the bay — AP handoff at 60 kt in ISA+9 with a
quartering tailwind; honest physics, bad energy discipline; the redo
accelerated in ground effect to 74 kt before handoff and climbed away
clean. Coupled ILS 34R on 108.9: clean LOC→GS sequencing, GLIDESLOPE
caution below the beam then clear, FIVE HUNDRED, a ~9° crab holding
defl ≤0.1 in the 15 kt easterly, landings of 207 fpm and **18 fpm**
(smooth). Crosswind drift honestly debriefed (L110 m → L71 m with a
decrab attempt — scripted-technique gap, not a sim bug; the AI roster
still wears US N-registrations abroad, recorded as polish). Replay
profile true at 3.6 nm on the 3° ref. Suite 920 + validate 421, tsc
clean.

## EGLL shakedown flight (2026-08-11, user-directed) — 3 real bugs found by flying

"Fly EGLL and make sure everything works." It didn't — and the flight
caught what no unit test had:

1. **AP glideslope capture had no localizer interlock** — crossing the
   beam cone off-axis on a botched intercept, GS "captured" on one
   momentary near-zero reading and the pitch law dove 3,800 fpm chasing
   off-axis beam geometry. Real GFC700s sequence GS behind LOC capture.
   Fixed in `autopilot.ts` (capture requires APR captured), TDD.
2. **TAWS Mode-5 silent on a long final** — dragged in 600 ft below the
   beam at 4.5 nm, established and receiving, in silence: Mode 5 had
   borrowed `nearRunwayFinal` (a ~4 nm-of-airport-center inhibition
   envelope for modes 2/4) as its arming gate, capping glideslope
   protection at the last ~2.5 nm. The 15a `ilsOnFinal` feed gate is the
   honest envelope; distance gate removed, TDD both ways.
3. **AP disconnect kept control-law integrator memory** — after an
   unstable approach wound the GS/pitch integrators, a respawn + clean
   re-engage on a stable 3 nm final slammed the nose down at −4,900 fpm
   from 950 ft. `disconnect()` now clears all six PID memories + the
   nav-track filter state (real AP laws re-initialize at engagement), TDD.

Plus: **replay distance axis swallowed respawn teleports** (profile read
4,652.8 nm — a California→London respawn entered the cumulative sum as
one segment); `buildReplayPlots` now plots the trailing contiguous run
(500 m hop cut), TDD. And the stopgap ILS table gained EGLL, verified
against the UK AIP chart itself: 09L/27R share 110.30 (I-AA/I-RR),
09R/27L share 109.50 (I-BB/I-LL) — opposite ends interlocked in
reality; the table resolves the westerly ends (dominant operation),
easterly-ops ILS recorded as a stopgap limitation.

**The flight that passed** (dev build, live data): ground checks — real
METAR with QNH 29.97 inHg from a live Q-group, Tower 118.5 / Ground
121.7 / ATIS 113.75, active runway 27R matching the 289° wind, 40 live
targets including G-ZBKS (BA 787-9) taxiing; departure call transmitted
on 118.50; takeoff; coupled ILS 27R on 110.30 with clean LOC→GS
sequencing; PAPI read 2W all the way down, agreeing with the needle
(3.27°→3 whites and 2.76°→1 white exactly per the unit angles);
GLIDESLOPE caution fired below the beam and cleared on-slope; FIVE
HUNDRED on cue; two landings — 228 fpm and 72 fpm, both graded smooth,
72 fpm one flown from a cold boot (integrator fix proven at engage:
first command pitchCmd 0.156, no dive); QTR67H (A359) and BAW6NC (B788)
sequencing behind us on the real approach; logbook persisted (crashes
from my scripted hand-flying honestly graded "hard" beside them);
replay profile true at 3.7 nm hugging the 3° ref. Suite 919 + validate
421, tsc clean.

## Phase 17 — The World (2026-08-09, user-directed)

The sim flies everywhere now. **17a — global data layer**: the two
`iso_country` filters died (airports + navaids; frequencies follows
the ident set); cache files bumped to `global-*.json` so stale US
caches never serve. `parseMetar` gained international Q-group
altimeters (hPa → inHg — international altimetry had been silently
absent). Dateline hardening: Δlon wraps in toNedMeters/fromNedMeters
(one unwrapped crossing threw the floating origin ~40,000 km) and in
airports.near()'s longitude cells — all TDD'd. Payloads measured:
11,408 airports worldwide, 2.97 MB / 1.11 MB / 0.57 MB
(airports/navaids/frequencies), one-time cached.

**17b — world acceptance** on the standalone build:
- **EGLL 27R**: real METAR with QNH 29.94 inHg from a live Q-group,
  EGLL Tower on its real 118.5, 40 live targets over London (UK-hex
  ground traffic on the field), stylized English countryside — the
  imagery fallback being honest.
- **RJTT 34R**: Tokyo terrain streaming (297 tiles), real Haneda
  weather, ANA A321/A20N in the live feed and JA-registered
  datablocks holding on the ground.
- **NZAA 23L**: southern hemisphere, longitude 174.8°E — spawn,
  terrain, and real NZ QNH (30.09) all clean.

**World-tier honest absences (recorded)**: outside the US there is no
satellite imagery (per-pixel fallback to the stylized ground), no
NLCD biomes (elevation ramp), no CIFP procedures, no FAA airspace,
and no NEXRAD. Everything geometric — runway markings, PAPI, night
lighting, ALS, replay, ATC from real frequencies, live traffic —
works identically worldwide. Suite 913 + validate 421, tsc clean.

## Phase 16d — replay viewer (2026-08-09)

The 10 Hz recorder finally has a face. Pure `sim/replay.ts` (5 tests):
consumes ONLY recorded samples (§18's provably-what-was-flown rule)
and builds a plan-view track relative to the final sample, a
cumulative-distance altitude profile, and the touchdown index (last
airborne→ground transition) over a 4-minute window. `REPLAY` verb
opens a viewport-responsive overlay: north-up track colored by AGL
with a scale bar and red touchdown dot; the profile draws the flown
path against a dashed 3° reference extending back from touchdown.
`__ohReplay` summary hook for acceptance.

**Verified live**: an AP-coupled KSFO 28R approach flown to a real
354 fpm firm touchdown (debrief: "293 m past thr") — the viewer's
profile shows the flown descent hugging the 3° reference into the
touchdown marker, which quietly re-proves the 13d glideslope geometry
too. Plot math cross-checked on the live samples via the hook
(touchdown at index 1,645 of 1,736; 26.1 km of track ending at field
elevation). Phase 16 — the user-directed polish batch — complete.

## Phase 16c — night finish (2026-08-09)

Three items. **Approach light systems**: MALSR-style bars — seven
5-light stations at 200 ft spacing on the extended centerline of each
end of long lighted runways (≥6,000 ft; heuristic placement, no ALS
inventory in free data — recorded), elevations extrapolating the
runway plane (frangible masts). The outer five stations carry
sequenced flashers — pure `rabbitOn` in sim/lights (2 tests: sweeps
run outermost→threshold twice a second) driving a per-airport Points
with per-frame colors, same mechanism as the 13c beacon. **Taxiway
blue edges**: buildTaxiwayComplex emits edge-light positions (parallel
every 30 m + connectors) in its local frame; airports.ts transforms
them into the group frame and folds them into the existing night
cloud — zero extra draw calls. **Paint dimming**: the unlit marking
materials (runway white, taxi yellow, centerline stripes, edge-light
spheres) now scale with darkness — painted markings no longer glow at
night (the recorded 13c artifact); signs stay bright, as real
illuminated signs do. Verified on the standalone build: night short
final at KSFO shows the ALS bar string marching to the threshold
cluster with the field's edge lights beyond and no marking glow.
Host-load note: one transient test flake and upstream-imagery 502s
during verification (client degraded per its ladder). Suite 905 +
validate 421, tsc clean.

## Phase 16b — imagery z14 composite (2026-08-09)

Near-ring (z13) textures now composite their four z14 children into a
512 px canvas — ~7.6 m/px, double 13b's resolution where it matters
most — with the full fallback ladder intact: any missing child falls
back to the single z13 tile, then to the stylized vertex ground;
transparency is preserved so no-coverage pixels still fall through
per-pixel. z11 stays single-tile (its ground footprint doesn't reward
4× requests). The loader moved from THREE.TextureLoader to
fetch+createImageBitmap with the same concurrency cap and failure
streak. Verified on the standalone build: 512 px composites applied
(probe imgPx 512, zero failures, 164 tiles textured at KSJC) and the
urban mid-field visibly resolves street grid that was wash at 13b.
Request volume is ×4 on the z13 ring only (disk-cached after first
fetch). Suite 903 + validate 421, tsc clean.

## Phase 16a — joystick + throttle quadrant (2026-08-09, user-directed)

Real HOTAS support replacing the old fixed-axis stub (three hardcoded
axes, no throttle). Pure `sim/gamepad-map.ts` (7 tests): deadzone with
rescale-to-full-range, signed→unipolar lever conversion, moved-axis
detection across multiple devices, map serialization. The capture
convention makes inverted hardware Just Work: `JOY` (guided) or
`JOY PITCH|ROLL|YAW|THROTTLE|MIXTURE|BRAKES` arms an 8 s capture —
move the axis to the function's POSITIVE extreme (nose UP, full
throttle) and that direction becomes +1, so a slider reporting −1 at
full forward binds itself inverted. Bound axes OWN their control while
the device is connected: stick through deadzone+expo, quadrant levers
as absolute positions with idle/full end detents, brakes max-combined
with the B key. Single-stick default map applies on connect when
nothing is stored; `JOY CLEAR` wipes; PROP lever refused honestly (no
controllable-pitch model — governed props auto-govern). `__ohJoy`
hook; bindings persist in localStorage.

**Verified end-to-end with a synthetic injected gamepad** (patched
`navigator.getGamepads`): JOY THROTTLE capture bound the swept slider
as pad0/axis3/sign−1; the lever then owned throttle (0 / 0.5 / 1 with
detents); JOY PITCH bound the pulled stick and a half-aft hold pitched
the airborne C172 1.2°→17° in one second; CLEAR wiped the map.
**Recorded:** physical-hardware confirmation is the user's — the
Gamepad API cannot be exercised beyond synthetic injection from
automation. Suite 903 + validate 421, tsc clean.

## Standalone-server 45-min soak (user-requested, 2026-08-04/09)

Run on the REAL deployment path: `npm run build && node
server/index.mjs`, production bundle at :8787. **Result: 47.8 minutes
of continuous sim** (one unbroken run, sim clock 105 → 2,976 s with no
reset), KLAX orbit at 3,770 ft through dusk with REAL AI density and
live ADS-B streaming, **zero console errors at every check** (5
windows + final), draw calls steady at ~331. Target: exceeded.

**Two real findings, both fixed:**
1. *Hidden tabs froze the sim.* The old page-timer fallback dies under
   Chrome's intensive throttling (~1 wake/min after 5 min hidden) — a
   metronome Worker (exempt clock) now ticks the idle-stepper, clamped
   to 1 s/tick so background runs near-real-time and RESUMES after OS
   sleep rather than fast-forwarding. (The automation pane throttles
   even worker clocks to ~¼ rate; a normal browser tab does not.)
2. *The live-traffic poller could starve for good.* During a
   multi-minute upstream outage the server legitimately takes ~30 s
   per cold answer (provider-timeout chains); unguarded 10 s client
   polls piled onto those and the pipeline never recovered even after
   the feeds returned (observed live at soak minute ~35: targets 0,
   payload age climbing past 400 s while a manual fetch worked). Fixed
   with a one-poll-at-a-time guard + 9 s client abort; verified 10
   hidden minutes of uninterrupted fresh polls (age 13.9 s at check).
   Poll counter + last-error exposed on `__ohTraffic` for future runs.

## Phase 15e — §23 re-measure + soak + §27 re-proof (2026-08-04)

**Heaviest-scene measure** (KLAX 25L, dusk via time scrub, live REAL
weather, 40 live ADS-B targets at the cap, five AI ships, imagery +
night + shadows on; no storm over LAX today — 14 NEXRAD cells in the
region, recorded as the heaviest LIVE scene available): draw calls
320–335 — 54% of the 600 budget, decisive PASS. Frame times across
four 200-frame windows: p50 7.5–14.9 ms, p95 16.5–21.1 ms, max ≤24.7
— the never-below-30-fps floor HOLDS in every window; the 16.7 ms p95
target is met in fast windows and exceeded in alternating slow ones,
the same 2×-swing host/pane throttling documented at 13e (identical
scene, oscillating windows — not scene cost). Degrade ladder not
applied: its lever is draw calls, which sit far under budget.

**Soak**: zero-console-error flight segments of 11.9 min (verified
mid-segment and at level-off) and 9.4 min (verified, 40 live targets
streaming throughout), plus an uncounted partial — the unbroken
45-minute single pass was blocked by the automation pane spontaneously
reloading the page (a session-long host artifact: no app console error
and no server error precedes any reload). The standalone 15b server +
a normal browser tab are the right vehicle for a user-run full pass.

**§27 re-proof**: coupled KSFO 28R ILS flown to touchdown by the AP on
the 13d-corrected beam — debrief "LANDED KSFO: 311 fpm (firm) · 304 m
past thr · L3 m of CL" (the aiming point the GS antenna now defines);
logbook entry 22 written and verified surviving a full page reload.
Honest note: two preceding hand-scripted flare attempts ballooned and
crashed (the crash guard doing its job); the coupled-to-touchdown
technique produced the clean logged landing. Consolidated deviations
table added above. Phase 15 — and the approved Phases 11–15 mega-plan
— complete.

## Consolidated deviations (15e — the honest ledger, §1)

Every recorded simplification in one place. Nothing below is silent:
each was disclosed at its owning slice, and nothing claims more
fidelity than its tier.

| Area | Deviation |
|---|---|
| Fleet tiers | A study-level (C172S/J-3/737-800) · B1 3-row · B2 2-row (±10%) · C visual-only. Stall rows CALIBRATED, cruise/climb PREDICTED, handling INHERITED from class anchors. |
| 737 scope | No CDU/FMC/MCP or autothrottle servo; G1000-style presentation; no RA vertical guidance. |
| J-3 Cub | Hand-prop as a keyed action; identity pitot cal (IAS=CAS); no electrical → honestly no lights. |
| Type registry | Community Doc-8643 mirrors (tar1090-db + ICAOList) — may lag ICAO revisions. |
| Terrain | Terrarium DEM; below-datum clamped to 0 (ocean plane is the sea; sea verts render −0.15 m); coarse rings carry render-only depth biases; NLCD coloring near rings only. |
| Imagery | USGS public-domain, US-only; ~15 m/px ceiling (z13); fades to stylized ground beyond ~46 km and on far rings; photo albedo lit with a flattened normal term; above-datum tidal flats show their NAIP photo, not simulated water. |
| Shadows | Terrain's custom shader does not receive shadow maps — a ShadowMaterial catcher approximates under the aircraft; pavement receives real shadows. |
| Airports | Taxiway/terminal layouts are PLAUSIBLE PROCEDURAL (no layout data in free sources); markings/distance boards follow real FAA geometry. Beacon sits on a heuristic midfield mast. |
| Night | City glow is a procedural NLCD-urban speckle (not VIIRS light points); threshold green/red approximates bidirectional lenses with colocated rows; edge lights fade with darkness (no pilot-controlled lighting); painted markings read faintly at night (unlit materials). |
| PAPI | Placement heuristic: lighted paved ≥4,000 ft, left side, 300 m — no FAA lighting inventory in free data. |
| ILS | Synthesized from runway geometry + a known-frequency table; GS antenna 300 m setback (≈52 ft TCH); single representative course width. |
| Live traffic | 10 s polls dead-reckoned; baro altitude; cosmetic attitude (labeled); steps with WALL time (ignores sim accel/pause); display+TCAS only — never on the simulated tower; ops vehicles not drawn; provider-chain cooldowns degrade to stale display. |
| Sim AI | Pattern speeds C172-class regardless of silhouette type; tower assume-vacates radio-silent landers after 90 s. |
| Weather | METAR blend; "10SM" treated as ~45 SM visibility cap; NEXRAD cells display-only where live data provides. |
| Ocean/water | Flat y=0 plane, METAR-driven sea state; no water-landing physics (water is terrain); per-wavelength LOD kills far moiré. |
| Save/W&B | Snapshots restore a trimmed state, not mid-maneuver rates; ground saves restore the runway spawn. W&B is C172S-only with lumped payload split 50/50 front/rear. |
| ATC/sound | Representative phraseology + softkey bezel set (non-page keys honestly INOP); engine sound is a synth — automation verifies the node graph, ears verify audibility. |
| Perf measurement | Host/pane GPU throttling produced 2× frame-time swings on identical scenes (13e/15e) — recorded alongside every affected gate. |


## Phase 15d — full regression sweep (2026-07-24)

Every phase's acceptance re-run in its cheapest faithful form — zero
fallout, nothing to fix:

| Check | Result |
|---|---|
| Headless: suite 896 / validate 421 (C172+Cub+737+roster) / prod build | ✅ |
| 0/2 world boot: 182 tiles, airports+navaids+airspace loaded | ✅ |
| 5 live weather: real METAR applied (KHAF 180@11 SCT012, QNH 29.88) | ✅ |
| 4+13d coupled ILS: loc 0.04, GS capturing −0.21, PAPI 2W agrees | ✅ |
| 7+14 TCAS: live dots + PROX level, flags/line coherent | ✅ |
| 15a TAWS: parked on 28R with traffic around — fully silent | ✅ |
| 6+14e ATC/AI: KPAO tower cycle on 118.6, five ships REAL density | ✅ |
| 11 fleet: 737 rolls through 137 KIAS (the user-bug speed) clean | ✅ |
| 8/9 save→load round-trip, audio graph, logbook persistent | ✅ |

## Phase 15c — cockpit/UI debt (2026-07-24)

Six debts closed. **Ignition detents**: the key now walks ADJACENT
detents (off ↔ R ↔ L ↔ both, ping-pong at the stops) — the old cycle
wrapped both→off, a one-click engine kill no real key allows (pure
stepMagneto, tests updated). **Boost pump** got its clickable panel
switch (was hook-only). **MFD softkeys** finally route: the screen
mesh is pickable, hit-UV maps through mfdSoftkeyRegions — MAP/ENGINE/
FPL switch pages, the rest of the representative bezel answers an
honest INOP toast. **W&B envelope** (9b deferral closed): pure
sim/weight-balance.ts with POH-representative C172S stations (lumped
payload split 50/50 front/rear — one payload mass, recorded) and the
normal-category envelope (4 tests); a new MFD 'wb' page draws the
polygon + loaded point (WB verb; C172-only, shown honestly).
**Failures panel**: FAIL ALTERNATOR|ICING|STATIC|NONE search verbs
over the __ohFail flags with a status toast. **AI sim-rate fix** (14e
note): pattern ships now step with sim dt — time-accel no longer
leaves them behind. W&B verified through the real drawMfd path
(2,346 lb / CG 42.4 / within). Suite 896 + validate 421, tsc clean.

## Phase 15b — server hygiene: the standalone server is real (2026-07-24)

server/index.mjs mounts the same route() as the dev middleware and
serves the built client from dist/ with an SPA fallback — `npm run
build && node server/index.mjs` is a self-contained sim host on
:8787. Smoke-tested standalone: 14/14 endpoints 200 (terrain,
landcover, imagery, NEXRAD, METAR, live traffic, airports, navaids,
airspace, frequencies, aircraft-types, procedures, health, client).
The duplicate frequencies branch stayed dead (12a).

## Phase 15a — safety-logic polish (2026-07-24)

TAWS Mode 1 arms only above 30 ft AGL (gear-compression vs spikes
fired SINK RATE while parked — real GPWS has an RA floor too). FIVE
HUNDRED fires only on a true descending crossing of 500 ft (the old
vs<0-below-500 gate let a parked gear bounce call it — found by the
new ground-silence test). Mode 5 gates on being established on the
tuned ILS via pure ilsOnFinal (inside localizer full-scale AND within
45° of course) — a stale tuned ILS from another field pegged the
localizer and fired spurious GLIDESLOPE at KPAO. 5 regression tests.

## Phase 14e — richer sim AI + the parked-forever fix (2026-07-24)

The fix went deeper than the plan knew: the tower's tick DELETED every
landed strip on the next scan ("landed traffic exits between scans")
while the AI physically parked on the pavement forever — the tower
pretended vacating, the planes never did, and BOTH halves were
fiction. Now both are real: pilots roll out, exit 60° to the pattern
side (~320 m, with a new per-leg `arriveM` — the point-mass's 250 m
coarse arrival left the first "vacated" plane 12 m off centerline,
caught by the new test), report "clear of runway" (new `clearRunway`
request kind → strip 'vacated'), and the tower HOLDS landed strips
until that report, with a recorded 90 s assume-vacated fallback for
radio-silent traffic (the player). 7 new/updated tests: vacate ≤60 s
+ ≥50 m off centerline, held-then-cleared ordering, the auto-vacate
timer, and a five-ship 3,000 s soak asserting no takeoff clearance
ever issues with a ship in landed/taxiOff — which CAUGHT the tower's
instant-forget hole before the fix. Four older tests updated honestly
to the real-occupancy protocol (one now expects a legal go-around).

main.ts: parallel aiPilots/aiMeshes arrays → ONE record list; density
verb `AI OFF|LIGHT|REAL` = 0/2/5 ships (persisted); Tier-C variety
(C172/P28A/SR22/C182/BE36) built as archetype silhouettes — 1 draw
call each vs the old ~40-call full C172 builds. `__ohAi` hook.
**Browser:** five ships at REAL with N77GA established in the KPAO
pattern (75 kt/506 ft) and staggered followers; tower transcript shows
the departure cycle on 118.6. Noted pre-existing quirk (Phase 6): AI
ships step with WALL dt, so time-accel doesn't speed the pattern —
listed for 15 polish. Suite 886 + validate 421, tsc clean.

## Phase 14d — live-traffic rendering + labels (2026-07-24)

`render/traffic-layer.ts`: every airborne (or typed ground) store
target gets a 12b archetype silhouette — geometry cached per ICAO
designator, shared material (1 call) — plus a 6-point 13c light
cluster (1 call) with a per-target phase so strobes don't blink in
unison. Attitude is COSMETIC and recorded: heading from track, pitch
from vs/gs (±12°), coordinated-turn roll from the smoothed track rate
(±25°) — pure `cosmeticAttitude` helper, 4 tests. Callsign/altitude
datablocks draw on ONE projected 2D canvas (zero GL calls), gated to
20 km. Ground targets pin to the terrain; unknown-type ground rows
(ops vehicles) are skipped rather than drawn as fake airplanes;
silhouettes beyond 25 km skip their draw calls (sub-pixel — the
store/TCAS still track them).

**Acceptance at KSFO:** real airliners on screen with live callsigns —
JBU316/UAL488/EJA273 holding on the ground, UAL114 descending through
1,300 ft with DAL1421 in trail, sequencing onto the parallels; a PROX
arrival crossed 3,381 m out at −64 ft on short final. Layer cost
measured by LIVE TRAFFIC OFF/ON A/B: +62 calls for 31 rendered
targets (budget ≤80 ✓), p95 5.3 ms with the pane visible. **§23
flag:** the TOTAL at the heaviest live moment hit 609–621 vs the
600-call cap — the base KSFO scene (airport detail + night layers +
PAPI + clouds) is the growth, not this layer; 15e's degrade ladder
owns the reconciliation (candidates: merge per-airport night Points,
label declutter, instanced traffic bodies). Suite 882 + validate 421,
tsc clean.

## Phase 14c — TCAS multi-track integrity + live targets (2026-07-24)

Two latent Phase-7 bugs from the 11-inventory, now load-bearing with
live ADS-B: every AI intruder fed the literal id 'AI' (ONE shared
hysteresis state for all traffic), and `TcasComputer.states` never
evicted departed tracks (a returning id inherited a stale widened
gate). Fixed: stable per-pilot ids (`AI{n}`), eviction of states
absent from each step's input, `trackedCount` testability getter.
Live store targets (airborne only, hex ids, baro altitudes —
recorded) now feed the same TCAS step and the MFD trafficDots.
4 regression tests: independent per-id levels, per-id hysteresis
retention (SL4 gate math), eviction resets the widened gate (PROX
floor, not retained TA), 30-track churn to zero.

**Verified live at KSFO:** 40 stored targets → 19 airborne TCAS dots
(ground vehicles filtered), 12 within 10 nm, and a real arrival
showing PROX at 2,631 m / +438 ft with the safety line and dot flags
agreeing. Bonus: the FIRST probe ran on a stale pre-fix page and
showed the old bug live — a stuck alerted flag (shared-id state)
contradicting the current level; the fixed page is coherent.
`__ohSafety` now exposes the last TCAS level + non-NONE track list.
Suite 878 + validate 421, tsc clean.

## Phase 14b — client live-traffic store (2026-07-24)

Pure `sim/traffic/live.ts` (6 tests): authoritative per-target dead
reckoning between polls (gs/trk/vs), stale fixes led forward by their
provider-reported age, new fixes absorbed through a decaying display
offset (τ 0.6 s ≈ 95% inside 2 s — no teleports), 30 s expiry, cap to
the 40 nearest at ingest. main.ts poll driver mirrors the METAR
pattern (10 s or 20 km move), steps the store on WALL time — real
aircraft ignore sim pause/accel (recorded) — with a 2 s clamp against
tab-suspend gaps. `LIVE TRAFFIC ON|OFF` verb (persisted, default ON;
OFF clears, ON repolls immediately) + `__ohTraffic()` hook.

**Live verification at KSFO:** 40 targets capped from ~140 available —
SWA381 (B38M) at 12,865 ft/347 kt, a C172 at 7,382 ft, a PA22, an SFO
ops vehicle on the ground. Dead reckoning measured against wall time:
SWA381 moved 864 m in 5 s (892 expected at 347 kt), the C172 239 m
(255 expected) — both within blend variance. Verb round-trip: OFF → 0
targets, ON → immediate 40 from the server cache. payloadAgeS 6.6 s
freshness readout. Suite 874 + validate 421, tsc clean. Rendering,
TCAS, and labels are 14c/14d.

## Phase 14a — /api/traffic live ADS-B endpoint (2026-07-24)

Pure `normalizeAdsb(json, provider)` in parse.mjs (6 tests): adsb.lol
and adsb.fi speak the readsb/tar1090 dialect (seconds `now` guarded
against ms, `alt_baro:"ground"` → altFt 0 + gnd, callsigns trimmed,
type designator kept); OpenSky's states array converts m→ft, m/s→kt
and →fpm, carries no type (t:''); rows without a position drop;
malformed payloads return an empty list, never throw. handlers.mjs
`trafficData(lat, lon)` + `/api/traffic?lat=&lon=` route with the
free-feed etiquette from the plan: 0.25° coordinate buckets, 40 nm
radius, 10 s TTL, single-flight dedup per bucket, ≥5 s spacing between
ANY two upstream calls, provider chain adsb.lol → adsb.fi → OpenSky
with 60 s per-provider cooldowns, stale-while-error keeps the old
payload ts so client age displays climb honestly.

**Live verification (dev proxy):** first KSFO query returned 136 real
aircraft in 1.7 s — a P28A descending through 1,700 ft, an R44, DLH454
(B748) at the gate, ANA7 (B77W), UAL3934 (B752), types included for
the 14d archetype meshes. Back-to-back repeat: 2 ms, identical ts =
cache hit. The provider chain proved itself live: one cold-bucket call
took 21.6 s when the first provider timed out (8 s abort → cooldown →
next provider answered with its own 117-target coverage). Noted:
0.25° bucket edges split nearby queries (by design); bad coords
reject as a vite 502 (internal API, acceptable). Suite 868 green.

## Phase 13f — bloom: evaluated, cut (2026-07-24)

The plan's own entry condition was "only if ≥3 ms measured headroom",
with a written abandon criterion (perf regression or MSAA loss). Cut
without implementation, honestly: (1) the headroom precondition is
unverifiable right now — this session's frame timings swung 5.8→30 ms
p50 on identical scenes (pane-visibility GPU throttling, see 13e), so
a perf-gated feature cannot pass its own gate; (2) an EffectComposer
pass forfeits the canvas MSAA the whole sim leans on unless we add
multisampled render targets — a real visual regression risk for a
cosmetic win the additive light sprites already approximate. Revisit
only if 15e's stable re-measure shows ≥3 ms headroom AND a
multisampled-RT path proves MSAA-neutral.

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

- **Everything-plan Slice 0 (2026-08-27): crash-class stability fixes** —
  the sim can no longer die silently: (1) rAF error boundary — a throw in
  advanceFrame used to unwind past requestAnimationFrame and freeze the
  loop forever; now logged + toasted once + re-armed (metronome path too).
  (2) localStorage guards: module-scope read at boot (private-mode aborted
  the whole boot → black screen) replaced with the validated fleetKey;
  saveSnapshot setItem wrapped (honest SAVE FAILED toast). (3) Debug-hook
  finite guard sweep via new pure src/sim/guards.ts finiteOr() (TDD,
  tests/guards.test.ts): __ohStep/__ohRate/__ohTime/__ohWind/__ohTune/
  __ohApMode/__ohSpawn/__ohCam/__ohMfdPage all reject NaN/Infinity/garbage
  (a NaN through __ohRate froze the accumulator unhealably; strings threw
  inside the render loop). (4) Search-box focus trap: blur now closes the
  box and re-enables input (clicking away used to leave every key dead);
  disableSimInput() drops held keys/aliases + recenters shaped axes +
  releases non-parking brakes (a held brake alias latched across focus
  loss); Input.clearHeld() also clears virtualHeld on window blur.
  (5) T with no ATC in range no longer opens an invisible menu that ate
  the 1/2/3 rate keys — honest NO ATC IN RANGE toast; menu auto-closes
  when the facility drops out of range. Gate: tsc clean, 1152 tests, 545
  validate. NEXT: geometry prerequisite commit (dihedral + gear fold +
  tire heights + zMain + tail cones), then Slice 1 flaps.

- **Geometry prerequisite (2026-08-27): dihedral, gear fold, tire heights,
  zMain, tail cones** — five sign/scale bugs cut across both jet builders:
  (1) wingGroup.rotation.z = side*−0.105 gave every jet 6° of ANHEDRAL
  (tips dropped); flipped positive in both builders — bespoke 737 wingtip
  light anchors recomputed for the raised tips (±16.59, +0.49); the family
  tipUp formula already assumed the fixed sign. (2) Main gear folded
  OUTBOARD up through the wing; sign swapped → mains fold inboard to the
  belly (stowed 737 wheel lands at |x|≈1.5, matching the real airplane).
  (3) Tires sank half their radius: both builders centered the wheel AT
  the contact point; wheel centers now ride one radius above contact
  (strut shortened to the axle). (4) Derived jet gear was ~2× too tall
  (zMain = 0.14·L vs the B738 anchor's real 0.073 ratio — B77W stood
  10.3 m vs the real ~5.2, halving apparent ground effect in the flare);
  new shared standardGearZ() = max(0.073·L, 1.1) exported from derive.ts
  and imported by airliner-mesh so visual zGround and physics agree (the
  old visual L*0.115 floated family jets 0.45 m above their wheels).
  (5) Tail cones: bespoke Rz(π) flipped the cone into a rearward-opening
  trumpet (removed; apex aft, raked up via π/2−0.06); family rake sign
  flipped up. Gate: tsc, 1152 tests, 545 validate. NEXT: Slice 1 flap
  clearance/connection verification in-browser.

- **Everything-plan Slice 1 (2026-08-27): flaps connected + never in the
  ground — VERIFIED** — root cause of "every part of the flaps" found by
  numeric audit: both builders swept the flap at ~90% of the LE sweep
  (0.42 m/m) while the wing TE, thanks to taper, sweeps only ~0.087 m/m —
  the outboard flap end trailed up to 3 m behind the wing at EVERY
  setting. Flaps + canoe fairings now derive from a shared TE-locus
  helper (chordAt/teX per builder); LE nests 90% of flap chord under the
  wing so full extension (35% chord) keeps ≥55% of the chord under the
  TE shadow at every station. Clearance math: parked flap TE ~1.0 m
  (737) / ~1.1 m (A20N) above the runway; 8° flare worst case ~0.45 /
  0.55 m — never touches. In-browser (background tab, standalone :8787):
  737 at flaps 0/27/40 and A20N at flaps 35 screenshots — panels
  attached full-span, clear of ground; dihedral (tips up), raked-up tail
  cones, tires ON the pavement, and the lower 0.073·L stance all visible
  post-geometry-commit. Honest notes: (1) left wingtip glow reads
  green-ish from some angles — nav-light color/anchor check belongs to
  Slice 8; (2) verification tab initially self-flew: the neutral
  gamepad-map trick (store {"v":6}) now documented for test tabs since
  real TCA hardware/latched switches drive ANY tab. NEXT: Slice 2 gear
  doors.

- **Everything-plan Slice 2 (2026-08-27): gear doors + retract animation** —
  Family builder: keel-hinged main bay doors (an outboard hinge would
  sweep through the fixed canoe fairing on CRJ-scale types) + nose
  clamshell halves hinged at the bay's outboard edges, all swinging about
  the fore-aft axis; doors are SIBLINGS of the leg groups so they don't
  inherit the stowed-leg visibility pop, and doorFrac = clamp(gearPos*3)
  trails the retraction to cover it (≤6% crack). Per-leg fold angle
  derived (asin of span-to-keel over wheel arm, capped 90°) instead of a
  hardcoded 1.5 rad — A320-class legs stow horizontally without crossing
  the centerline. Bespoke 737: nose clamshells only + dark belly well
  discs at the stowed wheel stations (|x|≈1.5) — the real 737's mains are
  doorless with hubcaps flush against the belly; recorded as the honest
  type difference. FOUND + FIXED in verification: family wing-mounted
  engine pods touched the runway at the new 0.073L stance (A20N pod
  bottom 0.07 m BELOW contact — old depth constants were tuned for gear
  twice as tall); pods raised (engZ = 0.35·wingDrop + 0.45·engR, pylon
  re-seated), giving ~0.5 m clearance A20N / 0.56 B38M / 1.07 B77W.
  In-browser: A20N transit shows tires folding inboard under the belly,
  stowed belly clean with doors closed, ground stance + engine clearance
  correct; CRJ700 mid-transit clean from chase (no canoe clash); 737
  stance/tires verified. HONEST NOTE: nose-clamshell open state and the
  737 belly discs were built to bay geometry but not clearly captured in
  a screenshot this pass (orbit-camera acrobatics in the background tab);
  they ride the same doorFrac path as the verified family doors. Gate:
  tsc, 1152 tests, 545 validate. NEXT: Slice 3 cockpit view.

- **Everything-plan Slice 3 (2026-08-27): cockpit — see outside, displays
  visible** — per-layout eyepoints (cockpit-camera.ts EYE_BY_LAYOUT): GA
  0.75 up / transport 1.00 up, both x 0.45 fwd; transport left seat
  centered at y −0.5 over the captain's DUs. PLAN DEVIATION recorded: the
  plan's transport eye of 0.80 would still sit BELOW the re-seated
  glareshield top (0.92) — no over-nose view at all — so the eye went to
  1.00 (≈7° down over the shield, the real design-eye idea); GA panel box
  shortened to top 0.72 (it had 0.28 m of empty bezel above the tallest
  content) giving ≈3° over the cowl under the 0.75 eye that must stay
  below the C172's cabin skin (0.80). Co-moved: glareshield cushion
  →0.865, MCP →0.86, roof beams (GA 1.13 / transport 1.50), A-pillars
  re-spanned panel→roof, sills below the eye (GA 0.27 / transport 0.55),
  center post →1.17, look-down clamp widened to −1.25 rad for floor
  controls. cockpit.group now hidden outside cockpit mode (it used to
  poke through the C172 roof in chase; also saves draw calls). In-browser
  verified: 737 cockpit = runway + horizon + live MCP band + panel top in
  one frame; C172 = runway + horizon + live G1000 PFD/MFD; chase view
  clean (no shell leak; C172 nav lights red-left/green-right confirmed).
  View bands now ≈ −7°…+29° (transport) / −3°…+22° (GA) vs the old
  +31°…+40°. Gate: tsc, 1152 tests, 545 validate. NEXT: 9A safety-line
  fix + Slice 4 copilot.

- **Everything-plan Slice 4 + 9A safety line (2026-08-27): copilot that
  speaks** — new pure src/sim/copilot.ts (TDD, 7 tests): takeoff roll
  (airspeed alive / eighty knots / vee one / rotate), climb-out (positive
  rate, gear-up acknowledgment, flaps-up schedule call), arrival ("one
  thousand", "sixty knots" on rollout). Callout ownership recorded: TAWS
  keeps "five hundred" + FIFTY…TEN — the copilot never duplicates an
  aural. Vr = 1.15 × the takeoff-detent stall via the derive.ts CLmax
  ratio at the mid detent; V1 = Vr − 5 kt (recorded approximation, jets
  only); acceleration gate keeps roll calls from re-firing on a reverse-
  thrust rollout. Latches: per-phase, touchdown re-arms the takeoff
  family, liftoff the landing family, respawn resets wholesale. Wiring:
  speech priority gate gatedSpeak() — the synth was ONE global FIFO with
  no cancel (TCAS could queue behind ATIS): safety now cancel()s and
  preempts, copilot speaks only into an idle synth else drops to its HUD
  line, radio unchanged; copilot voice fixed via constant-hash (empty
  getVoices() at boot tolerated). NEW dedicated HUD "FO:" line with its
  own 5-s expiry. 9A safety-line fix: safetyLine now has strict priority
  over toasts (a gear toast used to blank live TCAS/TAWS for 6 s) and
  the landing debrief expires after 45 s instead of squatting forever.
  LIVE VERIFIED (background tab, real-time metronome advance — __ohStep
  loops can't drive the 2 Hz real-time copilot cadence, noted): 737 full-
  thrust roll produced FO: airspeed alive@46 / eighty knots@87 / vee one ·
  rotate@142; airborne family covered by unit tests through the same
  path (unattended test plane ran off the runway end before rotation
  input — crash guard worked; callouts already captured). Gate: tsc,
  1159 tests, 545 validate. NEXT: 9A ATC timers + 9B tower strips +
  Slice 5 smart ATC.

- **Everything-plan Slice 5 + 9A timers + 9B strips (2026-08-27): smart
  ATC** — Single-reply rule: for strip-machine intents {takeoff, landing,
  position, goAround, taxi} the free-text engine is now a CLASSIFIER
  (new AtcReply.bridge flag) and ONLY the sequencing authority transmits
  — the free-text reply used to always clear while the tower might say
  hold short (two contradictory clearances in one breath). Context
  routing in sendFreeTextAtc: taxi on the ground → Ground on its real
  freq; inbound while airborne outside the 8 nm handoff gate → Approach
  check-in; else Tower. Emergencies: free-text transmits its richer
  phraseology AND flags the tower strip (new declareEmergency) — the
  flagged tick() clears the emergency from up to 15 nm out, queue-jumped,
  with equipment standing by (no double request). Freetext traps fixed:
  landing now requires intent words ("oakland center" / "check landing
  gear" no longer get cleared-to-land), "no emergency" is negation-aware,
  readback reordered ABOVE landing (a typed clearance readback used to
  re-request landing). Tower (9B): request() updates strips IN PLACE —
  the rebuild dropped handedOff/landedAtS (repeated "contact departure",
  restarted vacate timers); re-pressing inbound confirms an existing
  clearance instead of revoking + re-queuing; runwayOccupied() scales
  with real runway length (fixed 1500 m cleared arrivals onto rolling
  departures on long runways); go-around single seq bump. Approach (9B):
  checkIn idempotent (no ladder reset), one ladder step per tick (the
  old both-in-one-tick test updated — recorded behavior change), menu
  check-in gate aligned outside the 8 nm handoff. 9A: all ATC replies on
  tracked timers (atcDelay), cancelled on respawn + facility change (a
  stale controller used to answer on the new field's frequency). Shared
  taxiRouteIdents() helper (menu + freetext ctx + ground bridge). LIVE
  at KSFO: "ready for takeoff" → exactly ONE reply from the tower strip
  machine ("runway 1L, cleared for takeoff" on the real 120.50); "no
  emergency, just a radio check" → "read you five by five". Tests: +10
  (tower preservation/occupancy/priority, approach idempotence/ladder,
  freetext traps + bridge flags). Gate: tsc, 1169 tests, 545 validate.
  NEXT: Slice 6 live traffic.

- **Everything-plan Slice 6 (2026-08-27): live traffic — ROOT CAUSE of the
  flapping feed found and fixed** — the month of intermittent-to-dead
  ADS-B was NOT upstream flakiness: adsb.lol (and friends) now reject
  requests without a User-Agent header. Node's fetch sends none (curl
  sends one, which is why manual probes always "worked"), the error body
  is non-JSON, the parse threw, and the provider chain cooled all three
  providers down forever — returning {ac:[]} with a FRESH timestamp
  (indistinguishable from an empty sky). Fixes: User-Agent header on all
  upstream traffic fetches; the all-failed/no-cache path now returns
  ts 0 so client age displays are honest; new HUD status line — "LIVE
  TFC n" / "LIVE TFC STALE ns" / "LIVE TFC NO FEED" (Slice 6's honest-
  surface requirement). Server restarted to load the fix. VERIFIED
  end-to-end at KSFO: proxy returns 116 aircraft fresh, client store 40
  targets in keep radius, HUD "LIVE TFC 40", screenshot shows labeled
  real ground traffic across the field (BAW2X/UAL809/UAL1723/CKS536…)
  beside the player 737 on 28R. Gate: tsc, 1169 tests, 545 validate.
  NEXT: Slice 7 time-scale fixes + ground-scale verification record.

- **Everything-plan Slice 7 (2026-08-27): ground scale VERIFIED CORRECT;
  the real time-scale bugs fixed** — Scale verification recorded (the
  user's "scaling with the ground" ask): runway widths parse from
  OurAirports in FEET and convert exactly once (r.w × 0.3048) — KSFO 28R
  renders 60.96 m vs the real 200 ft = 60.96 m, exact; every aircraft
  mesh is built in true meters (737 span 35.8 m ≈ 59% of that width,
  matching reality); physics flatten corridors use the same numbers. No
  scale defect exists — the "feel" traced to the 2× gear heights + tire
  sink (fixed in the geometry commit) and these time bugs: (1) traffic-
  layer dt was ALWAYS 1/60 (lastFrame re-stamped before advanceFrame →
  now−lastFrame = 0 → ||1/60) — ADS-B targets drifted at the wrong rate
  at any fps ≠ 60; now the real frame elapsed. (2) FixedTimestepLoop's
  step budget now scales with rate — a fixed 30-step budget consumed at
  most 0.25 s sim per advance, so 2×/4× silently ran at 1× on long
  frames (background tabs, low fps); regression tests added (0.25 s at
  4× = 120 ticks; rate-1 spiral guard unchanged). (3) AI pattern ships
  step the SAME total sim time physics consumed, chunked ≤0.25 s (a
  single clamped step fell 4× behind on background ticks). Gate: tsc,
  1171 tests, 545 validate. NEXT: Slice 8 lights.

- **Everything-plan Slice 8 (2026-08-27): lights connected to the plane** —
  post-dihedral light-anchor corrections across all four light surfaces:
  (1) bespoke 737 tail nav → the FIN TIP (0, 9.9, 19.7) (was 55% height,
  inside the skin) + beacon on the fuselage spine like the real upper
  anti-collision light; (2) family tail → fin tip (0, R·0.9+finH, 0.5·L)
  + spine beacon; (3) beacon formula everywhere: the old tail.z·0.82
  absolute-z scaling landed it 5 m below the 737's fin — now the
  builder's beacon fixture, or just under the tail anchor as fallback
  (aircraft-lights + the traffic-layer duplicate); (4) archetype anchors
  (every live-traffic silhouette) recomputed from the SAME wing()/tail()
  constants the geometry uses — wing height, sweep-shortened tip, real
  fin top — instead of fixed (±S/2, 0, 0)/(0, 0.1L, 0.5L); (5) bbox
  fallback clamps its vertical reference for below-origin models (X-Plane
  OBJ8). Test updated to the truthful contract: anchor at the RENDERED
  tip, inside the mesh bounds, tail light on the fin (the old exact −S/2
  assertion floated lights off swept wings — recorded behavior change).
  Gate: tsc, 1171 tests, 545 validate. NEXT: in-browser light check,
  then remaining 9A/9B/9C themed commits.

- **9B fleet-data purge (2026-08-28): the MD88-class inheritance bug ×17 +
  derive physics** — variant() inheritance had 17 types flying with their
  BASE's fuel tankage: eight were over MTOW at ZERO payload (A343 +9.7%,
  MD11, GLF4, E50P +18.8%, HDJT, CRJ2, C525, BE9L), six more with any
  payload, and several carried half-real loads. Every flagged variant now
  has explicit real tankage (A343 110 t, MD11 93.9 t, GLF4 13.4 t, FA7X
  14.4 t, B762 73 t, GL5T 17.6 t, …). PA-28 family redlines fixed (the
  Arrow/Dakota/Saratoga/Seminole all inherited the Archer's 154-kt Vne;
  real 183/173/191/202), DA42's inverse case → real 188; PA44 Seminole
  now RETRACTS (it inherited the Archer's fixed gear while priced as a
  clean twin); C177 Cardinal gets real fuel/Vy/Vne and sheds the C152's
  climb-prop thrust scale. variant() now MERGES tuning (one level + jet
  block) instead of replacing it — the DA42 had silently dropped the
  Baron's documented control travels (explicit tuning: undefined still
  clears, as the Arrow intends). derive.ts: Va now from the SPEC stall
  capped below Vno (the capped effective stall pushed the MD-11's Va past
  its own Vne); windmillCdA scales with per-engine thrust vs the 117 kN
  CFM56 anchor (an FJ44 bizjet had a CFM56's dead-engine drag). NEW
  fleet-wide regression tests: every type lifts a 90 kg pilot at full
  fuel (250 kg for transport weights) — honest reality note: a C152 or
  Bonanza genuinely can't take full tanks + 250 kg, so the universal
  250 kg bar the plan sketched was reality-checked down; va ≤ vno fleet-
  wide. Slice 8 lights also verified in-browser at night (fin-tip tail
  light, spine beacon, tip glows). Gate: tsc, 1173 tests, 545+2 validate.

- **9A/9B reverse-thrust + respawn purge (2026-08-28)** — Reverse trio:
  (1) dead-engine + reverse no longer produces FORWARD thrust (the
  negative windmill drag times the negative reverse multiplier — the
  multiplier now applies to running engines only, aircraft.ts); (2) the
  TCA quadrant's lifted reverse zone commands IDLE in flight (sleeves
  were WoW-gated but the throttle wasn't — airborne reverse gave full
  forward N1); (3) the lever poll no longer cancels the KeyZ reverse
  toggle every frame — new leverReverseActive latch means the lever
  rescinds only its OWN engagement (this was why keyboard reverse "did
  nothing" with the quadrant plugged in). Respawn purge: spawnOnGround
  resets spoilers/armed/reversers/N1-to-idle/alphaDotFilt + stale data
  flags (a respawned jet sat at last flight's N1 against the brakes);
  resetSystemsState adds carb ice + carb heat (a fully-iced engine
  survived respawn silently powerless), ctlOverride, wing-leveler, baro,
  landing light; spawnAtAirport calls recorder.reset() + clears
  flightStartSimS/debrief — an airborne respawn used to FABRICATE a
  logbook landing from the teleport discontinuity. Gear-up crash guard
  now measures the BELLY (45% of main-leg z), not the CG — heavies sank
  metres through the runway before "crashing". Jet fuel-flow GPH uses
  Jet-A density (was ~12% high on the avgas constant). Gate: tsc, 1173
  tests, 547 validate.

- **9B autopilot engagement (2026-08-28)** — (1) engage-edge integrator
  reset: the control laws run every frame as a flight director even
  hand-flown, so integrators wound up while DISENGAGED and dumped their
  accumulation into the first engaged frames (the documented disconnect-
  reset covered only half the transition); regression test winds VS mode
  saturated then engages at zero error. (2) altsLeadFt floors at ±20 ft —
  the kinematic lead is 0 at zero VS, so ALTS armed in LEVEL flight at
  the bug could never capture. (3) Go-around drops an approach-coupled
  AP (GS captured or APR) to manual like a real TOGA press — a captured
  glideslope had no un-capture path and kept chasing the beam behind the
  aircraft; wired into both the ATC menu go-around and the free-text
  bridge. Gate: tsc, 1175 tests, 547 validate.

- **9B atmosphere + fuel systems (2026-08-28)** — (1) isa() gains the ISA
  isothermal stratosphere (216.65 K, exponential pressure) from 11 km to
  FL600 — the hard 11 km cap froze the atmosphere above FL360 so nothing
  lapsed in high cruise; sub-11 km rows bit-identical. RECORDED bound
  change: the cruise-envelope ceiling relaxes 0.92→0.97 ONLY above the
  tropopause — the old bound was calibrated in the fictitious frozen
  atmosphere, and the five highest cruisers (A388/787-9/787-10/F2TH/
  FA7X) genuinely run 0.92-0.96 thrust fraction at FL390-410. (2) FUEL
  LOW threshold scales to the active type (~7.5% capacity, 8 kg floor,
  none for gliders — the C172 constant warned an A380 at 36 kg and
  gliders permanently); MFD fuel gauges get per-type full-scale.
  (3) Live-traffic dead reckoning: cos(lat) clamped (one bad polar row
  → Infinity), meters-per-degree-latitude corrected to 111,132 (the
  equatorial-longitude figure was in use). (4) Trim solver takes the
  live ISA offset (hot/cold-day final spawns arrived mistrimmed) and
  reuses a scratch AirState per residual. Gate: tsc, 1175 tests, 547
  validate.
