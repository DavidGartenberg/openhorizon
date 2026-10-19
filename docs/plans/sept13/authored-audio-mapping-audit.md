# Authored audio: live input mapping audit

2026-09-18. Bounded source/metadata inspection only. No implementation, test run, native rendering, browser, hardware, speaker playback, asset copy, or original-file modification by this audit. The latest user update in `sound-brief.md` authorizes local original assets and supersedes its older no-copy wording. This document narrows the live integration gate in `authored-audio-runtime-design.md`: **B738 is not the first fully mapped live event candidate. Prefer a scoped ASK21 airflow slice, with C172 engine next.** Neither currently has all spatial/snapshot plumbing implemented. The separate `authored-audio-transport-plan.md` deliberately starts with diagnostic scenario controls and no main-flight wiring; its transport work does not depend on resolving every live mapping here.

## Evidence and scope

Current sources: `src/main.ts` fixed-step systems and render/audio boundary; `src/sim/aircraft.ts`, `turbofan.ts`, `propulsion.ts`, `aircraft/derive.ts`, `aircraft/roster-core.ts`; `src/render/cockpit-camera.ts`, `local-aircraft.ts`, `xplane-manifest.ts`. Installed source root: `/Users/davidgartenberg/X-Plane 12/Aircraft/Laminar Research`. Read the original B738, C172SP and ASK21 `.snd`, `GUIDS.txt`, and relevant ACF values there.

Cached event metadata: `server/cache/speech/xplane-probe/{b738-studio-event,c172-cruise-event,as21-clean-event}.json`. Their numeric probe values are manually chosen offline fixtures, **not simulator mappings**. `bank-studio-inventory.json` gives event counts and hashes, not every event's parameter descriptions. There is no cached parameter enumeration for ASK21 `ext_airflow` or the cockpit snapshots. The earlier `xplane-audio-audit.md` records exterior airflow inspection as IAS/crash/automatic distance: these map to `d.kias`, `aircraft.crashed`, and FMOD transforms respectively. Retain that useful evidence, but persist/recheck exact names, ranges, flags and scope before integration; cockpit snapshot parameters remain unenumerated here. GUID presence alone does not prove parameter completeness or playback.

Below, slash names are X-Plane datarefs; cached FMOD parameter names replace slashes with dots. Preserve exact case, array index, and `PARAM_DREF_IDX` substitutions in an explicit table. Ranges are cached FMOD metadata ranges, not new physics clamps.

## B738 engine: required gaps prevent faithful initial integration

`/b738/engines/engine_1` = `{0e9a6d1d-5fab-4f71-95c8-cd8abdb8f653}`, `VEH_PART engine 0`, index 0. Original start/end: `sim/flightmodel2/engines/N2_percent[0] != 0` / `== 0`. Engine 2 is a distinct event `{c5669dc5-20de-4c73-9355-ca8c0ce16aab}`; do not assume engine-1 metadata proves its parameter set.

| Required engine-1 input | Current state / exact gap |
| --- | --- |
| `sim/flightmodel2/engines/N1_percent[#]` (0–105%) | `aircraft.data.n1Pct` / `jetState.n1Pct`. One shared spool for matched engines; no independent per-engine N1. |
| `sim/flightmodel2/engines/N2_percent[#]` (0–105%) | **Absent.** `turbofan.ts` explicitly excludes N2. Also required for attachment lifetime. Never use N1, throttle, a fixed value, or a second copy of shared state as N2. |
| `sim/flightmodel2/engines/jetwash_mtr_sec[#]` (0–400 m/s) | **Absent.** TAS and thrust are not exhaust velocity. Needs a supported physical model/adapter; no arbitrary conversion. |
| `laminar/B738/sound/thrust_delta[#]` (−1…1; default −1) | **Absent.** Local total `d.thrustN` is available, but this custom normalized parameter's semantics are not established by the metadata. Do not assume derivative(thrust), throttle delta, or zero. |
| `sim/flightmodel2/engines/engine_is_burning_fuel[#]` (0/1) | Captain systems exposes `engine1Running`/`engine2Running`; physics has one total fuel flow and `jetPowerFactor`. These are live group states, not independent measured combustion/spool state. Bind only through an explicitly documented matched-engine restriction; single-engine behavior is not faithfully supported. |
| `sim/cockpit2/gauges/indicators/altitude_ft_pilot` (0–40000 ft) | Reuse the cockpit's `indicatedAltitudeFt(pitotReadings.altFt, baroSetInHg, qnhInHg)`. `d.altitudeFt` is geometric MSL and is not the same gauge under nonstandard settings/static failure. |
| `sim/cockpit2/gauges/indicators/radio_altimeter_height_ft_pilot` (0–1000 ft) | `d.aglFt` supplies geometric terrain clearance. No separate radio-altimeter instrument/failure/slant model was established; explicitly label this adapter's limitation. |
| `sim/operation/sound/inside_any` (0–1) | Derive from authored spaces and listener position; not implemented. |
| `Distance`, `Event Cone Angle` | FMOD automatic/read-only parameters (cached flags 3, types 1/2). Supply real 3D transforms, never assign them. |

