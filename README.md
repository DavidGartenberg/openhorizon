# OpenHorizon

A browser-based flight simulator built with **Three.js** and **TypeScript** — a headless flight model, streamed terrain, global airport/navigation loaders, weather and traffic feeds, ATC voice, aircraft systems and a selectable fleet, backed by a small Node data service. Fidelity and data coverage vary by subsystem and aircraft.

No native install, no plugin: open a tab and fly.

## New session or contributor? Start here

Read [the session entry point](docs/START-HERE.md), then
[current state and verified blockers](docs/CURRENT-STATE.md). The
[architecture map](docs/ARCHITECTURE.md), [development guide](docs/DEVELOPMENT.md)
and [documentation index](docs/README.md) explain the code, commands and historical
evidence without relying on chat context.

The [current handoff](docs/CURRENT-STATE.md) is audited 2026-11-24 and records
the checkout, Airbus deck, Boeing texture fit, material work, browser evidence,
GitHub state and remaining acceptance limits. The local Boeing projector now
removes previous procedural paint maps on projected surfaces while retaining
aircraft geometry. Do not treat this local work as published or accepted by CI
until its exact commit is pushed and checked.

## Highlights

- **World data** — Terrarium elevation tiles; global airport/runway/frequency/navaid/ILS loaders; US airspace, imagery and land cover; METAR weather and NEXRAD radar. External data availability and cache age affect results.
- **Physics-driven flight model** — a 6-DOF rigid-body sim validated against real POH performance numbers, not scripted animations. Every gauge and annunciator reads live simulation state.
- **Selectable fleet** — Cessna 172S, Piper J-3 Cub and Boeing 737-800 baseline models, plus 120 derived roster entries. Player models have dedicated procedural builders and optional exact or scaled-donor local X-Plane exteriors. Validation tiers and cockpit fidelity differ by aircraft.
- **ATC and traffic** — tower/ground/approach controllers with real frequencies and phraseology, free-text ATC you can type anything to, speech synthesis, AI pattern traffic, and live ADS-B traffic overlaid on the world.
- **Safety systems** — TCAS traffic advisories and TAWS/GPWS terrain warnings driven by the same flight data as the cockpit instruments.
- **Autopilot** — heading/nav/approach lateral modes, altitude/VS/FLC/glideslope vertical modes, coupled ILS approaches.
- **Flight recorder and grading** — a 10 Hz flight recorder, honest landing debriefs, an ACS-standards maneuver grader, a persistent pilot logbook, and scored landing challenges.
- **Cockpit polish** — a talking copilot with real callouts, animated flight controls and gear doors, exterior/interior lighting, and a from-scratch flight physics model tuned to fly the way the real airplane does.

## Getting started

Requires Node 20+.

```bash
npm ci
npm run dev
```

This starts the Vite client (`:5173`) and the Express data server (`:8787`) together. Open `http://localhost:5173`.

Vite also mounts the shared data service directly: `npm run dev:client` alone is
sufficient for development. Use `PORT=5174 npm run dev:client` for an isolated
test origin. On this machine prepend `~/.local/node/bin` to PATH before Node/npm
commands. Optional local speech tools and X-Plane assets are documented in the
[development guide](docs/DEVELOPMENT.md).

For a production-style single-process run:

```bash
npm run build
node server/index.mjs
```

After a successful build, open `http://localhost:8787`. A failed build can leave
an older `dist/`; check the build result before interpreting standalone behavior.

## Scripts

| Command | Description |
|---|---|
| `npm run dev` | Vite client with HMR + Express data server; restart Express after server edits |
| `npm run build` | Type-check and produce a production build in `dist/` |
| `npm test` | Full Vitest test suite |
| `npm run validate` | POH/fleet validation harness (physics accuracy gate) |

## Architecture

- `src/sim/` — pure, headless simulation code: 6-DOF aircraft physics, autopilot, ATC logic, systems (fuel/electrical/engine), navigation. No DOM, no Three.js — fully unit-testable.
- `src/render/` — Three.js scene, aircraft meshes, cockpit interiors, camera modes, terrain/world rendering.
- `src/world/` — world data plumbing: terrain tiles, airports/navaids/airspace, live traffic.
- `src/cockpit/`, `src/ui/` — PFD/MFD/MCP canvas-drawn instruments and the debug HUD.
- `server/` — small Express server (and matching Vite dev middleware) proxying/caching terrain, imagery, weather, traffic, and airport data from public sources.
- `tests/` — headless Vitest suites for simulation, app wiring, geometry, parsers and services; `tests/validate/` checks baseline POH and derived fleet criteria. `tests/browser/` contains separate manual browser inspection pages.
- `docs/` — the project's build contract (`FLIGHT-SIM-MASTER-PROMPT.md`) and phase-by-phase development plans.

`PROGRESS.md` is the milestone/evidence history; `docs/CURRENT-STATE.md` is the
dated session handoff. Historical plans and old test counts do not establish
current acceptance. See the architecture map for the complete subsystem layout.

## Honesty policy

This project is built under a strict rule: never fake an instrument. If something can't be modeled accurately, it's either left honestly unimplemented (and marked INOP in the UI) or the deviation is written down in `PROGRESS.md` — not silently smoothed over. See `docs/FLIGHT-SIM-MASTER-PROMPT.md` for the full contract this codebase is held to.

## Contributing

Contributions are welcome! Please read [CONTRIBUTING.md](CONTRIBUTING.md) before opening a pull request, and note that this project follows a [Code of Conduct](CODE_OF_CONDUCT.md).

## Security

Found a security issue? Please don't open a public issue — see [SECURITY.md](SECURITY.md) for how to report it privately.

## License

This project is licensed under the [MIT License](LICENSE).
