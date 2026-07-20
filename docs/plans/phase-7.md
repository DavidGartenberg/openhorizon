# Phase 7 plan — TCAS & TAWS (§14, §15, §24)

Acceptance (§24): all scripted encounter and CFIT unit tests pass (±1 s on
alert timing); in-sim: converging AI triggers TA with aural + display;
ridge flight at Tahoe triggers escalating TAWS; a normal ILS is silent.

## Slices (one commit each)

- **7a. TCAS core** (`src/sim/tcas.ts`, pure): tau-based logic per the
  published table — SL by own altitude (SL3 1000-2350 AGL: TA 25 s/RA 15 s
  … SL7 20k+: TA 48/35), DMOD distance floors, ZTHR vertical threshold,
  range-tau + vertical-tau gating, RA sense selection by projected
  separation, strengthen/reversal minimal, CLEAR OF CONFLICT. Presented on
  the C172 as TAS (TA-only default; RA available for the Phase-10 737 —
  §14). Scripted geometries: head-on co-alt (alert at correct tau ±1 s),
  converging climb picks the correct RA sense, slow overtake alerts via
  DMOD, diverging traffic never alerts.
- **7b. TAWS core** (`src/sim/taws.ts`, pure): GPWS modes 1 (sink rate vs
  AGL), 2 (terrain closure), 3 (altitude loss after takeoff), 4 (too low
  terrain/flaps), 5 (below glideslope), 6 (500-ft callout + bank angle);
  RAAS runway advisories (§15, promoted feature); look-ahead ribbon
  sampling terrain along track at caution ~60 s / warning ~30 s; approach
  inhibition near runways so normal landings stay silent. Alerts are
  typed events with aural text — the audio/UI layer only speaks/draws
  them. Scripted CFIT tests: ridge ahead escalates caution→PULL UP; dive
  at flat ground walks mode 1; DON'T SINK after takeoff; **a full normal
  ILS (reusing the gs-descent harness) produces zero alerts**.
- **7c. Wiring + in-sim acceptance**: feed TCAS from AI traffic states and
  TAWS from `TileManager.elevationAt` + runway data; annunciations to the
  HUD/PFD annunciator, aurals through the existing speech path, traffic
  dots on the MFD map (radar-cells pattern). Browser: converging-AI TA at
  KPAO; Tahoe ridge escalation; PROGRESS close.

## Conventions

- Pure modules, sim-time only, deterministic; alert state machines expose
  `{ level, aural, newAural }` so aurals fire once per transition.
- Tau numbers cited from the standard TCAS II tables in code comments;
  where the C172 presentation simplifies (TA-only), say so at the use site.
