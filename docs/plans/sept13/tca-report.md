# Stage 6 — Captain Edition controller implementation

Implemented September 18, 2026. Software handoff; physical acceptance remains open. No drivers, privileged HID, browser operation, installation, commits or Xcode-license changes were performed by this implementer. Root owns browser inspection. Existing graphics, voice and loading work is retained.

## Mapping and calibration

- Measured Mac Sidestick X axes remain roll0/pitch1/yaw5/slider6, and quadrant ENG1/ENG2 axes0/1 retain sign+1: IDLE=-1, TOGA=+1. No automatic assignments to resting buttons16+ or unmeasured add-on axes.
- Known Airbus profiles are detected on the first polling frame as well as connection changes. Generic Thrustmaster and Boeing TCA profiles are excluded. The known stick face-button assignments remain; quadrant reverse0 and reverse1 are now symmetric held actions.
- Presets and captured bindings carry full Gamepad device identity. Browser index changes do not transfer actions to another device. Alias logical slots remain stable when the devices exchange indices. Duplicate identical IDs are considered ambiguous/unavailable. An automatic stick-slider throttle yields to the quadrant when it arrives; a user capture does not.
- Missing, nonfinite or out-of-range axes return unavailable. They never become a centered 50% throttle. Current presets merge without discarding saved calibration. Known legacy preset positions gain verified profile identity; other legacy custom bindings are retained but unavailable until recaptured, because their former device cannot be proven from an index alone.
- Saved maps validate function enums, integer indices, signs, calibration bounds/order, device identity and allowed key aliases. The old ENG2 reverse-toggle alias migrates to a held binding. Captured buttons remove conflicting aliases/actions, and reconnect does not add them back.
- Throttle calibration records signed minimum, TOGA maximum and IDLE. Optional CL/FLEX points label their captured positions in the live display. An IDLE above minimum permits analog reverse within [-1,1]. The measured default IDLE=-1 has no below-idle travel, so reverse lifts supply direction until the user calibrates otherwise.
- Each lever is interpreted separately before combination. Mixed forward/reverse commands idle in the shared model. Both reverse lifts release symmetrically, including when one lever is idle and the other forward. Keyboard reverse remains available when hardware does not own direction.

## Controller panel and physical inventory

Open the top-right Controllers disclosure or press J. It shows connected device IDs, raw axes/buttons, individual ENG1/ENG2 power/detent/reverse, flap and speedbrake positions, parking brake, transmit phase and physical trigger, engine/ignition state, autobrake state and rudder trim. Diagnostic lines show actual throttle, pause/focus, W/S holds and a verification override if active.

The function selector includes both thrust levers/lifts, pitch/roll/yaw/mixture/brakes, flaps and speedbrake axes, engine masters1/2, ignition CRANK/NORM/START, gear UP/DOWN, autobrake OFF/LOW/MEDIUM/MAX/RTO, rudder trim LEFT/RIGHT/RESET, parking brake, speedbrake ARM/DOWN/FULL and flap detent positions, plus held PTT and the retained sidestick actions. Flap/speedbrake detent buttons are alternative representations of lever positions, not arbitrary additional actions.

Capture is explicit: pause, choose a function, Capture, move only that control, verify the detected device/index/live value, record endpoints (and throttle IDLE), then Save/Next. Retry, Skip and Cancel are explicit. There is no timeout/automatic skipping. New devices or new axes appearing during capture cannot bind from rest. An initially held button must release and press. Calibration validates before saving; cancelling retains the saved map.

## Actual simulator behavior

