# Glider airbrakes integration report

## Outcome

The supported gliders (`AS21`, `DG80`, `LS8`, and `DISC`) now receive the existing normalized speedbrake actuator and aerodynamic path. Full deployment adds calibrated parasite drag and lift dump; a closed lever adds neither, so clean flight is bit-identical to the same parameters with no airbrake capability. ASK 21 travel is one second in each direction, commands and travel clamp to `[0,1]`, and `spawnOnGround()` resets command, position, and arm state.

Touchdown auto-deploy is now an explicit spoiler capability. Derived jets and the standalone B738 retain it; gliders declare it false. The main `V` path cycles those gliders directly between DOWN and FULL, and their hardware ARM detent is ignored instead of creating a false jet ARM state. ASK 21 retains its verified `flapDetentsDeg: [0]` configuration.

## Sources and calibration limits

- Local X-Plane source: `/Users/davidgartenberg/X-Plane 12/Aircraft/Laminar Research/Schleicher ASK 21/ASK21.acf` declares 95-degree flight and ground speedbrake travel, one-second extension/retraction, and no touchdown auto-deploy (`_sbrk_on_td_EQ 0`). The source's `_speedbrake_size 33` is not treated as an OpenHorizon coefficient.
- Alexander Schleicher's [ASK 21 product page](https://www.alexander-schleicher.de/en/flugzeuge/ask-21/) identifies upper-wing dive brakes but provides no aerodynamic coefficient increments.
- DG Aviation's [current-manual register](https://www.dg-aviation.de/download/1039/handbuecher/86072/list-of-current-aircraft-manuals-all-dg-types-2.pdf?lang=en) lists the DG-800 variants, and its [DG-800 maintenance illustration](https://www.dg-aviation.de/wp-content/uploads/abschmieren-dg-flugzeuge.pdf) identifies the airbrake drive, box, and paddle pivots.
- The [DG-800S flight manual](https://pesee-centrage.fr/wp-content/uploads/2024/01/Flight_Manual_DG800S.pdf), page 66, documents single-piece flaperons and their negative-to-neutral coupling when the airbrakes operate. This bounded repair deliberately leaves the roster's existing DG80 flap metadata unchanged. A full DG80 flaperon/flap model is an existing missing capability and requires separate implementation; `[0]` must not be interpreted as authenticated absence of flaps.
- The DG Flugzeugbau LS8 flight manual, mirrored [here](https://www.aeroclubdesardennes.be/assets/files/ls8-s-sb-flight-man.pdf), specifies upper-surface double-height airbrakes and their pushrod control.
- Schempp-Hirth's [Discus-2 brochure](https://www.schempp-hirth.com/fileadmin/schempp-hirth/Resources/Documents/Prospekte/Discus-2ab.pdf) lists two-story airbrakes as standard equipment. The roster's generic `DISC` row is not claimed to reproduce one exact Discus sub-variant.

No cited source publishes coefficient increments transferable to this model. `dCd = 0.12` and `dCl = 0.35` are therefore explicitly calibrated simulation approximations shared across this bounded glider fleet. They preserve the established clean polar and, at the same 55 kt TAS and 90% MTOW, make the equilibrium descent angle more than 0.05 radian steeper than clean. This is useful approach-path authority, not a claim of flight-test or polar equivalence.

## RED/GREEN evidence

RED command:

```text
npm test -- tests/glider-airbrakes.test.ts --maxWorkers=1
```

Result before production edits: 4 tests ran; 3 failed and 1 passed. Failures showed `AS21` had no spoiler parameters, actuator travel remained zero, and the matched-speed deployed case could not read drag coefficients.

GREEN command:

```text
npm test -- tests/glider-airbrakes.test.ts --maxWorkers=1
```

Result after the initial implementation: 1 file passed; 5 tests passed. Coverage included all four fleet entries, ASK 21 no-flap configuration, one-second bounded travel and reset, matched-speed/mass steeper equilibrium descent, clean-flight identity, and no glider touchdown auto-deploy.

Review-fix RED command:

```text
npm test -- tests/controller-main.test.ts tests/glider-airbrakes.test.ts --maxWorkers=1
```

Result before the reviewed control helper existed: `glider-airbrakes.test.ts` passed its then-current 9 tests; `controller-main.test.ts` failed to load because `src/input/speedbrake-control.ts` did not exist. This established the missing keyboard/ARM capability seam before production code was added. A subsequent run exposed and corrected a test-harness conflict in which its mapped speedbrake axis overwrote the keyboard result; that was fixture setup, not a production failure.

Review-fix GREEN command:

```text
npm test -- tests/controller-main.test.ts tests/glider-airbrakes.test.ts --maxWorkers=1
```

Result: 2 files passed; 14 tests passed. The main control harness covers glider DOWN/FULL keyboard cycling, glider ARM rejection, and preserved jet keyboard/hardware ARM behavior. Each of AS21, DG80, LS8, and DISC also runs a live clean/deployed comparison through `spoilerCmd`, one-second actuator travel, and `Aircraft.step()` aerodynamics; deployed flight loses at least 8 m more specific energy over eight seconds from the same safe initial trim state.

Final focused review verification:

```text
npm test -- tests/glider-airbrakes.test.ts tests/controller-main.test.ts tests/spoilers.test.ts tests/reversers.test.ts --maxWorkers=1
```

Result: 4 files passed; 20 tests passed.

Focused regression command:

```text
npm test -- tests/spoilers.test.ts tests/reversers.test.ts tests/controller-main.test.ts --maxWorkers=1
```

Result: 3 files passed; 9 tests passed.

Focused glider validation command:

```text
npx vitest run tests/validate/roster.test.ts -t 'AS21|DG80|LS8|DISC' --maxWorkers=1
```

Result: 1 file passed; 8 matching tests passed and 396 unrelated cases skipped. Existing clean stall and glide-ratio validation remains green for all four gliders.

TypeScript command:

```text
npx tsc --noEmit
```

Result: exit 0 with no diagnostics.

An initial attempt used `npm test -- --runInBand tests/glider-airbrakes.test.ts`; Vitest rejected the unsupported `--runInBand` option before collecting tests. It was replaced by the serial `--maxWorkers=1` commands above.

## Changed files

- `src/sim/aircraft/params.ts`
- `src/sim/aircraft/derive.ts`
- `src/sim/aircraft/b738.ts`
- `src/sim/aircraft.ts`
- `src/sim/trim.ts`
- `src/input/speedbrake-control.ts`
- `src/main.ts`
- `tests/controller-main.test.ts`
- `tests/glider-airbrakes.test.ts`
- `tests/validate/roster.test.ts`
- `docs/plans/sept13/glider-airbrakes-report.md`

Browser verification of the real V/quadrant path and nonzero `spoilerPos` reaching the existing authored 95-degree AS21 native animation remains with root, as scoped in the brief. No renderer, DOM, native geometry adapter, original asset, hardware, or audio file was changed.

## Root actual main-simulator keyboard/native check

Fresh source loaded in main127tab1 with no active hardwarecapture. Selected `FLY AS21` via real search UI. RealVkey fromDOWN produced100% command in controllerpanel with noARM step. Allowed simulation to advance, paused, switched toorbit andzoomed; screenshot clearly showed both originalbrownupper-wing airbrake assemblies raised. PressedVagain (SPEEDBRAKE DOWN), resumed andpaused; sameclosecamera showedboards retracted flush. These screenshots verify actual mainkeyboard→simactuator→nativevisual deployment/retraction, complementing deterministic actuator/aerodynamic tests. Browserdidnot expose a numeric95°readout; exact95°adaptermapping remains covered by native unit/studio evidence. Physicalquadrant lever remainsunverified.

Restored `FLY 737`, paused withthrottle0%,ParkingON andcontrollerpanelopen; no gamepads exposed orcalibrationsaved. NativegliderHUDstillreportsresidualRPM and genericengineRUNlabels despiteunpoweredtype; that capability/UI issue is recorded separately forintegration anddoesnotclaimanactualgliderengine.