N2, jetwash, custom thrust delta, and engine attachment transforms are required for faithful execution of this engine event. Missing N2 alone rules out a truthful B738-first gate. Reverser sound also consumes N2; actual `aircraft.reversePos` does not remove that blocker. Existing offline B738 PCM proves runtime rendering with fixtures only.

## C172 engine: genuine RPM/combustion, constrained configuration needed

`/c172/engines/engine` = `{a5b8d7bc-8098-4d46-828d-71991b0de687}`, `VEH_PART engine 0`, index 0. Original start conditions jointly require `has_crashed == 0`, `sim/operation/failures/rel_engsep0 != 6`, and rotation speed `[0] > 1 rad/s`; `EVENT_AUTO_END_FROM_START_COND` controls ending. Preserve conjunction; do not start solely from engine-running status.

| Input | Mapping / gap |
| --- | --- |
| `sim/flightmodel2/engines/engine_rotation_speed_rad_sec[#]` (0–314 rad/s) | `aircraft.prop.omegaRadS`, equivalently `d.rpm * Math.PI / 30`. Actual simulated shaft rotation, including windmilling/spin-down. `engineStartState.rpm` is a separate start-system state and must not replace the propulsion RPM. |
| `sim/flightmodel2/engines/engine_is_burning_fuel[#]` | For this single engine, `aircraft.prop.fuelFlowKgS > 0` reflects the last propulsion step's modeled fuel burn, including mixture/fuel gating. `aircraft.engineRunning` alone is insufficient. Sample all propulsion fields coherently; systems update after `aircraft.step`, so do not combine future systems state with prior-step RPM/flow. |
| `sim/flightmodel2/misc/has_crashed` | `aircraft.crashed`; use this even when the crash early return leaves `FlightData` stale. |
| `sim/operation/failures/rel_engsep0` | No detached-engine model. A supported intact-engine-only configuration can explicitly supply “not failed”; do not claim engine-separation coverage. |
| `sim/flightmodel2/misc/door_open_ratio[0]`, `[1]` | No modeled door actuator/state found. A declared fixed-closed configuration can supply 0; it is a configuration restriction, not live doors. Otherwise required unknown. |
| `sim/operation/sound/inside_ratio[0]` | Authored cockpit sound-space penetration ratio, pending spatial adapter. |
| `xpevent_rel_heading` (−180…180°), `xpevent_rel_pitch` (−90…90°) | Derive listener bearing in the oriented event's frame; raw camera yaw/pitch or aircraft attitude is wrong. Sign/axis convention needs a documented adapter and cardinal-position validation. |
| `Distance` | Automatic/read-only; source/listener transforms required. |

This can support a live running-engine slice once the spatial adapter and explicit fixed-closed/intact restrictions exist. Starter/fire/separation events are outside that slice; do not claim complete cold start or failure acoustics from the engine event alone.

## ASK21: recommended minimum live physics slice

The original `.snd` has **two simultaneous `EVENT_ALWAYS` attachments**:

| Attachment | GUID | Original `VEH_XYZ`, metres |
| --- | --- | --- |
| `/ask21/environment/airflow` | `{3b679540-5d21-4d59-9646-45e7cf16e98c}` | `(0, 0.200, -2.365)` |
| `/ask21/environment/ext_airflow` | `{8602c091-aa26-480c-baf9-05d47cea391b}` | `(0, 0, -0.365)` |