- Flaps use the active aircraft's detent count; speedbrake drives the existing spoiler actuator and ARM behavior. Axis endpoints map normalized lever travel. Captured virtual detents set actual aircraft positions; these can represent hardware whose detent spacing differs from normalized axis spacing.
- Parking brake and engine masters are absolute latched ON/OFF commands. A mapped parking brake does not auto-release with throttle. Gear UP/DOWN and selector positions are absolute, so reconnect does not toggle them accidentally.
- Jet masters operate two equal engine groups. Each group can stop independently; START takes six seconds with fuel/electrical supply, NORM sustains running, and CRANK does not ignite. If CRANK and START are both mapped/released, ignition returns to NORM, supporting selectors with no center button. Power fraction scales aggregate thrust and fuel, and stopped groups retain windmill drag.
- Autobrake LOW/MEDIUM/MAX arms in flight and brakes on touchdown at idle; RTO arms above40kt at takeoff power and applies on rejected power. Manual braking/power intervention disarms it until the selector is cycled. It does not apply braking while merely parked. This is simplified mode behavior, not aircraft-certified deceleration control.
- Rudder trim slews while held, clamps to±0.3, resets explicitly and mixes once with the final AP/SAS/pilot yaw before physics. Aircraft.appliedControlSurfaces records the actual pitch/roll/yaw and aerodynamic elevator/aileron/rudder angles before command restoration. Stage8 should use this authoritative snapshot for animation; this stage does not claim new visible surface animations.
- Blur, hidden page, editable focus, disconnect, reset and capture clear transient hardware actions. Held reverse/brakes require a physical release before rearming. PTT continues to read physical identity-resolved buttons, with null for unavailable; the existing voice release-before-rearm/focus eligibility remains in force.
- Captain engine state reads fuel only after stepFuel updates fresh availability. Browser QA caught the initial ordering defect; a main integration regression reproduced the stopped-engine result before the order was corrected. Loading reset still reconstructs fuel metadata, applies snapshot loading before trim and constructs one panel.

## Verification evidence

The core failure cases were written/run red before production fixes: measured reverse mapping, identity/read validation, calibration reverse, resting capture, saved validation, swapped-index aliases, released-button capture, automatic-slider ownership, legacy identity guard, authoritative surface snapshot and first-tick fuel/engine ordering. The capture class, UI and main harness tests were added after their initial implementation; this is not a claim of strict TDD for every changed line.

Focused main harness executes the actual extracted TypeScript pollControls function with synthetic Gamepad inputs. It verifies flap/speedbrake actuation, latched parking brake at high throttle, master switch levels, either reverse lift release, mixed-direction idle and keyboard reverse with no hardware. Other tests verify focus/disconnect rearm, held PTT lifecycle, engine-group thrust/fuel, engine starts, rudder trim and autobrake. Existing loading-main harness was adapted only to provide the new Captain reset dependencies; its original assertions remain intact.

Final focused command and TypeScript result are recorded at handoff below. Root browser verification and independent review remain separate acceptance gates.

## Limitations and physical acceptance checklist

Shared thrust/N1 remains one aggregate model; two master switches control equal groups, including on aircraft with more than two physical engines. There is no independent engine-out yaw, separate spool model, aircraft-specific autobrake deceleration or certified start sequence. CL/FLEX values label calibrated detents; they do not implement an Airbus autothrust/FLEX-temperature system. Piston magnetos/start logic remains unchanged; jet masters do not replace piston magnetos.

Both actual devices are now exposed in root's September18 browser. Raw samples around -.515/-.498 displayed24/25% and aggregate25%; later +.474/+.490 displayed about74%. These demonstrate the current conversion, not proof of physical endpoints or named lever identity. Root initially observed -1/-1 at a reported idle position, but later deliberate user reports contradicted that assumption: confirmed both-IDLE produced +.481/+.485, and reported ENG1-TOGA/ENG2-IDLE produced axis0=-1/axis1≈+.491. Therefore retain the historical preset unchanged and use deliberate user-specific capture to establish each lever's direction, IDLE and endpoints. No named-lever calibration was saved at this report update. Manufacturer Windows diagrams do not establish Mac Gamepad indices.

