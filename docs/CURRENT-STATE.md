# Current state and session handoff

Audited **2026-11-24** on branch `msfs-hud-graphics-autopilot` at
`72c033a` (`PROGRESS: hard landings, saved pilot bindings, no-reload workflow`).
The local branch has advanced beyond the published PR #9 head `7ac72cf`.
Aircraft, material and documentation edits described below are also still local.
Read [START-HERE](START-HERE.md), [ARCHITECTURE](ARCHITECTURE.md), and
[DEVELOPMENT](DEVELOPMENT.md) before changing code. Inspect `git status --short`
first. Preserve the two untracked DG800 tests; they contain separate user WIP.

## Active goal: X-Plane aircraft visuals and GitHub

### Airbus cockpit

- `src/render/xplane-airbus.ts` selects the installed A330-300 flight deck for
  every Airbus roster type. The native A333 uses its ACF pilot eye. Other
  Airbus variants keep their own exterior and receive a cockpit fit based on
  cabin width and eye-to-nose placement.
- The A330 OBJ geometry, materials, manipulators and measured six display UV
  rectangles come from the local X-Plane install. `XpAirbusPanel` provides the
  simulator's live values on those faces. Captain PFD/ND, EWD, systems page,
  standby display and FCU are wired; FO displays mirror the captain.
- `src/cockpit/airbus-displays.ts` formats OpenHorizon state. The screen layout
  and most graphics are recreated on canvases, so this is not pixel-identical
  to X-Plane's proprietary running instruments. AP2 and managed speed/vertical
  schedules are unsupported. Keep those limits visible.
- Main flight browser inspection loaded the native A333 deck and live HUD in
  cockpit view. Evidence: `/tmp/openhorizon-a333-flight.jpg`. That screenshot
  is a visual check, not proof of every screen, aircraft fit, night mode or
  manipulator.

### Boeing exterior and old paint removal

- Exact 737-800/B738 still loads X-Plane's own exterior, geometry and texture
  maps through `src/render/local-aircraft.ts`.
- Every other selectable Boeing keeps its existing aircraft geometry, pivots,
  engine count and surface animation. `boeing-artwork-worker.ts` reads the
  installed 737-800 OBJ/DDS and `boeing-artwork-projector.ts` projects source
  detail onto ten existing surface classes: fuselage, wing, flap, spoiler,
  fin, stabilizer, winglet, engine, reverser sleeve and tire.
- The November 24 correction removes the previous procedural color,
  roughness and bump maps from projected surfaces. The X-Plane chart is now the
  only mapped paint source there; shared fine-detail shaders remain layered on
  top. This avoids the visible old/new paint mix. Full color replacement means
  donor markings are used where they exist; non-mapped chart gaps show the
  underlying solid material color.
- The installed source test measured atlas coverage from 65% on reverser
  sleeves through 100% on flaps and tires. A browser aircraft-studio view of
  the B744 retains its four-engine silhouette and shows projected paint. See
  `/tmp/openhorizon-b744-artwork-clean.jpg`. The source B738 comparison is
  `/tmp/openhorizon-b738-source.jpg`.
- Remaining verification: rendered day/night close-ups for every Boeing
  surface, every tail/winglet fit and moving control, shader compilation on
  supported GPUs, donor chart holes on unusual variants and performance after
  warm-up. The source atlas is the installed default B738 paint, not each
  variant's own airline livery.

### Materials

- Seven shared, generated 256² linear-data packs live in
  `src/render/material-packs.ts`: paint, metal, rubber, fabric, cockpit,
  asphalt and concrete. `material-finish.ts` adds filtered triplanar detail,
  height-derived normal relief, roughness variation and an Ultra second scale.
- Graphics settings expose Performance/High/Ultra and Factory/In service/
  Weathered. Packs are shared, mipmapped and bounded. The OBJ8 loader composes
  supported X-Plane normal decals over authored maps, then the shared finish.
- Tests prove deterministic pack generation and parser/material composition.
  GPU shader compilation, image comparisons, memory accounting and sustained
  frame-time acceptance remain open. Do not describe shader-string tests as
  rendered GPU verification.

## Verification observed on this checkout

Commands used the repo Node toolchain (`~/.local/node/bin` on PATH).

| Check | Result | Scope and limits |
|---|---|---|
| Strict TypeScript check for tracked source and tests | PASS | All source and test files excluding the two untracked DG800 WIP files |
| `npx vite build` | PASS | 205 modules; app chunk 992.64 kB, over the configured 850 kB warning threshold |
| Focused Airbus/Boeing/material/OBJ8/AP suites | PASS | 8 files, 105 tests after the old-map removal change |
| `npm run validate -- --maxWorkers=1` | PASS | 6 files, 547 passed and 4 skipped |
| Quiet committed suite `npx vitest run --exclude 'tests/dg800-*.test.ts' --maxWorkers=1` | PASS | 191 files, 2,538 passed and 4 skipped in 77.89 seconds |
| `npm run build` | FAIL | Five TypeScript errors come only from untracked `tests/dg800-main.test.ts` and `tests/dg800-simulation.test.ts`, which refer to unimplemented `flapNeutralIndex` WIP |
| Full local run with DG800 WIP included | FAIL | The DG800 tests have five known failures. The earlier 2-worker run with the browser active also had mesh-test timeouts and two worker RPC errors; the quiet committed suite above passed those tests. |

Keep the untracked DG800 files preserved and out of commits. They remain in the
default TypeScript and Vitest globs, so the user's full local `npm run build` and
`npm test` are not green until that separate WIP is resolved. The CI checkout
will not contain untracked files.

## Live GitHub state

Queried with `gh pr list` on 2026-11-24:

| PR | Remote head | State/checks | Required next step |
|---|---|---|---|
| #9, simulator work | `7ac72cf9a57a78e630f4d308210734f58822e961` | CLEAN; CI verify passed on that older head | Review local commits and changes, publish to update the branch, then wait for and inspect CI on the exact new SHA |
| #8, shell UI | `dd97d411e12a29ad867b65f5a9da3a39f4288d66` | CLEAN; no checks | Confirm it remains an ancestor/subset of #9; no merge requested |
| #6, Vitest 4 update | `3c9008b3ea7126d9320f556ba61d1563d5f5de8c` | CLEAN; no checks | Exact-head isolated install/build/test evidence is in prior handoff; refresh if integration is considered |

The previous PR #9 successful CI run is
[here](https://github.com/DavidGartenberg/openhorizon/actions/runs/42935365382/job/130243999074).
It does not verify unpushed work. Do not merge PRs by default. Never commit
installed X-Plane asset bytes or derived artwork; they stream locally through
`/xp/`.

## Worktree and known limits

- Airbus, Boeing artwork, materials, OBJ8 decals, AP LOC conversion and
  documentation changes are local and uncommitted. Review `git diff` and
  `git status --short` before staging. Do not stage `tests/dg800-*.test.ts`.
- `PROGRESS.md` holds the dated project history. Older Phase 4 / Fable documents
  are historical; later entries supersede them. Do not remove their evidence.
- The X-Plane install is read-only. `XPLANE_DIR` points to
  `/Users/davidgartenberg/X-Plane 12/Aircraft/Laminar Research` by default;
  `/xp/` streams original assets at runtime.
- Before claiming completion, reconcile every local change, update the docs
  with fresh test/browser evidence, publish the reviewed branch, verify the new
  CI SHA, and audit all open PRs. The current evidence does not prove the full
  objective complete.
