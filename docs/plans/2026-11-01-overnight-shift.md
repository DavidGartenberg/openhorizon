# Overnight shift — 2026-11-01

Standing instruction (user, asleep, no questions): work with Codex and X-Plane to
1. make every plane look perfect and its physics perfect;
2. make every airport 1:1 (runways, taxiways) with the real layouts;
3. give every plane that isn't the player's the good X-Plane 737-class graphics;
4. make the cockpit screens perfect;
5. then check everything.

## Lanes (so two agents never edit the same file)

| Lane | Owner | Files it may edit |
| --- | --- | --- |
| X-Plane cockpit (737 deck, panel bitmap, datarefs, interaction) | Claude | `src/render/xplane-*.ts`, `tests/xplane-*.test.ts`, the X-Plane block of `src/main.ts` |
| Traffic / AI aircraft graphics from X-Plane models | Claude | `src/render/traffic-layer.ts`, `src/render/traffic-model.ts` (new), `tests/traffic-*.test.ts` |
| Airports from X-Plane `apt.dat` | Claude | `server/apt-*.mjs` (new), `src/world/apt-*.ts` (new), `tests/apt-*.test.ts` |
| Flight-model calibration against each installed `.acf` | Codex (or Claude if Codex has not started) | `src/sim/aircraft/*.ts`, `tests/aircraft-*.test.ts` |
| Docs / CURRENT-STATE / DEVELOPMENT | Codex | `docs/*` (not this file) |

Rules: stage by explicit path, never `git add -A`; never commit another lane's
uncommitted files; keep `npm run validate` green; record every deviation in
`PROGRESS.md`; X-Plane assets are read from the local install at run time and
never copied into the repository.

## Status (update as lanes finish)

- [x] 737 deck: real panel mesh + bitmap, live PFD/ND/EICAS/ISFD, lit MCP windows/lamps/dials (commit 04cdae5)
- [ ] Traffic and AI aircraft drawn with the X-Plane exterior models
- [ ] Airports from `Global Scenery/Global Airports/Earth nav data/apt.dat`
- [ ] More installed aircraft mapped (King Air, SF50, Lancair, RV-10, L-5, Aerolite, R22, S-76 …)
- [ ] Cockpit: per-draw lamp/panel lighting (`ATTR_light_level`), clickable manipulators, resting switch states
- [ ] Final check: tsc, full tests, validate, build, fresh-clone run, browser verification