- [ ] Connect/activate both controllers; confirm exact ID/count and initial idle0% for each lever after reload.
- [ ] Move each throttle independently IDLE→TOGA, confirm monotonic power and correct lever; calibrate minimum/IDLE/TOGA and optional CL/FLEX.
- [ ] Lift each reverse separately/together, release in both orders; verify no sticking and mixed forward/reverse idle; check airborne inhibition.
- [ ] Capture actual add-on flap/speedbrake travel or virtual detents, move every physical position and verify simulator detents/actuators; capture ARM separately if represented by a button.
- [ ] Capture parking ON, test OFF/ON and power-up without auto-release; disconnect/reconnect while latched.
- [ ] Capture both engine master ON states, select OFF independently, verify half/zero aggregate power; START with fuel/power, then NORM/CRANK behavior.
- [ ] Capture gear UP/DOWN, all available autobrake positions and rudder trim LEFT/RIGHT/RESET. Test a ground roll and touchdown/RTO sequence, then manual disarm.
- [ ] Capture PTT, verify physical release-to-send, focus loss, reconnect while held and fresh release before rearm.
- [ ] Unplug/reconnect in swapped enumeration order; confirm same saved functions/calibration, no phantom edges, no wrong-device action.
- [ ] Load a nonjet and representative jets; verify no regression in keyboard controls, loading, fuel, warnings, voice and selected-aircraft control limits.
- [ ] Stage8 verifies the visible authored/procedural surfaces against actual appliedControlSurfaces and audits any remaining physical switch representations.

## Final handoff checks

`npx vitest run tests/tca-controller.test.ts tests/controller-runtime.test.ts tests/controller-main.test.ts tests/gamepad-map.test.ts tests/captain-systems.test.ts tests/voice-ptt.test.ts tests/voice-bindings.test.ts tests/turbofan.test.ts tests/loading-main.test.ts --maxWorkers=1 --minWorkers=1`

Result: **67 tests passed, 9 files, exit0**. Fresh `npx tsc --noEmit`: **exit0**.

Root browser found the pre-fix first-tick engine-stop issue described above. Its corrected integration regression is green. Root also reported an early100%throttle display with no exposed pads. It has not reproduced; later connected-device values tracked the raw axes, with W/S up, no override and engines RUN. Its original cause remains unestablished. Software tests establish that missing axes/pads do not synthesize half/full throttle, but do not explain that earlier browser session's history.


## Independent review and native capture follow-up

The September18 independent review found two Important issues. Both were verified before changing source:

1. A legacy unknown alias such as `0:16 → KeyW` acquired the newly discovered controller's slot identity. A RED test reproduced an active read. Migration now preserves such values under `unverifiedBtnKeys`, never polls them, and shows that they await capture. Only an existing device identity or an exact known preset alias is migrated as active. Parse/round-trip preserves quarantined values; identity-backed custom aliases still follow reconnect index changes. Explicit button recapture clears conflicting active/quarantined aliases.
2. Fixed Loading/Controller rectangles overlapped. Both panels now mount in one responsive, scrollable flex-column dock; each occupies normal flow with full available width. Opening either changes its height and pushes its neighbor. Controller raw text wraps and its selector fits the viewport. A structural DOM regression verifies the shared parent, column flow, nonsinking children and viewport-bounded scrolling. Actual collapsed/expanded/narrow viewport rendering remains root's browser verification.

During deliberate hardware capture root identified a third actual defect: Gamepad and GamepadButton fields are WebIDL prototype getters, so object-spread snapshots omitted `id`, `index`, `connected` and `pressed`. The old synthetic objects had enumerable fields and hid this failure. A RED regression with prototype-only getters reproduced null capture, then explicit property copies fixed both axis and released/pressed button capture. This fix preserves the immutable baseline: connecting after Capture still requires Retry, preventing new/resting inputs from auto-binding. The long engine-model paragraph was moved into a collapsed notes disclosure to keep the capture steps visible.

Post-fix focused command: `npx vitest run tests/tca-controller.test.ts tests/flight-panel-dock.test.ts tests/loading-main.test.ts tests/controller-main.test.ts --maxWorkers=1 --minWorkers=1` — **20/20 passed, 4 files, exit0**. Fresh TypeScript result follows at final handoff. Root's pre-review whole-suite run was1424passed/4skipped across106files and build exit0; these are prior-state evidence, not a claim that the post-review whole suite has been rerun.

Fresh post-review `npx tsc --noEmit`: **exit0**. Source frozen for root's resumed physical capture and independent re-review.

Root post-fix browser layout check at861×908: both panels expanded occupy separate normal-flow rectangles with8pxgap; dock840pxhigh scrolls1753pxcontent. With Controllers collapsed itsbounds54–94px, Loading102–533.58px, both440pxwide. Restored Controllersopen,Loadingclosed afterward. This verifies actual rendered layout at the currentviewport; a narrower viewport sweep remainsfinalQA. Independent software re-review PASS recordedtca-review.md.
