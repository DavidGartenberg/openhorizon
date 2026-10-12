# Handoff: Phase 4 CLOSED (round 4 succeeded) → next session starts Phase 5

Round 4 fixed the coupled-descent AP bug for real: range-normalized
localizer tracking (`AutopilotInputs.navRangeM`), plus two app-side wiring
defects found by independent adversarial review (sign-inverted LOC feed;
course datum now pinned continuously during tracking). Everything committed
(`842a0ab`). Suite 316/316. Full story:
`docs/plans/phase-4-autopilot-oscillation-fix-report.md` (round 4 sections);
evidence + recorded limitations: `PROGRESS.md` Phase 4 sections.

## Next session, in order

1. **Opening verification (owed)**: browser end-to-end PROC-loaded coupled
   ILS 28R KSFO via the `__oh*` hooks — the headless app-faithful path is
   reviewer-verified; the in-browser flight is the last mile. One
   javascript_exec per flight (watchdog CFITs planes between calls);
   methodology notes in `2026-07-13-sonnet-handoff-phases-2-9.md`.
2. **Phase 4 leftovers (small, do alongside Phase 5)**: range-normalize the
   GS law + raise its pitch-integrator authority (15 kt tailwind case,
   numbers in PROGRESS); VOR feed wiring test (TO/FROM sign + navRangeM).
3. **Phase 5 — weather & sky** per the active plan
   (`2026-07-13-sonnet-handoff-phases-2-9.md` Task 4) and master prompt §11/§7:
   METAR/winds proxy + parser (TDD, fixtures), QNH/temp altimetry, FIS-B
   NEXRAD (latency stamp), clouds/visibility, lightning, custom sky,
   land-cover texturing. Plan doc first (`docs/plans/phase-5.md`), escalation
   protocol unchanged.
