# Phase 3 Task 2b — G1000 PFD

## Files created

- `src/cockpit/pfd.ts` — the PFD draw module: `drawPfd(ctx, width, height, data)` plus
  the pure math/state helpers it's built on.
- `src/cockpit/types.ts` — small shared display types (`RadioStack`, `SoftkeyRegion`)
  intended to be reused by a later `mfd.ts`.
- `tests/cockpit/pfd.test.ts` — 22 Vitest tests over the pure math (no canvas mocking).

Nothing in `src/sim/`, `src/render/`, or `src/main.ts` was touched. `src/cockpit/pfd.ts`
imports `C172S` from `src/sim/aircraft/c172s.ts` (one-directional: cockpit → sim), which
keeps `tests/sim-purity.test.ts` unaffected — that guard only checks `src/sim` and
`src/math` for three.js/DOM imports, and cockpit code isn't inside either dir.

## Element-by-element implementation

- **Airspeed tape** (`drawAirspeedTape`): vertical tape, 60kt visible span, centered on
  `data.iasKt`. White/green/yellow arcs + red line drawn from `vSpeedArcs(C172S.vSpeeds)`
  — `whiteLow=Vs0`, `whiteHigh=Vfe(30°, full flaps)`, `greenLow=Vs1`, `greenHigh=Vno`,
  `yellowLow=Vno`, `yellowHigh=redLine=Vne`. Trend vector is a magenta line from the
  center marker projected 6s ahead using `iasTrendKtPerS`.
- **Trend vector math** (`makePfdTrendState`/`updateIasTrend`): tiny stateful helper —
  caller feeds it `(iasKt, dtS)` each frame and gets back a kt/s rate; first sample and
  non-positive dt both return 0 defensively. Kept separate from drawing so it's
  independently testable.
