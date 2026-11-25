# OpenHorizon: start a new session

Last audited on **2026-11-24**, source revision `72c033a` plus uncommitted aircraft,
material and documentation work on `msfs-hud-graphics-autopilot`. Begin with the dated working-tree and
verification snapshot in [CURRENT-STATE.md](CURRENT-STATE.md).

## First five minutes

1. Read [CURRENT-STATE.md](CURRENT-STATE.md): present capabilities, failing gates,
   incomplete work, and the evidence behind each claim.
2. Inspect the checkout, preserving all existing changes:
   ```sh
   git status --short
   git branch --show-current
   git log -5 --oneline
   ```
3. Read [ARCHITECTURE.md](ARCHITECTURE.md) for the code map and integration
   contracts. The app's composition root is `src/main.ts`; pure algorithms alone
   do not tell you how the browser wires them together.
4. Read [DEVELOPMENT.md](DEVELOPMENT.md) for setup, verification, data dependencies,
   persistence and debugging. Check the current baseline before changing anything.
5. Before implementation, read the full
   [master contract](FLIGHT-SIM-MASTER-PROMPT.md) and relevant reports from the
   [documentation index](README.md). Agree on the requested task's scope; a stale
   “next phase” instruction is not a new assignment.

A reusable opening prompt for a fresh session:

> Read AGENTS.md, docs/START-HERE.md and docs/CURRENT-STATE.md in the OpenHorizon
> repository. Inspect the current branch and working tree without changing them.
> Summarize the relevant implementation, verified failures and remaining acceptance
> limits for my task, then continue from the current source rather than an old
> phase handoff. Preserve existing edits and the user's active simulator session.

## What this project is

OpenHorizon is a browser flight simulator built with strict TypeScript, Three.js,
Vite, Vitest and a small Express data service. It integrates a headless 6-DOF
flight model, aircraft systems, navigation/AP/autoland, weather, ATC/traffic,
safety warnings, flight recording and a DOM/canvas cockpit and launcher.

The selectable fleet has three explicit baseline aircraft (C172S, J-3 Cub,
737-800) plus 120 derived roster entries. Derived parameters, validation tiers,
procedural visuals and optional exact/scaled-donor local X-Plane exteriors have different
fidelity limits. Do not call the entire roster study-level or assume an imported
visual changes flight physics.

Airports, frequencies, navaids and the ILS database have global loaders. Imagery,
land cover, airspace and procedures have different geographic coverage. External
data is cached and can be old or unavailable; global airport support does not
establish equally detailed world coverage everywhere.

## How to interpret conflicting documents

- **Current implementation:** inspect source, configuration, actual assets and
  fresh verification. Use CURRENT-STATE as a dated map to this evidence.
- **Requirements:** the master contract supplies the original engineering and
  acceptance rules; later user-directed extensions are recorded in plans and
  PROGRESS. The original US/C172 scope is not the entire current implementation.
- **History:** [PROGRESS.md](../PROGRESS.md) records milestones and deviations;
  its entries are not strictly chronological and later sections can supersede
  earlier limitations. “Done” in the phase table is a historical milestone,
  not a fresh whole-project acceptance result.
- **Plans/reviews:** retain failed investigations and reviews as evidence.
  Follow the later resolution links, then reproduce the relevant scenario.
  Do not promote a proposal, checked box or old test count into current proof.
- **Memory/chat:** use it to find evidence. For example, older memory says Phase 4
  coupled ILS was blocked; the checkout contains later fixes and regression
  coverage. Neither memory nor an old completion report replaces a current run.

## Session handoff checklist

Update CURRENT-STATE and PROGRESS before ending substantial work. Record:

- Date, branch and full source revision; distinguish committed changes from local
  edits and untracked files, including anything preserved from session start.
- What changed, why, and the exact files a successor should inspect.
- Commands actually run, outcomes, counts and skips; keep failures visible.
- Browser scenario/aircraft/weather/configuration and evidence when relevant;
  separate measured behavior from visual, audible or hardware checks still owed.
- Known issues, fidelity limits, and one concrete next action for each blocker.
- Review findings/resolutions and durable report links. Keep essential diagnostic
  facts in the repository, even if full logs or screenshots live temporarily elsewhere.

Do not clear the user's storage, alter their flight, stage unrelated files, or
rewrite history as part of preparing a handoff.
