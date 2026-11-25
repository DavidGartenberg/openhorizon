# OpenHorizon session entry point

Read [docs/START-HERE.md](docs/START-HERE.md) first, then
[docs/CURRENT-STATE.md](docs/CURRENT-STATE.md). These are the maintained session
handoff; old phase plans and chat memories are historical evidence, not the
current work queue. Read the full [project contract](docs/FLIGHT-SIM-MASTER-PROMPT.md)
before changing implementation, and the relevant subsystem reports before editing.

- Preserve existing work. Start with `git status --short`; untracked tests count
  as work in progress and are included by Vitest and TypeScript.
- Keep `src/sim/` and `src/math/` headless: no Three.js or browser dependencies.
- Instruments, surfaces and warnings must follow actual simulation state.
  Record approximations and acceptance limits explicitly.
- Use `export PATH="$HOME/.local/node/bin:$PATH"` on this machine before Node commands.
- Verify changes using [docs/DEVELOPMENT.md](docs/DEVELOPMENT.md). Existing gate
  failures are recorded in CURRENT-STATE; do not report the checkout as green
  while they remain. Headless tests do not establish visual, audible or physical
  controller acceptance.
- Use a separate browser origin for experiments; preserve the user's flight,
  saved state and controller calibration. Hidden tabs can keep simulating.
- Before handing off, update CURRENT-STATE with the actual revision, results,
  unresolved issues and next steps; add a dated PROGRESS entry for meaningful work.
  Update architecture/setup docs when their described behavior changes.
