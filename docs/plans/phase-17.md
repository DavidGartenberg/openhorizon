# Phase 17 plan — The World (user-directed)

Going global. Terrain (terrarium), METAR, live ADS-B, and the
frequency-driven ATC already cover the planet — the US walls are two
`iso_country` filters, the A-group-only altimeter parser, and dateline
handling in the flat local-frame math. Honest degradation outside the
US, all recorded: no satellite imagery (stylized ground — the
per-pixel alpha fallback already does this), no NLCD biomes (elevation
ramp), no CIFP procedures, no FAA airspace, no NEXRAD.

## Slices

- **17a. Global data layer.** parse.mjs drops the US filters
  (airports + navaids; frequencies follows the ident set) and the
  `Us` names — buildAirports/buildNavaids/buildFrequencies. Cache
  files bump (`global-*.json`) so stale US caches never serve.
  METAR: Q-group (hectopascal) altimeters parse alongside A-groups —
  international altimetry was silently absent. geo.ts: Δlon wrap in
  toNedMeters/fromNedMeters (dateline crossing); airports.near()
  wraps its longitude cell keys. TDD throughout; payload sizes
  measured and recorded.
- **17b. World acceptance flights.** Browser verification at EGLL
  (data + Q-altimetry + live Heathrow traffic + tower ATC), RJTT or
  similar far-east field (solar time opposite SF), and a
  dateline-adjacent field (NZAA/PHNL region). Verify the honest
  absences render as designed (stylized ground, no procedures) and
  everything generic (PAPI, night lighting, ALS, replay) works
  anywhere. PROGRESS + deviations updates.