- **Attitude indicator** (`drawAttitude`): blue-over-brown horizon rect pair translated
  by pitch (40° visible span) and rotated by roll around canvas center; pitch ladder
  every 10°; fixed bank-angle scale + rotating roll pointer at the top of the box; slip/
  skid ball driven by `data.slipSkidDeg` (a proxy for `FlightData.betaDeg` — there's no
  dedicated slip-ball field on `FlightData`, this is the most direct available input,
  noted in the file's doc comment); fixed yellow aircraft symbol at center.
- **Altitude tape** (`drawAltitudeTape`): same tape mechanism as airspeed (600ft visible
  span), plus a baro-inHg readout below the tape from `data.baroInHg` (rendering only —
  no knob logic, per the task scope).
- **VSI** (`drawVsi`): a simple vertical scale ±2000fpm with tick marks at 1000fpm
  intervals and a magenta pointer/wedge — simpler tape-style choice per the task's "your
  call" option, not the full moving-tape-with-digital-readout G1000 VSI.
- **HSI** (`drawHsi`): rotating compass rose (rotates opposite heading so N/E/S/W stay
  correctly oriented under a fixed lubber line), heading bug from
  `data.headingBugDeg`, wind vector box (`WIND ddd°/kt`) from `data.windDirDeg`/
  `windSpeedKt`. The CDI is rendered as a fixed, centered magenta needle with static
  deviation dots and a red **NO NAV** flag — deliberately inert, since no VOR/GPS truth
  exists until Phase 4 (matches the phase plan's "CDI reads a fixed/inactive state").
- **NAV/COM boxes** (`drawRadioStack`): two stacked boxes (COM1, NAV1), each showing
  active frequency in green/bold over standby in dimmer white — the flip-flop visual.
  Plain numeric inputs only, no radio logic.
- **Transponder box** (`drawTransponder`): `XPDR` label + the 4-digit `data.squawk`,
  zero-padded.
- **OAT / TAS/GS** (`drawOatTas`): plain text readout under the airspeed tape from
  `data.oatC`, `data.ktas`, `data.groundSpeedKt` (OAT has no home in `FlightData`, so
  it's a plain numeric `PfdInput` field per the task brief).
- **Annunciator window** (`drawAnnunciator`): renders `data.annunciations: readonly
  string[]` as stacked red text lines; renders a dim "NO ANNUNCIATIONS" placeholder
  cleanly when the array is empty.
- **Softkey bezel row** (`drawSoftkeys` + exported `pfdSoftkeyRegions(width, height)`):
  12 evenly-divided boxes along the bottom `4.5%` of the canvas height. `pfdSoftkeyRegions`
  is pure geometry (no ctx) so a later 3D-cockpit-interaction task can raycast against
  the exact same rectangles used to draw the labels, rather than re-deriving the layout.

## Pure functions pulled out for testing

- `tapeValueToY(centerValue, value, pxPerUnit, centerY)` — shared scroll/scale math used
  by the airspeed, altitude, and VSI tapes.
- `vSpeedArcs(vSpeeds)` — maps the POH `vSpeeds` table onto arc boundaries.
- `makePfdTrendState()` / `updateIasTrend(state, iasKt, dtS)` — trend-vector delta calc.
- `headingDeltaDeg(fromDeg, toDeg)` — shortest-path heading delta, normalized to
  `(-180, 180]` (used conceptually for heading-bug/HSI math; also independently useful
  for later cockpit work, so it's exported and tested).
- `pfdSoftkeyRegions(width, height)` — softkey click-target geometry.

## Test results

```
npx tsc --noEmit          -> clean, no errors
npx vitest run            -> 12 test files, 90 tests passed (68 pre-existing + 22 new
                              in tests/cockpit/pfd.test.ts)
```

Full breakdown of the new file: tape-scroll math (4 tests), V-speed arc boundary math
sourced from `c172s.ts` (5 tests), trend-vector delta computation (5 tests),
`headingDeltaDeg` (4 tests), `pfdSoftkeyRegions` (4 tests) = 22 tests.

`tests/sim-purity.test.ts` still passes unmodified (2 tests) — cockpit code doesn't
import into `src/sim` or `src/math`, only the reverse.

## Browser verification

Rendering code is exempt from unit tests but not from browser verification. Built a
throwaway harness (`pfd-preview.html` + `.ts` at repo root, imported `drawPfd` and fed it
representative data through a 2048x1152 canvas), served it with the existing Vite dev
server, and screenshotted it in the Browser pane. Confirmed visually: airspeed tape with
correctly ordered white/green/yellow/red-line arcs and a visible trend vector; attitude
horizon tilting correctly with pitch/roll input, pitch ladder, bank pointer, slip ball;
HSI compass rose rotating correctly opposite heading with heading bug, wind box, and the
inert CDI/NO NAV flag; altitude tape, VSI pointer, radio boxes (active/standby
flip-flop), transponder squawk, OAT/TAS/GS, annunciator list, and softkey row all
present, legible, and non-overlapping at that resolution. The harness files were deleted
after verification — they are not part of the deliverable.

## Flagged assumptions (no in-repo source)

- **Softkey label set** (`PFD_SOFTKEY_LABELS`): a representative 12-key G1000 PFD bezel
  label set (`PFD, INSET, DCLTR, BRG1, HSI FMT, VOR1, ADF/DME, XPDR, IDENT, TMR/REF,
  NRST, ALERTS`). The exact stock Garmin label/order isn't in this repo; this is a
  reasonable stand-in, purely cosmetic/inert this task.
- **Tape visible spans and pixel-per-unit scale** (60kt on the ASI tape, 600ft on the
  altitude tape, ±2000fpm on the VSI, 40° pitch span on the attitude ladder): reasonable
  G1000-like layout choices, not sourced from a spec — flagged as a layout assumption
  the later 3D-cockpit-wiring task is free to retune.
- **Arc/instrument colors**: standard ASI convention (white/green/yellow/red-line) is
  public-record, not really a guess; specific hex values chosen for readability are
  cosmetic.
- **`slipSkidDeg` = `FlightData.betaDeg`**: used as instructed by the task brief as the
  most direct available proxy; there is no dedicated slip-ball field on `FlightData`.
- **OAT source**: `FlightData` has no OAT field, so `PfdInput.oatC` is a plain numeric
  input with no wiring yet (a later task supplies it, e.g. from `atmosphere.ts`'s ISA
  model or a scenario value).
