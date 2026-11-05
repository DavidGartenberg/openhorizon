# Improvement audit and one-hour goal — 2026-10-21

Evidence gathered by running the project's own gates and inspecting the repo
(not a fresh whole-project acceptance run). Branch `msfs-hud-graphics-autopilot`.

## What was checked

| Check | Result |
|---|---|
| `tsc --noEmit` | Errors only in the two **untracked** `tests/dg800-*.test.ts` files (`flapNeutralIndex`); none in tracked code |
| `npm test` | 1,915 pass, 5 fail (all in those DG800 files), 4 skipped |
| `npm run validate` | 547 pass, 4 skipped |
| `npm run build` | **Fails locally** only because `tsc` includes the untracked DG800 tests; `vite build` itself succeeds |
| `npm audit` | **8 advisories (5 critical, 2 high, 1 moderate)**. Only `proxy-addr` (via `express`) is a runtime dependency; the rest are dev tooling (`vite`, `vitest`/`tinypool`, `concurrently`, `shell-quote`, `source-map-js`). All but the `vitest` line have a non-breaking fix |
| CI | **None.** `.github/` holds only issue templates; PR #9 showed zero checks despite ~1,900 tests |
| Bundle | One 1,268 kB JS chunk (392 kB gzip); Vite warns about >500 kB. `three` and app code share a chunk, so any app change invalidates the cached engine |
| Frame pacing | Render loop is `requestAnimationFrame` only (vsync-locked) |
| Graphics settings | No way to turn off the new ambient occlusion or lens effects; no FPS readout (only ms CPU, draws, resolution) |
| Copilot | Calls out takeoff and "one thousand" but not ILS minimums |
| Source health | 0 TODO/FIXME; `src/main.ts` is 4,095 lines; no linter/formatter configured |
| Server | `server/index.mjs` sends `Access-Control-Allow-Origin: *` on the data endpoints (the voice routes correctly strip it and require loopback) |

## Everything worth improving, ranked (impact ÷ effort)

**Do now (this goal):**
1. **Add CI** (GitHub Actions: install, type-check, tests, validate, build). Biggest gap: nothing currently stops a regression from merging.
2. **Fix the runtime security advisory** and the non-breaking dev-tool advisories with `npm audit fix`; re-run all gates.
3. **Split `three` into its own chunk** so app edits don't invalidate the cached engine and the entry chunk shrinks.
4. **Turn vsync off** — an uncapped render loop (see the honest note below), with an FPS readout and a switch back to display-synced.
5. **Graphics switches**: ambient occlusion and lens effects on/off, remembered between sessions, so a slow GPU is never stuck with them.
6. **ILS minimums callouts** ("approaching minimums" at 300 ft, "minimums" at 200 ft AGL) when flying an ILS, pre-rendered like the other callouts.

**Next (not in this hour):**
7. Neural TTS voice (e.g. Piper, ~60 MB model download) — the single biggest jump in how natural the voices sound; needs a download decision.
8. Decompose `src/main.ts` (4,095 lines) into per-concern modules; the "mirror" tests that slice its source need to move with it.
9. ESLint + a formatter, wired into CI.
10. `vitest` 5 major upgrade to clear the last dev-tooling advisories (breaking; needs a test-infra pass).
11. Decide the fate of the untracked `tests/dg800-*.test.ts` (unfinished DG800 glider work): finish `flapNeutralIndex` or move them out, so `npm run build` is green locally.
12. Frame-cost telemetry: record real GPU/CPU ms per pass (AO, bloom, clouds) and auto-lower quality when over budget.
13. Cockpit surface detail (leather/fabric/brushed-metal bump maps) — modest at cockpit viewing distance.
14. Tighten server CORS (`*` → same-origin) on the data endpoints.
15. Runway/cockpit reference comparison — still blocked on the missing reference screenshots (`docs/references/` is empty).

## The one-hour goal

