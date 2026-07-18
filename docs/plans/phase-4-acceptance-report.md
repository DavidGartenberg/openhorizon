# Phase 4 acceptance verification report

Verified against commit `0d2cfe1` (Phase 4 Task 6 fix, the most recent commit at the
time of this session). This is a verification-only pass: no `src/`, `tests/`, or config
files were modified. Driven via `npm run dev:client` (Vite, port 5173; `/api/*` served
by Vite's own middleware per the Task 6 report) and the Browser pane (a live Chrome tab,
not a headless/frozen-clock harness — see the environment finding below, which affects
how item 1's evidence should be read).

Overall verdict: **partial**. Item 2 (SF Bravo shelf) and item 3 (AP-master physical
switch) pass with clean, repeatable evidence. Item 1 (coupled ILS approach) is
**blocked/not verified as passing** — every attempt is documented below, along with two
concrete, reproducible findings (one environment/tooling, one likely a real autopilot
control-law gap) that explain why, rather than a fabricated pass.

## Environment finding (affects item 1's evidence directly)

The task brief's ground rules state "Browser automation in this environment suspends
`requestAnimationFrame`... drive the sim via `window.__ohStep(dt)`." This did **not**
hold in this session's Browser pane (`preview_start` opening a live Chrome tab via
`mcp__Claude_Browser__*`): the page's own `requestAnimationFrame` loop and its
`setInterval` fallback (`src/main.ts`'s `frame_` and the 250 ms watchdog) keep running
against real wall-clock time regardless of which tool touches the tab. This was
confirmed directly: two consecutive `javascript_exec` calls with nothing but a plain
`__ohData()` read in between (no `__ohStep`, no `computer` action) showed the aircraft's
altitude, heading, and roll had changed between calls — i.e. real time elapses, and the
sim advances at 1x, in the gap *between any two tool calls*, not only around clicks.
Only code executed **inside a single `javascript_exec` call** is deterministic; every
call boundary (including a `computer` click, which is unavoidable for the AP-master
switch) lets an unpredictable, sometimes large (tens of simulated seconds) amount of
real time pass. This is an environment/tooling characteristic of this session, not a
sim code defect, but it directly undermines the ability to cleanly stage
"spawn → click switch → sample deflections" for item 1, and should be read as the
reason item 1's live end-to-end demonstration did not converge (see below).

## Item 1 — Coupled ILS 28R KSFO, 15 kt crosswind, half-scale to 200 AGL

**Status: not verified as passing. Blocked, with two concrete findings.**

### What was done
Repeated attempts (8+), each structured to minimize the number of tool-call boundaries
around the mandatory physical click:
1. One `javascript_exec` call: `__ohSpawn('KSFO 28R final')` (the existing 3 nm
   final/900 ft AGL/70 KIAS spawn support), `__ohWind(208, 15)` (a ~90° crosswind
   component relative to 28R's ~298° true heading), `__ohTune({nav1Active: 109.55})`
   (KSFO 28R's ILS frequency per `KNOWN_ILS_FREQUENCIES` in `src/sim/nav/tuning.ts`),
   `__ohHold(true)` (wing-leveler, to damp whatever real-time drift occurs before the
   AP is engaged), `__ohCam('cockpit')`, and a synthetic `mousemove` dispatch (see the
   switch-location note under item 3 — the `computer` tool's `left_click` does not
   itself send a `mousemove`, so `Input.pointerPixels()` never updates without one).
2. One `computer` `left_click` on the real AP-master switch mesh.
3. One `javascript_exec` call: confirm `__ohSystems().controls.apMaster === true`,
   disable the wing-leveler, select `APR`/`GS` via `__ohApMode` (mode-select is
   debug-hook-only per the Task 6 report's disclosed scope), then step forward in
   0.05 s increments sampling `__ohNav()` (`deflectionFraction`, `glideslopeFraction`)
   and `__ohData()` at regular intervals — all within this one call, so this part is
   fully deterministic.

`__ohSystems().controls.apMaster` reliably went `false → true` on the click every
attempt — the switch itself works (see item 3). The problem is what state the aircraft
is in *by the time* that click lands, and what the coupled lateral modes do from there.

### Finding A — real-time drift during the click destroys the intercept geometry
Because of the environment behavior above, the ~1 gap around the `computer` click
(and, in earlier attempts before this was understood, additional gaps from multi-step
staged recovery) let anywhere from roughly 10 to 90+ simulated seconds elapse
hands-off/under only the wing-leveler. Sample of `dImmediate` (state read the instant
after the confirmed click) across attempts:

| attempt | roll (°) | heading (°, target 298) | AGL (ft, spawn 915) |
|---|---|---|---|
| 1 | 0.03 | 297.9 (0° error) | 915 |
| 2 | -1.9 | 273.6 (24° error) | 802 |
| 3 | 21.2 | 334.7 (37° error) | 866 |
| 4 | 6.4 | 7.4 (huge — wrapped) | 831 |
| 5 | 20.1 | 357.3 (59° error) | 841 |
| 6 | 24.8 | 345.8 (48° error) | 721 |

Even attempt 1 (essentially zero drift, a lucky short round-trip) is the exception,
not the norm — most attempts land with the localizer already many multiples of the
±2.5° (`LOC_FULL_SCALE_DEG`, `src/sim/nav/navaids.ts`) full-scale width away laterally,
which at ~3 nm out is a beam only ~0.1 nm wide. A `deflectionFraction` pinned at
exactly `±1` for the entire subsequent run (never dipping below 1 even when heading
briefly matched 298°) confirms the aircraft was laterally far outside the linear
capture region, not just heading-mismatched.

### Finding B — the lateral autopilot modes (HDG and APR) do not converge from
### non-trivial initial error; they oscillate

This was tested independently of the click-drift problem, using purely deterministic
in-call stepping (no further real-time risk) once `apMaster` was already `true`:

- **HDG mode**, commanded a plain ~40° turn (339°→298°) from stable, wings-level
  flight (roll 0, confirmed via a prior `ROL`/`PIT` relevel): bank oscillated
  -26.3° → +35° within 10 simulated seconds, never converging on the target heading.
- **APR/GS mode**, engaged with heading errors ranging 20–60° (Finding A's table):
  every attempt produced a **sustained, undamped bank oscillation** — not a transient
  that settles, a limit cycle that persists for the full sampled window. Detailed
  1-second-resolution trace from the cleanest attempt (dImmediate roll 20.1°, heading
  error ~42° once wrapped) over 40 simulated seconds:

  | t (s) | hdg (°) | roll (°) | loc | gs |
  |---|---|---|---|---|
  | 1 | 346.1 | 27.1 | 1 | -0.24 |
  | 5 | 345.6 | -21.6 | 1 | -0.21 |
  | 9 | 0.4 | 43.5 | 1 | -0.23 |
  | 13 | 353.8 | -58.6 | 1 | -0.31 |
  | 17 | 292.5 | 36.5 | 1 | -0.07 |
  | 21 | 334.7 | 17.2 | 1 | -0.07 |
  | 25 | 354.0 | 18.1 | 1 | 0.01 |
  | 30 | 349.9 | 40.7 | 1 | 0.02 |
  | 35 | 342.6 | -57.7 | 1 | -0.21 |
  | 40 | 336.3 | 43.0 | 1 | -0.06 |

  Heading swings continuously through a ~65° band (290–355°) and roll through a
  ~115° band (-59° to +48°) for the full 40 s with no visible damping trend.
  `loc` (localizer deflection) stays clipped at `1` the entire time — consistent with
  Finding A (laterally far outside the beam) — while `gs` (glideslope deflection)
  interestingly *does* hover near/within half-scale several times (as low as -0.007,
  0.004, 0.008), suggesting the vertical/GS channel may be closer to correct while the
  lateral/APR channel is the one not converging. Every attempt at any starting error
  above ~20° ended in a crash (AGL → 0, `crashed: true`) within 15–25 simulated
  seconds, always via a steepening dive coincident with the bank oscillation, never a
  clean recapture.

Given this, the acceptance criterion ("stays within half-scale to 200 AGL") could not
be demonstrated as passing, and — separately from the click-drift problem — the
lateral-mode oscillation itself looks like a real, reproducible gap in
`src/sim/autopilot.ts`'s HDG/APR control law worth the controller's attention: it
converges fine from near-zero error (per the Task 6 report's own browser verification,
which showed a real captured LOC needle) but does not damp out errors in the
15–60° range that a live capture (or, in this session, an unavoidable click-latency
gap) can easily produce.

### What was *not* fabricated
Per the brief's explicit instruction, wind/spawn parameters were not adjusted to force
a pass, and no attempt result was cherry-picked or omitted. All figures above are from
real `__ohStep`-driven simulation, not reasoning about the code.

### Recommendation
Two independent follow-ups, not necessarily both blocking: (1) investigate HDG/APR
capture damping for initial errors beyond ~15–20° in `autopilot.ts` (possibly a gain/
limiter issue, or an angle-wraparound edge case given the oscillation was centered near
due north in several traces); (2) if a live browser re-verification is wanted, use a
tool/harness that genuinely freezes the sim clock between calls (confirmed not to be
the case for `mcp__Claude_Browser__*`'s `preview_start` tab in this session) so the
click-latency problem in Finding A doesn't confound results.

## Item 2 — SF Bravo shelf: MFD rendering + in-airspace detection

**Status: pass.**

- `__ohSpawn('KSFO 28R')` (ground), `__ohMfdPage('map')`, `__ohCam('cockpit')`: cockpit
  screenshot (1280×800 viewport) shows the MFD's map page rendering a blue-outlined,
  blue-tinted polygon enclosing KSFO — the SF Class B shelf — with airport labels
  (KOAK, KHAF, KSQL, KPAO, KHWD-area icons) positioned correctly around it, a range
  ring ("26 NM"), and "NORTH UP" heading-mode label, consistent with §6.5's solid-blue
  Class B styling.
- `__ohAirspace()` at KSFO ground level (37.614, -122.358, ~17 ft) returns
  `[{"name":"SAN FRANCISCO CLASS B","kind":0,"floorFt":0,"ceilingFt":10000}]` —
  correct in-airspace detection.
- `__ohAirspace()` at KHAF (37.509, -122.496, ~42 ft — a real, geographically distinct
  spawn point well outside the SF shelf's lateral extent) returns `[]` — correctly
  reports **not** inside. (The brief's other suggested "outside" test — climbing above
  the 10,000 ft ceiling at the same lat/lon — was attempted via direct
  `__ohCtl`-driven climbs but repeatedly ended in a stall/crash before reaching
  altitude under improvised manual pitch/throttle inputs; the lateral "far away"
  case above was used instead, which the brief explicitly allows as an equally valid
  alternative and gives an unambiguous, non-fabricated "not inside" result.)

## Item 3 — AP-master physical switch (the flagged residual risk)

**Status: pass — confirmed as a real, clickable 3D-cockpit control, not a debug-hook
fallback.**

### Locating the switch
The Task 6 report flagged that pixel-precise raycast clicking of the new AP-master
switch/tuning knobs was not confirmed live in-browser. Two real obstacles had to be
worked around this session, both now resolved and documented for any future browser
verification pass in this repo:

1. **`computer` `left_click`'s coordinate space is not 1:1 with the page's own CSS
   pixel space** in this session's Browser pane, and the scale factor is not a fixed
   constant — it must be measured empirically per window size (confirmed via a
   temporary `mousedown`/`mouseup` listener logging `event.clientX/clientY`, showing
   e.g. a requested `(180, 641)` landing at actual page pixel `(221, 791)`, a ~1.233×
   scale, at an 800×942 viewport).
2. **`computer` `left_click` does not itself dispatch a `mousemove`** before the
   `mousedown`/`mouseup`, so `Input.pointerPixels()` (which `CockpitInteraction.pick()`
   raycasts from) never updates to the click location — every click raycasts from
   stale/zero coordinates and silently misses. Fix: dispatch a synthetic
   `window.dispatchEvent(new MouseEvent('mousemove', {clientX, clientY}))` immediately
   before the real `computer` click, at the same target page-pixel coordinate. A fully
   synthetic click (mousedown+mouseup dispatched via JS with no real `computer` click
   at all) was also tested and confirmed **not** to register — consistent with the
   Phase 3 report's warning that same-tick synthetic events can be silently dropped,
   confirming a real dispatched `computer` click is necessary, not just any DOM event.

With both fixed, the AP-master switch mesh (`sw_apMaster`, rightmost of the 5-switch
row) was located empirically by sweeping and toggling adjacent switches
(`masterAlternator`, `avionicsSwitch`, `pitotHeat`) as landmarks: page pixel
**(420, 791)** at an 800×942 viewport (`computer` tool-coordinate `(341, 641)` given
the ~1.233× scale factor above).

### Verification of real physical control (not cosmetic, not debug-hook)
Clean, isolated demonstration (parked at KSFO 28R, cockpit camera, no wind/AP-mode
complications):
- Before: `__ohSystems().controls.apMaster === false`.
- Real click #1 at (420, 791): `apMaster === true`, and `__ohApState().masterEnabled
  === true` with the AP actively computing (`rollCmd`/`pitchCmd`/`yawCmd` non-zero,
  `lastCommandedLateralMode: "APR"` reflecting the previously-selected mode).
- Real click #2 at the same spot: `apMaster === false` again, `masterEnabled === false`.
- **Takeover test**: with `apMaster` off, a simulated held control input
  (`__ohCtl({roll: 1})`, i.e. full right aileron, as if a key were held) was applied;
  the AP-master switch was then clicked on for real, `__ohApMode('ROL', 'PIT',
  {bankCommandDeg: 0, pitchCommandDeg: 0})` was selected, and 20 physics ticks were
  stepped **without clearing the held input**. Roll stayed at 1.1–1.2° (essentially
  level, matching the AP's commanded 0° bank) rather than rolling away toward the held
  full-deflection input — confirming `aircraft.controls` is genuinely being overwritten
  by the autopilot's output once engaged, not merely annunciated.

This directly confirms the Task 6 report's residual risk is resolved: the AP-master
switch is a real, physically-clickable 3D-cockpit raycast target, distinct from (and
correctly gated separately from) the debug-hook-only mode-select path.

## Summary for PROGRESS.md

- Item 2 (SF Bravo shelf render + detection): **pass**, clean evidence.
- Item 3 (AP-master physical switch): **pass**, clean evidence, resolves Task 6's
  flagged residual risk; also documents the click-coordinate-scale and missing-
  mousemove workarounds for future browser-verification sessions in this repo.
- Item 1 (coupled ILS half-scale hold): **not verified — blocked**. Root causes
  documented: (a) this session's Browser pane does not freeze sim time between tool
  calls, contrary to the stated ground rules, which repeatedly destroyed the intercept
  geometry before the coupled modes could engage cleanly; (b) independently of (a), the
  autopilot's HDG and APR lateral modes show a sustained, undamped oscillation rather
  than converging when engaged with more than ~15–20° of heading/course error — worth
  the controller's attention regardless of the tooling issue. Phase 4 should not be
  marked fully done on item 1 until either a clean live re-verification (with a
  properly clock-frozen harness) passes, or the lateral-mode capture behavior is
  fixed and independently confirmed via `tests/autopilot.test.ts`-style step-response
  coverage for larger initial errors.