Do not replace these with one instance whose event is swapped on view change. Only the first event's full parameter list is currently cached:

| Interior airflow input | Genuine mapping / limitation |
| --- | --- |
| `sim/flightmodel/position/indicated_airspeed` (0–250 kt) | `aircraft.data.kias`; retain knots. |
| `sim/flightmodel2/misc/AoA_angle_degrees` (−5…10°) | `aircraft.data.alphaDeg`; retain degrees. Range-limited bank automation does not justify changing physical AoA. |
| `sim/flightmodel2/controls/speedbrake_ratio` (0–1) | `aircraft.spoilerPos`, **actual actuator**, not `spoilerCmd`. `derive.ts` gives gliders a real one-second-travel spoiler model; `aircraft.step` moves it and applies lift/drag changes. Those coefficients are expressly calibrated approximations, but the position is live. |
| `sim/flightmodel2/misc/has_crashed` | `aircraft.crashed`. |
| `sim/flightmodel2/misc/custom_slider_ratio[0]` (0–1) | Canopy position absent. Explicit fixed-closed canopy configuration required for value 0; no claim of live canopy motion. |
| `sim/operation/sound/inside_any` (0–1) | Authored sound-space/listener adapter required. |
| `Distance` | Automatic/read-only; real transforms required. |

Recommended first slice: ASK21 continuous airflow responding to **live KIAS, AoA, actuator airbrake travel, crash state and listener motion**, with canopy fixed closed and clearly disclosed. Enumerate `ext_airflow` and snapshot metadata first; if extra required inputs cannot be mapped, report the event unsupported rather than assume it has the interior event's parameters. A diagnostic interior-only run is possible, but is not acceptance of the authored interior/exterior mix. No engine event belongs on this unpowered aircraft.

## Cockpit snapshots and coordinate gate

| Aircraft | Space / snapshot requirements |
| --- | --- |
| C172 | Space 0 AABB `(-.550,-.650,-.779)`…`(.550,.670,1.821)`, blend depth `.03`. `/in_cockpit` `{77d2d20d-00d6-4aec-a555-045732bd78cb}`, index 0, starts for nonzero `inside_ratio[0]`, auto-ends. Door snapshots require door indices 0/1; fixed-closed slice leaves them inactive. `/ducker` starts at flight time >0 and ends >5 seconds. |
| B738 | `REF_POINT_ACF -0.609 18.288`. Space 0 cockpit AABB `(-1.310,0,-17.150)`…`(1.310,2.100,-14.100)`; space 1 cabin `(-1.800,0,-14.300)`…`(1.800,2.300,15)`; both blend `.1`. `/in_cockpit` `{5a81b4eb-097a-4ec2-80df-53b532b16604}` and `/in_cabin` `{3c94383c-fdc5-4cab-8d69-20b08a7d3820}` follow ratios 0/1. Door/custom sliders and startup ducker are additional attachments, not supplied by `cameraMode`. |
| ASK21 | Space 0 AABB `(-.350,-.160,-2.735)`…`(.350,.470,.085)`. No explicit `BLEND_DEPTH`: resolve documented default rather than borrowing C172's. `/in_cockpit` `{f7916776-23c0-4714-8e13-923bb975f871}`, position `(0,.155,-2.502)`, index 0, starts/ends for nonzero/zero `inside_ratio[0]`. `/in_cockpit_canopy_open` `{2264663d-ffdf-4cca-b3d1-7cb8bf4c74d0}`, position `(0,.201,-1.631)`, starts/ends from `sim/operation/sound/users_canopy_open_ratio`; this is distinct from the airflow slider parameter. Fixed-closed slice explicitly keeps it inactive. |

The remaining snapshot parameter enumeration must capture flags/global scope and any volume/inside-ratio dependencies; `.snd` trigger predicates alone are insufficient to execute a snapshot faithfully.

Simulation body is forward/right/down; world NED is north/east/down. Render space maps NED `(n,e,d)` to `(e,-d,-n)` and uses metres. Native mesh local axes are right/up/aft. `local-aircraft.ts` translates original geometry by `(attachmentFt - cgFt) * .3048`. Current CG values: C172 `(0,.300000012,2.900000095)` ft; B738 `(0,-2,59.5)` ft; ASK21 `(0,.5,10.75)` ft. Do not multiply `.snd` metre positions by .3048 or subtract CG twice. Resolve SND's reference convention, its default when `REF_POINT_ACF` is absent, and explicit B738 offset before composing into the player transform. Resolve `VEH_PART engine` from ACF part position/orientation; aircraft centre is not an engine location.