Ship items 1–6 above, each with tests or a verification step, each committed
separately, and leave this document updated with what actually happened.

**Done means:** `tsc` (tracked code), `npm test` (no new failures), `npm run
validate` and `vite build` pass; a CI workflow exists and its steps pass when run
locally; `npm audit --omit=dev` is clean; the build emits a separate `three`
chunk; the frame loop can run uncapped and be switched back, with an FPS readout;
AO/lens switches persist; the minimums callouts are unit-tested; this file has an
"Outcome" section.

## Honest note on vsync

A web page cannot switch off the display's vsync: the browser presents at the
monitor's refresh rate. What the page controls is whether its render loop is
*tied* to that rate. "Uncapped" decouples the loop from `requestAnimationFrame`
and renders as fast as the machine allows (ceiling 360 fps), so the frame on
screen at each refresh is as fresh as possible (lower input-to-photon latency)
and the FPS readout shows the true render rate. It costs power and heat, and it
pauses while the tab is hidden. For true vsync-off at the browser level, launch
Chrome with `--disable-gpu-vsync --disable-frame-rate-limit`; the Claude desktop
app's embedded browser cannot take those flags.

## Outcome

| # | Item | Result |
|---|---|---|
| 1 | CI | `.github/workflows/ci.yml` (type-check, tests, validate, build). Its steps were run in a **fresh clone**, which found a real problem: on a cold cache the heavy mesh tests exceeded vitest's 5 s default (2 failures + a worker timeout). Warm, the clone is green (146 files, 1,891 tests). Fixed by `testTimeout: 30_000`. |
| 2 | Security | `npm audit fix` (non-breaking): 8 advisories → 3; **runtime dependencies 0 vulnerabilities**. The remaining 3 are the vitest/tinypool dev chain (breaking major) — still on the list (item 10). |
| 3 | Bundle | `three` is its own chunk: entry chunk 1,268 kB → 741 kB (engine 531 kB, cached across app updates). Production build booted from the express server and both chunks load. |
| 4 | Vsync off | `render/frame-pacer.ts`: uncapped loop (ceiling 360 fps), parks when the tab is hidden, switchable back; FPS readout and a Frame rate control in the graphics panel; remembered. 15 unit tests. In the throttled preview pane the uncapped loop ran ~30 fps against ~2 fps for the display-synced one. See the honest note above: a page cannot turn off the display's own vsync. |
| 5 | Graphics switches | Ambient occlusion and Lens effects checkboxes, persisted (`oh-fx`); verified toggling and persistence live. |
| 6 | Minimums callouts | "approaching minimums" (300 ft) and "minimums" (200 ft AGL) while both ILS needles are received and within full scale; re-armed by a go-around or the next takeoff; pre-rendered with the other callouts. 6 new unit tests (coarse steps, silence without an ILS or while climbing, no repeats, go-around). Live check confirmed the ILS flag and latches in the running app; the 300/200 ft timing itself rests on the unit tests (the live run was disturbed — see below). |

### What the work turned up

- **Cold-cache test timeouts** (above) — would have made CI flaky on a 4-core runner.
- **The copilot only runs every 500 ms of wall-clock time** (`updateSafety`), so scripted fast-forwarding can skip callouts; verification must pace real time.
- **System load** (a load average near 70 from macOS background indexing) made the render test suites 10–100× slower and caused unrelated timeouts; they pass when the machine is quiet.
- **The browser pane is shared:** the user was clicking in the test tab while scripts ran. Scripted checks on a tab the user is using are unsafe; the final copilot check was not repeated.
- The untracked `tests/dg800-*.test.ts` changed during the session (a sixth failing case appeared) — another session is working on them.

### Not done (carried forward)
Items 7–15 above (neural TTS, `main.ts` decomposition, ESLint, vitest 5, DG800 files, frame-cost telemetry, cockpit surface detail, server CORS, reference comparison). Frame cost of the AO pass is still unmeasured.
