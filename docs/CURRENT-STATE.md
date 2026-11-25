# Current state and session handoff

Audited **2026-11-25** on branch `msfs-hud-graphics-autopilot`. The published
baseline `a3d3879d16be7cad2a463071a0c034f698a532a7` includes the aircraft,
material and onboarding documentation work and all 20 earlier Claude commits
after `7ac72cf`. Its complete GitHub CI gate passed. This snapshot also describes
the following FCU glyph and Boeing spoiler/material corrections; use `git log -1`
and `git status --short` to identify the accompanying commit and any later edits.
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
- `src/cockpit/airbus-displays.ts` formats OpenHorizon state. The main flight
  displays are recreated on canvases and remain short of pixel-identical X-Plane
  instruments. `src/cockpit/airbus-fcu.ts` now uses the installed A330 digit,
  sign, dash and label images at authored ACF positions. It includes per-digit
  atlas rows (the VS atlas has fixed zero rows), and readable missing-art
  fallbacks. AP2 and managed speed/vertical schedules remain unsupported.
- Main flight browser inspection loaded the native A333 deck and live HUD in
  cockpit view. Evidence: `/tmp/openhorizon-a333-flight.jpg`. That screenshot
  is a visual check, not proof of every screen, aircraft fit, night mode or
  manipulator.
- The light Airbus QA scene loaded native A333 and fitted A320/A388, each with
  18 objects, 775 controls and zero parser/asset warnings. A333 day/night and
  A320 High/Ultra/Performance with Factory/In-service/Weathered rendered with
  no captured browser warnings or errors. Screenshots are temporarily at
  `/tmp/openhorizon-airbus-fcu-native.jpg`, `openhorizon-airbus-fcu-night.jpg`
  and `openhorizon-a320-ultra-fcu.jpg`. This is a deterministic instrument
  scenario, not a full flight or performance gate.

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
- The following correction also removes the old procedural skin shader's fake
  seams/rivets from projected surfaces, retaining the shared fine-detail pack.
  Original owned livery materials release their references immediately. Newly
  added airliner spoiler panels now carry artwork tags; B744/B77W each apply
  donor paint to all 14 panels. The tire keeps the rubber detail pack.
- The installed source test measured atlas coverage from 65% on reverser
  sleeves through 100% on flaps and tires. A browser aircraft-studio view of
  the B744 retains its four-engine silhouette and shows projected paint. See
  `/tmp/openhorizon-b744-artwork-clean.jpg`. The source B738 comparison is
  `/tmp/openhorizon-b738-source.jpg`.
- Live production-size chart coverage was 71–100%, with a 53.7 MiB estimated
  shared GPU footprint including mips for 5,275,648 chart pixels, color and
  finish maps. The B744 and B77W studio showed zero artwork warnings and no
  captured shader/console warnings or errors. B744 deployed spoilers were
  inspected in Ultra, and Performance/Factory/low-sun was exercised. Evidence
  is at `/tmp/openhorizon-b744-spoiler-textured.jpg` and
  `/tmp/openhorizon-b77w-clean-paint.jpg`.
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
  The browser checks above exercise the current renderer and quality modes.
  Full-scene sustained frame-time acceptance, cross-GPU coverage and complete
  image comparisons remain open. Do not extrapolate the light QA scene's
  observed 29–45 fps into acceptance of the 60 fps whole-world budget.

## Verification observed on this checkout

Commands used the repo Node toolchain (`~/.local/node/bin` on PATH).

| Check | Result | Scope and limits |
|---|---|---|
| PR #6 `npm test` on final dependency commit | PASS | Vitest 4.1.12; 77 files, 1,181 passed and 4 skipped |
| PR #6 `npm run build` | PASS | TypeScript and Vite production build; existing large-chunk warning |
| PR #6 `npm run validate` | PASS | 6 files, 547 passed and 4 skipped |
| PR #6 `npm audit` | PASS | Zero advisories after compatible updates; commit `ab9489fc414b48cd7199f1ad6c0f22368217ea57` |
| Clean feature branch `npm test` | PASS | Vitest 4.1.12, four-worker default; 192 files, 2,542 passed and 4 skipped in 96.59 seconds |
| Clean feature branch `npm run build` | PASS | TypeScript and Vite; 206 modules, 994.73 kB app chunk exceeds the existing 850 kB warning threshold |
| Clean feature branch `npm run validate` | PASS | 6 files, 547 passed and 4 skipped |
| Clean feature branch `npm audit` | PASS | Zero advisories after `npm ci` |

Keep the untracked DG800 files in the original user checkout preserved and out
of commits. They still have five known failing assertions and cause local
typecheck errors. They are not present in this clean branch; the committed
suite and production build pass. A four-worker default prevents the two
fleet-heavy geometry suites from starving one another.

## Live GitHub state

Queried with `gh pr list` on 2026-11-25:

| PR | Remote head | State/checks | Required next step |
|---|---|---|---|
| #9, simulator work | `a3d3879d16be7cad2a463071a0c034f698a532a7` | CLEAN; baseline CI verify passed with install, type-check, full tests, validation and production build | Publish and inspect CI for the following FCU/spoiler/test-runner correction |
| #8, shell UI | `dd97d411e12a29ad867b65f5a9da3a39f4288d66` | CLEAN; no checks | Confirm it remains an ancestor/subset of #9; no merge requested |
| #6, Vitest 4 update | `ab9489fc414b48cd7199f1ad6c0f22368217ea57` | Updated and mergeability recalculating; no checks configured on its `main` base | Hosted checks are absent because that base has no workflow; isolated full gates and zero-vulnerability audit passed before push |

The published baseline's successful CI run is
[here](https://github.com/DavidGartenberg/openhorizon/actions/runs/45518536711/job/138884185757).
It does not verify later edits. PRs #6 and #8 also had no blocking reviews and
were MERGEABLE in this audit. Do not merge PRs by default. Never commit
installed X-Plane asset bytes or derived artwork; they stream locally through
`/xp/`.

## Worktree and known limits

- The original Airbus, Boeing artwork, materials, OBJ8 decals, AP LOC conversion
  and onboarding documentation were published in `a3d3879`. This follow-up adds
  native FCU glyphs, corrects Boeing spoiler/old-shader paint, and bounds Vitest
  workers after reproducing contention timeouts. Review `git diff` and
  `git status --short` before staging further changes.
  Do not stage `tests/dg800-*.test.ts`.
- The goal's fleet-wide texture requirement is incomplete. Non-A333 Airbus
  exteriors still retain procedural paint; some other types still use procedural
  fallbacks or scaled exterior donors. The A330 exterior has several separately
  mapped fuselage sections, so extending its artwork needs a multi-source
  projector, not an unrelated atlas assigned to target UVs. Preserve each
  Boeing's own geometry while expanding coverage.
- `PROGRESS.md` holds the dated project history. Older Phase 4 / Fable documents
  are historical; later entries supersede them. Do not remove their evidence.
- The X-Plane install is read-only. `XPLANE_DIR` points to
  `/Users/davidgartenberg/X-Plane 12/Aircraft/Laminar Research` by default;
  `/xp/` streams original assets at runtime.
- Before claiming completion, reconcile every local change, update the docs
  with fresh test/browser evidence, publish the reviewed branch, verify the new
  CI SHA, and audit all open PRs. The current evidence does not prove the full
  objective complete.
- The isolated QA server was restarted on `127.0.0.1:5188` with HMR disabled.
  Verify its live process and HTTP response before relying on it in a new
  session. The user's `localhost:5173` flight must not be reloaded during work.