The current cockpit camera uses generic GA local `(right=-.33, up=.75, aft=-.45)` metres and transport `(-.5,1,-.45)`; these are layout choices, not imported eyepoints. In particular GA up `.75` exceeds the C172/ASK21 AABB maxima `.670`/`.470` in their listed frames. This is a concrete alignment warning, not proof until reference transforms are resolved. Merely setting `inside_any=1` in cockpit mode would conceal the discrepancy. Choose and validate one physical listener location aligned to the rendered view and native sound space before cockpit acceptance; never secretly teleport only the audio listener to make the snapshot work.

Publish final world camera/source transforms **after** the current frame's camera update. Today `engineSound.update` occurs before chase/orbit/cockpit/free camera updates and before current pitot readings. Take forward and up from the final camera quaternion (not the fixed `camera.up` property), transform both consistently into the selected FMOD handedness, and keep vectors orthonormal. Compute inside ratios in the sound-space local frame. Rebase source and listener together; discard artificial velocity from view switches, teleports and rebases. Physical source velocity can derive from body velocity/rates and source offset; camera motion requires a defined continuous versus teleport policy.

## Required versus deferred

Required for the recommended ASK21 slice: exact exterior/snapshot metadata; explicit fixed-closed canopy capability; source/reference and listener alignment; authored inside ratio/blend semantics; both always-running airflow attachments plus cockpit snapshot; coherent live physics inputs; lifecycle reset/pause/epoch handling and measured actual playback later. These are implementation gates, not evidence obtained here.

Deferred and visibly excluded: opening canopy/doors; ASK21 vario, tow, rain, ground roll and switch events; C172 starter/fire/detachment and other cockpit systems; B738 full engine integration until missing physical/custom parameters are resolved. Those exclusions must not be labeled full-aircraft coverage. Existing safety/radio/PTT remains owned by the established services.

No fully mapped authored aircraft mix is ready today. This audit identifies a smaller truthful path; it does not establish audible quality, runtime latency, or X-Plane-equivalent behavior.

## Sept21 root metadata and coordinate follow-up

The original installed banks were re-enumerated using `fmod-studio-probe.py` with
explicit aircraft/GUID arguments. All three probes returned without an error;
no event was started or audio played. Results are preserved in the local cache:

| JSON in `server/cache/speech/xplane-probe/` | Exact parameters |
| --- | --- |
| `as21-exterior-metadata.json` | `sim.flightmodel.position.indicated_airspeed` (0–250, type0/flags0), `sim.flightmodel2.misc.has_crashed` (0–1, type0/flags0), automatic `Distance4` (0–3000, type1/flags3) |
| `as21-cockpit-snapshot-metadata.json` | `sim.operation.sound.exterior_volume_ratio`, `sim.operation.sound.radio_volume_ratio` (both0–1, default0, type0/flags0) |
| `c172-cockpit-snapshot-metadata.json` | `sim.operation.sound.inside_ratio[0]` (0–1, default0, type0/flags0) |

This resolves the missing exact metadata for those three objects. ASK21's cockpit
snapshot requires explicit sound-preference values for exterior/radio volume;
its attachment trigger is still the separate inside-space condition. Do not
leave the default zero values accidentally muting its authored buses or confuse
these preference parameters with the geometric inside ratio. Mapping decisions
and actual playback of the combined snapshots remain unimplemented.

The current [official SND specification](https://developer.x-plane.com/article/sound-snd-file-format-specification/)
confirms that absent REF_POINT_ACF, VEH_XYZ uses metres relative to the default CG
in right/up/aft axes. REF_POINT_ACF instead anchors the file's coordinates to its
specified offset from the PlaneMaker authoring origin. Loading-induced CG changes
do not relocate that default reference. Sound spaces use a union of their volumes;
BLEND_DEPTH describes an inward transition from zero at its boundary to one at
the specified depth. The page does not state an omitted BLEND_DEPTH default, so
that ASK21 default remains unresolved. These source facts narrow the transform
implementation; they do not validate the current generic cockpit eyepoint.
