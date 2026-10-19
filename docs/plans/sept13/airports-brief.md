# Stage 2 — populated airports

Read global constraints in implementation.md. Implement after graphics stage.
Own src/world/airport-detail.ts, airports.ts, osm-layout.ts, new airport scenery
helpers, focused tests and a browser airport studio if useful. Only touch main.ts
to wire one bounded airport-services update. Preserve prior rendering changes.

User wants all airports to have terminals and vehicles. Match airport scale:
commercial terminal/concourse/jet bridges for large fields; smaller terminal/FBO
and hangars for GA, including short and soft runways currently excluded. Choose
one deterministic primary runway per airport (ties must not duplicate buildings).
Do not put enormous airline facilities on little grass strips.

Make buildings recognizable at approach and apron distances: glazed facades with
mullions, roofs/parapets, doors/entrance canopies, HVAC, hangar doors and tower cab.
Use bounded merged/instanced geometry/materials instead of one draw per window.
Add recognizable baggage tugs/carts, fuel tankers, buses and airport operations
vehicles where appropriate. Use a small deterministic fleet with some movement
along apron service routes, never down/across runways. Handle terrain elevations,
origin rebasing, pause/sim-time, visibility and airport eviction. Make procedural
placements visibly plausible without claiming real layout accuracy.

Existing buildTaxiwayComplex(r:RunwayLocal,big:boolean,edgeLightsOut?) owns pavement
and simple buildings together. Airports.buildAirport currently calls it only for
longest hard runway >=1100m. RunwayData.s is 0 hard,1 soft; AirportData.t 0 small,
1 medium,2 large. Coordinates detail-local x across,y up,z=-along runway;
detail.rotation.y=-heading. Airport group x east,z=-north with elev in meters.

OSM: enhanceAirportWithOsm fetches tw/ap/tm/st, extrudes real terminal footprints,
then removes the WHOLE proceduralTaxi group whenever any OSM content exists. Fix
this: taxiway-only OSM must not erase the terminal/vehicles. Preserve real mapped
footprints, enhance their facades, place vehicles safely on mapped aprons when
possible, retain missing-component fallback when no terminals. Avoid duplicates
and unsafe fallbacks on real taxiways/other runways. Handle empty/malformed data
and async response after airport eviction (no resurrected geometry/registries).
Shared module materials should not be disposed per airport; new owned resources
must be released once on removal. Existing osmIdentSegs used by ATC must stay.

Tests first for short/soft airport coverage, equal runway lengths, OSM partial data
retaining facilities, vehicle routes/runway exclusion, deterministic bounded
counts and eviction/late response. Run focused tests and tsc; root owns browser
tools because child browser startup has hung. Full report airports-report.md with
files, decisions, commands/results, remaining limits; return concise DONE status.
No commits or asset copying.
