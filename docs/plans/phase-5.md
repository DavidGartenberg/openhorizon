# Phase 5 plan — Weather & sky (§11, §7, §24)

Acceptance (§24): sim weather at KDEN matches the actual current METAR
(side-by-side); flying into a BKN layer whites out; hot-high takeoff
measurably longer. Plus §11's FIS-B NEXRAD w/ latency stamp + lightning.

## Order of work (one commit per numbered item)

0. **Owed opening verification**: browser PROC-loaded coupled ILS 28R KSFO
   via __oh* hooks (single javascript_exec; AP engaged through cockpit
   targets). Screenshot + PROGRESS note. Also the two Phase-4 leftovers:
   GS range-normalization + integrator authority (reuse
   tests/autopilot-gs-descent.test.ts tailwind case as the failing test),
   VOR feed wiring test.
1. **Server**: /api/metar?ids=… + /api/windsaloft proxy routes
   (aviationweather.gov, disk-cached w/ 10-min TTL) in handlers.mjs;
   parser in server/parse.mjs? NO — client needs it too: pure parser in
   src/sim/weather/metar.ts (TDD, fixture METARs incl. gusts, VRB, CAVOK,
   multiple cloud layers, RMK, missing fields).
2. **Weather model** (src/sim/weather/weather.ts, pure): station interp,
   layered winds (surface METAR + winds-aloft by altitude), gusts →
   WindModel; QNH + temp → atmosphere: add pressure-altitude support to
   atmosphere.ts (altimeter setting plumbed to isa()-derived density +
   indicated altitude; POH validation suite MUST stay 10/10 — ISA default
   unchanged).
3. **Sky**: custom scattering sky (replace three.js Sky addon per Phase 0
   deviation note), sun/moon/stars at night.
4. **Clouds**: METAR-driven layers (FEW/SCT/BKN/OVC at bases), billboard/
   dome impostors, in-cloud whiteout (fog density), visibility/haze from
   METAR vis.
5. **NEXRAD**: IEM tile proxy route; MFD map overlay presented as FIS-B
   with 5–10 min latency + age stamp (§11); world rain cells + lightning
   w/ distance-delayed thunder under strong cells.
6. **Land-cover texturing**: upgrade terrain-worker color ramp (Phase 2
   deviation) — NLCD-derived or improved procedural biome ramp.
7. Acceptance runs (KDEN METAR side-by-side, BKN whiteout screenshot,
   hot-high takeoff distance A/B) → PROGRESS → commit.

## Constraints

- Weather affects BOTH physics and rendering from the same state (§1).
- Live-data code paths need offline fallbacks (cached/manual weather) so
  tests never hit the network (fixtures only).
- npm run validate 10/10 after every step (altimetry touches atmosphere!).
- Escalation protocol per active plan; __oh* methodology for browser work.
