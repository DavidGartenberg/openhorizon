# Contributing to OpenHorizon

Thanks for your interest in contributing! This project has a strict engineering
discipline (see `docs/FLIGHT-SIM-MASTER-PROMPT.md`), and contributions are
expected to follow it.

Start with [docs/START-HERE.md](docs/START-HERE.md) and
[docs/CURRENT-STATE.md](docs/CURRENT-STATE.md) for the current checkout, baseline
failures and relevant evidence. The [architecture map](docs/ARCHITECTURE.md) and
[development guide](docs/DEVELOPMENT.md) cover ownership, setup, debugging and
verification in detail.

## Ground rules

1. **Never fake an instrument.** Every gauge, annunciator, and display must be
   driven by real simulation state. No canned animations, no hardcoded
   "plausible" readouts.
2. **If something can't be done accurately, don't silently degrade it.**
   Implement the most honest version you can, and record the gap explicitly
   in `PROGRESS.md` under a "Deviations" heading, with the reason.
3. **Pure simulation code stays pure.** Code in `src/sim/` must not import
   from `three` or touch the DOM — it should be fully unit-testable headless.
   Rendering and world-data plumbing live in `src/render/` and `src/world/`.
4. **Test before you claim it works.** `npm test` and `npm run validate` must
   pass before opening a PR. If you're changing flight physics, add or update
   a case in `tests/validate/` that checks it against real published numbers
   (POH data, published performance specs, etc.) rather than an arbitrary
   tolerance.

## Getting set up

```bash
npm ci
npm run dev
```

This runs the Vite client (`:5173`, with HMR) and the Express data server
(`:8787`) together. Express is a plain Node process; restart it after server edits.

Vite mounts the same data handlers itself, so `npm run dev:client` can also run
alone. On the current development machine, prepend `~/.local/node/bin` to PATH.
Use a separate origin for browser experiments to preserve active flight state,
saved settings and hardware calibration.

## Development workflow

1. Inspect `git status --short` and the active branch. Preserve existing changes,
   including untracked tests. For a standalone contribution, fork the repo and
   create a branch off `main`; for an ongoing session, establish the correct base
   from current work rather than resetting the user's checkout.
2. Make your change. Keep it focused — a bug fix doesn't need to also
   refactor nearby code.
3. Run the full gate locally:
   ```bash
   npm run build   # type-check + production build
   npm test        # full Vitest suite
   npm run validate  # physics/fleet validation gate
   ```
4. If your change is visible in the browser (rendering, UI, flight
   behavior), verify it there — describe what you tested in your PR.
5. Update `PROGRESS.md` with a short entry describing what changed and, if
   applicable, why (especially for anything that's a deliberate deviation
   from "fully accurate"). Refresh `docs/CURRENT-STATE.md` with exact verification,
   remaining failures, pending checks and next steps. Update architecture/setup
   references if their behavior changes. Preserve old evidence as history.
6. Open a pull request against `main` with a clear description of what
   changed and why.

## Code style

- TypeScript strict mode; no `any` without a very good reason.
- No unnecessary abstractions — prefer straightforward, readable code over
  premature generalization.
- Comments should explain *why*, not *what* — the code should already say
  what it does.

## Reporting bugs / requesting features

Please use the issue templates provided when opening a new issue — they help
us get the information we need to act on it quickly.

## Security issues

Please do **not** open a public issue for security vulnerabilities. See
[SECURITY.md](SECURITY.md) for how to report them privately.

## Questions

If you're not sure whether something fits the project's direction, open an
issue to discuss it before investing significant time in a PR.
