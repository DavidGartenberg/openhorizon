# Phase 14 plan — Visual traffic (approved mega-plan, phase 4 of 5)

Live real-world ADS-B rendered as typed 3D aircraft with labels, on
TCAS + MFD; richer simulated AI at towered fields. Live traffic is
display + TCAS only — it does NOT talk on the simulated tower
(recorded deviation). Every slice: suite + validate + tsc, one commit,
`__ohPerf` sanity against §23 (binding re-measure remains 15e).

## Slices (one commit each)

- **14a. `/api/traffic` endpoint.** Pure `normalizeAdsb(json,
  provider)` in parse.mjs (TDD, captured-shape fixtures per provider)
  → `{ac:[{id hex, cs, t, lat, lon, altFt baro, gnd, gsKt, trk,
  vsFpm, ageS}], ts}`. handlers.mjs `trafficData(lat, lon)`:
  0.25°-bucketed cache, 40 nm radius, 10 s TTL, single-flight dedup,
  ≥5 s global upstream spacing, provider chain adsb.lol → adsb.fi →
  OpenSky-anon with per-provider cooldowns, stale-while-error (cached
  payload keeps its old `ts`; the client's age display climbs).
- **14b. Client live store** (pure `/sim`, TDD): ingest polls,
  dead-reckon between them, ~2 s exponential blend on update (no
  teleports), expire >30 s, cap 40 by range. Poll driver follows the
  METAR pattern (10 s or 20 km). `LIVE TRAFFIC ON|OFF` verb,
  default ON.
- **14c. TCAS/MFD integration + latent-bug fixes.** Real per-track
  ids (hex/callsign) replacing the literal 'AI'; TcasComputer evicts
  states absent from input; regression tests (two simultaneous
  intruders hold independent hysteresis; eviction; 30-track step).
- **14d. Rendering + labels.** Archetype-mesh pool keyed by ICAO type
  (12a/12b), cosmetic attitude (recorded), 13c lights, callsign/alt
  labels on one projected canvas overlay. Budget ≤80 calls for 40
  targets. Acceptance: real airliners sequencing onto KSFO 28L/R
  cross-checked against a real callsign.
- **14e. Richer sim AI + parked-forever fix.** 'landed' → taxi-off →
  done; density OFF/LIGHT/REAL = 0/2/5; one record list; Tier-C
  envelope variety. Tests: vacate ≤60 s; one-clearance invariant.

## Deviations to record at owning slices

Live targets: 10 s polling dead-reckoned, baro altitude, cosmetic
attitude, no simulated-ATC participation. Free-feed etiquette per 14a;
display-only degradation when all providers cool down.
