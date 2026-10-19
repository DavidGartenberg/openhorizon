# DG80 signed flaperon integration design

Status: read-only investigation and proposed contract, 2026-09-18. No simulation, renderer, tests, original assets, or Git state changed by this investigation. Implementation is separate from the ongoing glider airbrake V/ARM fix and procedural moving-skin work.

## Aircraft identity and evidence

Use DG-800S, 18 m, unpowered, as the explicit DG80 variant. Current roster geometry and propulsion fit that interpretation; the label “DG-800” alone is ambiguous.

The [manufacturer DG-800S flight manual](https://pesee-centrage.fr/wp-content/uploads/2024/01/Flight_Manual_DG800S.pdf), PDF index 50 / printed 5.8, lists -9, -5, 0, +5, +10, +13 degree operating settings. PDF index 65 / printed 7.5 adds landing position L. PDF index 66 / printed 7.6 identifies one-piece flaperons driven at two stations, fuselage mixing, upper-wing double-storey airbrakes, negative-flap neutralization through airbrake operation, and forward spring-trim bias with negative flap. This is not a separate inboard-flap/outboard-aileron aircraft.

L's numeric angle, mixed roll travel, and linkage schedule were **not established** by the accessed FM. [EASA TCDS A.067 issue 04, section E, printed 29–30](https://www.caa.co.uk/Documents/Download/9066/506d9764-ac69-46f9-8b5c-ee898596e214/2722) explicitly refers control deflections to the DG-800S maintenance manual. [DG's current manual index](https://www.dg-aviation.de/en/list-of-current-aircraft-manuals/) is the next primary source. Do not borrow DG-800A/B numeric settings or RC-model servo travels. The A manual found during research uses a different angle reference.

## Recommended boundary

Keep discrete commanded detent indices and signed actual degrees. Add aircraft-specific neutral/default metadata, a small pure flaperon mixer, and optional explicit rendered angles. Preserve the existing non-DG80 code paths and values.

Two rejected alternatives: visual-only signed flaps would leave physics wrong; converting every aircraft to a new wing-panel aerodynamic model would unnecessarily expand this fix. The recommended model keeps current whole-aircraft aerodynamics and documents its limits.

Full fidelity acceptance requires the maintenance-manual evidence above. Infrastructure and the six verified numeric detents can be implemented and tested independently, but a six-position version must be labeled partial; +13 must not be presented as L or “full landing flaps.” Do not assign an invented L angle merely to complete an array.

## Contract and file changes

### Signed detents and neutral

`src/sim/aircraft/params.ts`: retain sorted `flapDetentsDeg`; negative values mean trailing edge up, positive down. Add optional `flapNeutralIndex`, `flapDefaultIndex`, and per-detent display labels. Legacy defaults are index 0. For DG80 both neutral/default are index 2 with the verified sorted settings. Default is a simulator spawn choice, not a takeoff checklist recommendation. Require finite strictly increasing detents, at least one entry, valid integer indices, neutral angle 0, and coefficient arrays of matching length.

`src/sim/aircraft/derive.ts` / `roster-ext.ts`: carry that metadata into params; install an explicit DG80 flap data block and flaperon capability. Keep AS21/LS8/DISC `[0]`. Explicit coefficient tables should pass through the existing `tuning` mechanism rather than creating a parallel parameter system; validate tables after tuning is merged. Generic fraction-derived curves are unsuitable evidence for a high-performance glider. Update DG80 display identity to DG-800S (18 m) wherever roster labels are authoritative.

`src/sim/aircraft/c172s.ts::flapInterp`: clamp against the **first** and last detent instead of 0 and last. Preserve finite nonnegative legacy results exactly, singleton behavior, and interpolation at boundaries. Define nonfinite-angle fallback as the neutral angle, not first detent. Keep this shared helper in place for minimal churn: `aero.ts` and `trim.ts` already use it.

### Command, actuator, and mixed state

`src/sim/aircraft.ts`: initialize command and actual flap state consistently from aircraft default. Normalize external index inputs once: finite integer rounding, range clamp, invalid input fallback to neutral. The current clamp alone permits fractional array keys and NaN. Retain the existing rate limiter, which already supports negative targets mathematically; type-specific rate is a documented approximation until sourced.

Create a pure `src/sim/flaperons.ts` helper for the optional capability. Inputs: actual base flap angle, post-AP/SAS roll command, and airbrake linkage state. Outputs: left/right physical trailing-edge-down radians plus equivalent symmetric and antisymmetric deflections used by aero. Put physical limits and any differential schedule in DG80 metadata. For a symmetric unsaturated mixer, left = base + roll, right = base - roll; right roll therefore raises the right trailing edge. Clamp each physical surface once to sourced mechanical limits. Derive effective aero flap angle from their mean and aileron angle from half their difference. Never clamp only the renderer while preserving impossible aero authority.

Keep commanded flap position, actual actuator flap angle, and effective mixed mean distinguishable. Existing `flapsDeg` remains actual common-mode actuator position for controls/telemetry; add effective mixed fields to `appliedControlSurfaces`. Pass the mixed mean to `aeroIn.flapsDeg` and mixed half-difference to `aeroIn.aileronRad`. Existing aircraft bypass the optional mixer exactly.

Airbrake neutralization belongs in the pure simulation mechanism, before force evaluation, not `main.ts` or the renderer. Advance the airbrake actuator before evaluating the linkage. The manual proves neutralization but not the onset/progression/return schedule. Do not silently assume a linear travel map, immediate neutralization at any nonzero extension, or automatic return to the former negative setting. Source the schedule and whether handle displacement persists. A provisional map must be an explicit approximation and cannot close authenticity acceptance. Positive flap settings must remain unaffected by a negative-only neutralizer.

The negative-flap spring trim is a control-force bias, not evidence of a moving stabilizer or trim tab. Keep the conventional elevator and fixed stabilizer. Without control-force/force-feedback modeling, do not double-count the bias as both a flap pitching-moment curve and a second trim offset. Document the omitted spring force; if a calibrated hands-off elevator bias is implemented, centralize it before effective elevator capture and use it in trim solving too.

### Spawn, restore, UI, and hardware

`src/main.ts`: replace zero-index neutral assumptions at ground spawn (~551) and KeyR (~1021); constructor and any direct `spawnOnGround` path must satisfy the same invariant without waiting one frame. Reset command, actuator, displayed state, and applied surfaces together. Final-spawn metadata (~177) must explicitly distinguish +13 from a verified L detent; do not keep automatically treating the last available entry as authentic landing L.

Snapshot save/restore (~594–666) currently stores an index with no aircraft identity or flap-schema version. Add aircraft identity and physical commanded angle/schema version. Migrate old DG80 `[0]` saves to neutral index 2; reject or neutral-fallback an incompatible aircraft snapshot rather than restoring a foreign index. Sanitize before looking up an angle or calling trim. Restore still intentionally reconstructs a trimmed flight, not actuator history; keep that existing limitation explicit.

F/G and flapsUp/flapsDown traverse all sorted detents, including negative settings. Full analog-axis mapping covers the entire index interval; publish the seven labels after L is verified. Existing five-position hardware bindings currently sample `round(i/4*(count-1))`: with seven positions they skip two detents. Keep that legacy mapping for other aircraft, but show which DG80 labels each binding selects and support step/axis access to every detent. A binding named `flaps0` must be clarified as the first hardware lever position if it selects -9, or mapped explicitly to neutral if it means zero degrees; do not mix these semantics silently. Show signed angle and label in the controller readout rather than only numeric index. HUD already displays degrees.

`src/sim/copilot.ts`: `flapsIndex > 0` ceases to mean positive flap; use physical degree/capability-aware state. Its middle-detent takeoff heuristic must not invent a glider takeoff procedure. Review `taws.ts`'s `<10` landing-flap warning for glider applicability; suppress an inapplicable warning through aircraft capability rather than manipulating DG80 flap values.

### Rendering

Coordinate additions to `SurfaceState` in `src/render/aircraft-mesh.ts` with root: optional signed `flapsDeg` and explicit `flaperonLeftRad`/`flaperonRightRad`, with trailing-edge-down convention. `main.ts` supplies actual effective values after simulation. Retain `flapFrac` as a bounded positive-only compatibility channel for existing Fowler/slat/native adapters; never reinterpret it globally as a signed fraction.

`prop-profiles.ts` / `prop-aircraft.ts`: DG80 profile selects one continuous trailing-edge flaperon per wing, with two linked drive stations, fixed-wing exclusion, and real hinge endpoints. Honor explicit angles without adding roll again. Geometry fallback may mix signed base and effective roll only when explicit angles are missing; keep it finite and bounded. Do not add separate duplicate flap meshes. T-tail spring trim must not create an invented tab. Preserve independent airbrake geometry/position.

`local-aircraft.ts`: preserve existing native mappings. No DG80 native substitution was established in this investigation. Only extend its adapter if an actual DG80 asset and authored dataref semantics are verified; do not apply signed degrees indiscriminately to legacy ratio refs.

## Aerodynamic calibration and honest limits

The legacy DG80 `stallCleanKcas:37` is a suspect full-weight anchor, so it must be checked against the correct 18 m, weight, configuration, and IAS/CAS manual rows before deriving new increments. Do not tune positive/negative increments around an unverified baseline. Fit explicit CLmax increments to configuration-specific stall observations, and document interpolation between observations. Lift-at-zero-alpha, drag, and pitching moment are not all identifiable from stall speeds. Use documented estimates and validate trim and the polar; do not label generic C172-scaled coefficients manufacturer data.

`derive.ts` computes `vSpeeds.vs0` from a scalar full-flap increment before the final tuning override. Make DG80's speed metadata consistent with the actual final coefficient table (without changing unrelated fleet calibration). `roster.ts::selfAuditRigging` trims at zero degrees but currently skips gliders through its `pFactorK` guard; preserve that gate. Its shared constructor must still initialize any future signed-flap powered type at neutral so its probe cannot slew away from the trim configuration.

The effective-mean/half-difference model maintains rendering/physics agreement at stops but is still a whole-wing approximation. It does not resolve spanwise stall, nonlinear lift differences at extreme roll, or an exact flap-dependent drag bucket. A precise factory mixer schedule, spring forces, and section polars require additional data. Those limitations must remain visible in the completion report.

## Focused acceptance before full integration

1. Signed interpolation: each detent, negative midpoints, zero crossings, end clamps, singleton, nonfinite input; unchanged C172/B738/Cub results.
2. Constructor/ground spawn/KeyR/final spawn/snapshot: correct neutral and no first-step jump; migrate an old DG80 zero-index save; invalid index and foreign aircraft restore cases.
3. Deterministic actuator/mixer: every detent, both roll directions, partial airbrake values, full travel, saturation, return/reset, dt subdivision stability; positive flap unaffected by negative-only neutralization. Verify aero inputs equal rendered physical-angle decomposition.
4. Aerodynamics and trim: distinct finite forces for negative/zero/positive, attainable stable trims, no NaNs at table boundaries, documented stall/polar residuals at correct weights; no false claim that monotonic drag validates a laminar glider.
5. Geometry: real indexed moving skin, fixed-skin exclusion, both drive stations attached through the entire signed range, right-roll direction, combined flap/roll extremes, neutral reset; disconnected-endpoint mutation must fail. Existing procedural fleet/native adapter regressions remain green.
6. Keyboard, analog lever, five-position bindings and hardware steps: demonstrate access to all supported labels and visible motion/physics agreement. Root browser close-ups and real hardware evidence remain required after focused tests and TypeScript. Full test/validation/build acceptance follows integration, not this design.

Implementation can proceed in the bounded order: shared signed contract; DG80 calibrated parameters and mixer; lifecycle/control plumbing; rendering; integrated evidence. Do not mark DG80 complete until L and mechanism-source gaps are either resolved or explicitly accepted as approximations by the authorized project scope.

## Primary-source follow-up: combined maintenance manual obtained

2026-09-18 follow-up supersedes the earlier missing-L/travel findings and the proposed negative-only neutralizer. Source: DG Flugzeugbau GmbH, *Wartungshandbuch für das Segelflugzeug DG-800S*, December 2009, explicitly covering DG-800S and DG-808S Classic/Competition on its cover. The public [Segelfluggruppe Nidwalden pilot library](https://segelfluggruppe-nidwalden.ch/piloten/) links its HB-3173 maintenance manual to this [173-page manufacturer-manual scan](https://drive.google.com/file/d/0BzT0z0-NNdGCczlnTWt6RTRYYm8/view?resourcekey=0-O9BYW3aTody1v8OSW5Ox6g&usp=drive_link). It contains the flight manual followed by the combined maintenance manual. Downloaded read-only as `/tmp/dg800s-maintenance-source.pdf`; source cover is PDF page 85. Pages below use one-based PDF numbering. The scan is a historical edition, not proof of incorporating all current revisions.

### Verified mechanical data

PDF page 100, printed 1.6, section 1.4.2: at flap zero, aileron displacement is 42 ±3 mm upward and 21 ±3 mm downward, measured 122 mm from the hinge at the root. Flap extremes at that station are -9° / 19 ±3 mm upward and L / 38 ±3 mm downward. Neutral alignment is 0 ±1 mm. PDF page 101, printed 1.7, sets +5° to 10.6 mm at the root and 4.1 mm at the 18 m tip.

PDF page 102, printed 1.8, section 1.5.2(d): fully extended airbrakes carry the flap handle approximately 10 mm behind the +5° detent. Section 1.5.3 requires at least 215 mm airbrake handle travel. PDF pages 140–141, diagrams 3–4, show the fuselage mixer and wing drives without a numerical intermediate-travel schedule.

### Derived angular values and their use

The source specifies L as linear displacement, **not an exact printed degree label**. With the measured displacement perpendicular to a 122 mm radius, `asin(displacement / 122)` gives nominal L = +18.148°, roll up = 20.137°, roll down = 9.912°. The same conversion reproduces the source -9° and +5° positions to rounding precision. It is therefore a supported geometric conversion, not a borrowed DG-800A number. L's displacement tolerance corresponds to approximately +16.672° through +19.637°; do not advertise the nominal conversion as factory angular precision.

Practical nominal detents: `[-9,-5,0,5,10,13,18.148168050127868]`, with final display label `L`. Use 38/122 geometry in the parameter provenance instead of an unexplained magic angle. The measured neutral-flap roll differential replaces the symmetric roll example above: at full right roll, left flap moves down approximately 9.912° and right moves up approximately 20.137°. Reverse for left roll. Shared physics/render mixing must reflect the resulting nonzero symmetric mean. The manual establishes these travels **at flap zero**, not a full flap-dependent mixer curve or absolute combined travel stops. Applying constant differential increments at other flap settings remains a declared approximation; do not clamp combined motion to the pure-flap -9/L range, which would incorrectly eliminate roll authority.

### Chosen bounded linkage approximation for implementation

The relevant control sections and diagrams do not provide a numerical airbrake-position-to-flap-angle curve. The exact intermediate schedule, handle displacement-to-angle conversion beyond +5°, and released-handle persistence remain unestablished. This is narrower than saying that the manual contains no linkage information: it supplies a definite full-travel handle end condition.

For a deterministic first implementation, use the following explicit approximation in DG80-only metadata and record it in the completion report. Let actual airbrake extension `s` run from 0 to 1. Let its imposed minimum base flap angle be `-9 + 14*s` degrees, reaching **+5°** at full extension. This is a conservative nominal approximation to the sourced handle position beyond +5°, not a conversion of the extra 10 mm. It intentionally supersedes the earlier requirement that all positive settings be unaffected: +10/+13/L remain unaffected, while 0 and negative settings are raised and an intermediate positive setting below the imposed floor is raised.

Persist the greatest imposed minimum reached during the current airbrake deployment as mechanism state; lowering the airbrakes alone does not restore a prior negative flap command. A new deliberate flap-selection action replaces that held state, subject to the currently extended-airbrake floor. Reset clears it. This persistence is a chosen simulation assumption because the source did not establish the return behavior. Keep selected detent and held/actual mechanism angle distinguishable in telemetry; a mechanically displaced handle need not coincide with a selectable detent. A steady analog hardware value is not a new selection action: detect detent transitions so each poll cannot undo the held mechanism position. Keyboard/hardware button events count as deliberate actions. Save the held mechanism angle in the new snapshot schema, or explicitly reset it on trimmed-state restore with a documented migration rule.

Drive both aero and geometry from the final rate-limited, mechanically constrained state; the overlay cannot be render-only. Tests should lock down this chosen schedule and persistence as **simulation behavior**, while separate source checks retain the actual 10 mm-beyond-+5° endpoint as an unresolved fidelity difference. A later measured lever map can replace the approximation without changing control contracts.

No local DG80/DG808 asset or manual was found among the installed X-Plane aircraft paths. No production/test changes or Git operations were performed during this source follow-up. Relevant PDF pages were rendered and visually inspected; no OCR-only table interpretation was used.

## Stall calibration follow-up: correct span and mass

The [English manufacturer FM](https://pesee-centrage.fr/wp-content/uploads/2024/01/Flight_Manual_DG800S.pdf), PDF page 47 (one-based), printed 5.4, section 5.2.2, supplies these **18 m / 525 kg** minimum level-flight speeds:

| Flap | Airbrakes retracted km/h (printed kt) | Airbrakes extended km/h (printed kt) |
| --- | --- | --- |
| -9° | 88 (48) | 94 (51) |
| 0° | 84 (46) | 90 (49) |
| +13° | 77 (42) | 84 (45) |
| L | 76 (41) | 84 (45) |

The current `stallCleanKcas:37` at 525 kg is **neither the clean nor L table value**. The table has 37 kt for L at 440 kg. That coincidence does not establish the origin of the existing parameter. Use the 18 m table; the next page is the different 15 m configuration.

Printed 5.3 / PDF page 46 defines IAS/CAS and graphs separate calibration curves for -9°, 0°, and L. The stall-table heading itself does **not explicitly identify IAS or CAS**. Accordingly, do not describe its numbers as measured/certified KCAS. Their operational use suggests indicated speeds, but that is an interpretation. The calibration graph was visually inspected and is not identical to IAS=CAS. No precise low-speed correction was digitized in this bounded pass, and it provides no separate +13° curve. Local read-only source is `/tmp/dg800s-flight-manual.pdf`.

### Narrow implementation basis

For the bounded signed-flap implementation, declare **IAS approximately equal to CAS** as a calibration approximation, preserving the current no-pitot-table DG80 behavior. Use the km/h values divided by 1.852 rather than the coarse printed knot rows; for example 84 km/h is 45.356 kt rather than 46. At 525 kg, current area 11.8 m², sea-level density 1.225 kg/m³, and gravity 9.80665 m/s², `CLmax = 2*m*g / (rho*S*(V_kmh/3.6)^2)` yields:

| Flap | Effective CLmax under that approximation | Increment relative to 0° |
| --- | --- | --- |
| -9° | 1.192151737 | -0.116241553 |
| 0° | 1.308393290 | 0 |
| +13° | 1.557096146 | +0.248702857 |
| L | 1.598341941 | +0.289948651 |

Set the neutral calibration input to `84/1.852` KCAS **as an explicitly approximate model input**, `flapMaxDClMax` to the L increment, and install explicit `flapDClMax` entries. For -5°, interpolate CLmax between -9° and 0°; for +5° and +10°, interpolate between 0° and +13°. Resulting increments in full detent order are approximately `[-0.116241553,-0.064578640,0,0.095654945,0.191309890,0.248702857,0.289948651]`. Intermediate values are model interpolation, not measurements. Recompute rather than copy these values if the area changes to the manual's 11.81 m².

Keep `CL0`, pitching moment, drag increments, and roll-dependent lift distribution explicitly estimated; stall speed alone does not identify them. These CLmax values are an effective whole-aircraft force-model calibration and must still pass a deterministic trimmed stall check rather than only the analytic `stallTasMs` helper. Validate lighter weights as holdout points with stated tolerances, because one constant CLmax cannot reproduce every rounded table entry exactly.

Use the **airbrakes-retracted** rows to isolate flap lift capability. Treat extended rows as later integrated checks; do not simultaneously tune flap CLmax and subtract a second brake loss from those already-degraded values. The published extended table includes nominal negative/zero flap rows despite the documented mechanical coupling, so it is insufficient by itself to resolve actual handle versus surface configuration during the measurements. Preserve that ambiguity rather than fitting mutually contradictory states. A future calibration-chart digitization can replace IAS≈CAS and update coefficients without changing the signed-angle contract.
