# Night-shift plan (user-directed, 2026-08-12)

Standing plan for autonomous night work. One commit per slice, PROGRESS
entry per slice, bench + scripted-browser verification per slice, honest
deviations recorded. Multi-night: this doc tracks the frontier; each
night resumes where the last stopped.

## Tonight-sized slices

- **N0. Bug: C172 flaps deploy UPWARD** (user report). Hinge-sign fix in
  `aircraft-mesh.ts` `buildC172` surfaces(), screenshot proof at flaps 30.
- **N1. Aircraft menu.** Key-opened browsable menu replacing the typed
  `FLY` verb as the primary path: the 3 study-level ships + all 120
  roster types, grouped (GA singles / twins / turboprops / bizjets /
  airliners), name + fidelity tier per row, enter-to-fly. EVERY entry in
  the menu must actually fly (user requirement) — the roster already
  guarantees this; the menu must never list a type without params.
- **N5. "The flashing" hunt.** Reproduce and fix rendering flicker
  (suspects: runway-paint z-fighting, strobe over-brightness, shadow
  shimmer, low-fps stutter under the new meshes). NEED FROM USER: what
  flashes and when — screen, ground, lights, HUD?
- **N6. Live traffic amplification.** (Live ADS-B is already in since
  Phase 14.) Ground targets parked at real gate positions once N9 apron
  data lands; denser poll cadence; type-correct airliner meshes from N2.
- **Closing pass every night:** lights-anchor regression on new meshes,
  §23 perf gate re-measure, 45-minute zero-console-error soak.

## Multi-night arcs

- **N2. Model the airliners.** Per-family exteriors at the new 737
  standard (published dimensions, tapered panels, winglets/sharklets,
  correct engine count/placement, T-tails where real, 747/A380 humps),
  animated flaps/spoilers/gear extended to all. Families: A320 (318/319/
  320/321 + neo), 737 (700/800/900), 747, 757, 767, 777, 787, A330,
  A340, A350, A380, E-jets, CRJs, MD-80/717 class, ATR/Dash-8.
- **N3. Cockpits, photo-referenced per family.** Pull reference photos
  from the web; rebuild each panel to match the real layout: Boeing NG
  (six DUs + MCP), Airbus (FCU + ECAM, sidestick view), G1000 (stays,
  172/modern singles), classic six-pack (Cub + vintage), round-gauge
  twins/classics, turboprop EFIS. HONEST SCOPE (recorded): at primitive/
  canvas fidelity the deliverable is "unmistakably that airplane's
  layout" — positions, proportions, palette from photos — NOT
  pixel-identical replication.
- **N4. Physics toward perfect, fleet-wide.** Generalize the validation
  lattice (takeoff roll, hands-off lateral, cruise, climb) across all
  120 types with per-type audit pins where the generic derivation
  misses. Includes the 737 landing kit: thrust reversers, speedbrake
  ARM + ground-spoiler auto-deploy, honest braking, FCOM-band stopping
  distance. Includes global ILS ingestion (earth_nav open data →
  server pipeline → every published ILS on Earth tunable; stopgap
  table deleted).
- **N7. ATC you can communicate with.** Full phase-of-flight comms:
  clearance delivery → ground → tower → departure → approach → tower,
  menu-driven pilot side with readbacks, real frequency handoffs the
  user tunes, vectors that must be flown. Voice explicitly out of
  scope for now.
- **N8. Real airport ground layouts (user: "no compromises").** Ingest
  OpenStreetMap aeroway data per airport (server pipeline like
  airports/METAR): REAL taxiway centerline networks with idents, REAL
  runway geometry cross-checked against OurAirports, REAL apron/stand
  polygons, terminal building footprints (extruded — footprint real,
  height class-estimated and recorded as such). Replace the procedural
  taxiway complex at airports where OSM coverage exists; keep the
  procedural fallback (recorded honestly) where it does not.
- **N9. Real markings + signage.** Taxiway idents from OSM `ref` tags
  on real sign locations (hold-short bars at real runway intersections,
  direction signs at real junctions), standard-compliant marking
  geometry (ICAO/FAA patterns) laid on the real centerlines. Gate
  numbers on real stand positions. Deviation recorded where data has
  no ident.

## Explicitly out of scope (need user taste, not night work)

glTF/externally-authored 3D models, liveries, voice ATC, multiplayer.

## Sizing honesty

N0+N1+N5+N6+closing pass ≈ one night. N2 and N4 ≈ 2-3 nights each.
N3, N7, N8+N9 are multi-night arcs each. The frontier lives here:

## Frontier

- [x] N0 — DONE (hinge signs fixed, screenshots verified)
- [x] N1 — DONE (menu + 121/121 fleet-takeoff lattice + transport gear-geometry fix)
- [ ] N2 — not started
- [ ] N3 — not started
- [ ] N4 — not started
- [ ] N5 — blocked on user detail (what flashes?), suspects huntable
- [ ] N6 — not started
- [ ] N7 — not started
- [ ] N8 — not started
- [ ] N9 — not started
