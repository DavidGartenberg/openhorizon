# Recognizable aircraft across the complete fleet — 2026-09-09

Request: all selectable planes must look like actual aircraft. Previous surface
work improved finishes but left 120 roster aircraft routed through generic shape
assumptions. Fix model construction and coverage, not just additional texture.

## Approach
Use dedicated procedural player models parameterized by actual roster span,
length, wing area and powerplant, with explicit family/type visual profiles.
Player models must never fall back to traffic silhouettes. Use coherent lofted
fuselages, readable cockpit/cabin glazing, shaped planforms and proper gear/
engines. Airliner diameter must follow family rather than length; business jets
must have their actual aft/overwing engine layout. Preserve prior finish work.

## Global constraints
- No physics edits or silent flight-data changes. Existing animation contracts,
  instrument data and collision contacts remain authoritative. Correct visual
  dimensions that previously disagreed with published span/length.
- Cover all 120 roster entries plus C172/Cub/737. Record which traits are estimates;
  do not claim CAD-exact replicas or invent model-specific sourced measurements.
- Keep source references and reasonable GPU budgets. No paid/proprietary assets.
- All new player models preserve MSAA/reversed depth, cockpit visibility and
  transparent prop/glass depth handling. Do not add expensive detail to traffic.
- Preserve all local work and leave edits reviewable; no deployment/commits.

## Tasks
1. Dedicated prop/glider player builder and explicit family traits, all non-jet
   roster entries: cabin/fuselage, wing/tail placement, nacelles/props, live gear/
   flaps. Signature buildPropAircraft(spec, params). Test family distinctions,
   geometry bounds, actual gear contacts and animation/prop interfaces.
2. Jet family profiles and airliner builder correction: diameters, actual engine
   count/location, continuous fuselage/tail, upper-deck shapes, appropriate fins/
   winglets/gear. All roster jets covered, preserve basic surface APIs.
3. Root: repair C172 proportions/construction against manufacturer reference;
   replace main's player archetype path with shared player-model factory. Expose
   complete fleet in inspection page with bounded model lifecycle and useful views.
4. Model every selectable aircraft in headless coverage tests, inspect a visual
   matrix of representative families, check runtime shaders and moving surfaces,
   run build/regressions and independent review; document remaining approximations.

References: Textron Skyhawk brochure and media photos;
https://cessna.txtav.com/-/media/cessna/files/brochures/piston/skyhawk_brochure.pdf
https://media.txtav.com/assets/225580/
Airbus airport-planning family drawings:
https://www.aircraft.airbus.com/en/customer-care/fleet-wide-care/airport-operations-and-aircraft-characteristics/aircraft-characteristics
Boeing airport planning:
https://www.boeing.com/commercial/airports/plan-manuals

## Implementation and verification notes
- Shared `player-aircraft.ts` catalog supplies every selectable model: 57 prop/
  glider profiles, 63 jet profiles, and the three dedicated aircraft. Main flight
  selection and the inspection studio use the same builders. Traffic retains its
  cheaper geometry for distant aircraft.
- C172 lower cabin and tail are one continuous loft; its aft station now gives
  8.28 m overall length. Cub tail stations similarly restore 6.83 m. The physics
  contacts and propeller datums stay fixed. C172 has exterior cabin furnishings,
  correctly attached light lenses, and restrained daylight light halos.
- Jet diameter follows family instead of fuselage length; wing area, engine
  topology, wingtip styles and multi-axle gear follow per-family profiles. Corporate
  liveries use separate cabin-window counts and larger Gulfstream oval windows.
- Studio exposes all 123 models, five retained at once. Shared livery atlases have
  a bounded eight-entry cache and material reference counts, retiring GPU textures
  only after the last referencing material is released.
- Tests build every model, check finite geometry, span/length envelopes, engine
  count, actual tire contact depth, gear/control-surface animation and multi-prop
  rotation. The prior generic-radius test was corrected: its 1.2 m minimum radius
  was incorrectly requiring oversized cabins on light business jets.

### Fidelity limits
These are procedural visual reconstructions with explicit family profiles, not
manufacturer CAD or scanned aircraft. Roster length/span/wing area and calibrated
physics contacts are authoritative; cockpit contours, fuselage sections, window
spacing and small fittings remain visual estimates. Cabin interiors are still the
existing shared simulation panels. Some detailed gear-door, duct, control-linkage,
livery and variant-specific production details remain approximations. This pass
changes rendering only; it does not claim improved aerodynamic accuracy.

### Final checks (2026-09-09)
- `npm test`: 87 files passed; 1,277 tests passed, 4 existing skips. Includes the
  full aircraft physics/POH/takeoff validation suite. Entire-fleet construction
  tests have a 60-second timeout for slower machines while building 57/123 models;
  geometry/animation assertions are unchanged.
- `npm run build`: TypeScript and production bundling pass. 113 modules;
  application chunk 929.07 kB (273.54 kB gzip). Existing >500kB chunk warning remains.
- Browser visual matrix: C172 in actual flight (chase/cockpit/orbit, clear forward
  sightline), SR22, Citation CJ2, HondaJet, Falcon7X, Q400, ASK21, 737,747,A380;
  daylight/low sun, deployed flaps and gear retraction. Runtime error log clear.
- Review caught and resolved atlas lifetime leaks and opaque propeller-disc
  shadows. Subsequent visual checks corrected Cirrus roof/window layout,
  transport-prop cabin proportions, glazing intersections, jet cockpit height,
  and glider stilt-like landing gear.
- Glider visual exception: the original physics contacts remain invisible
  markers. Visible wheels are a recessed centerline belly wheel and an attached
  tail wheel; exterior vertical placement follows that construction. No collision
  or aerodynamic parameters changed. The studio rests the gear plane on the
  apron, including the nose-up stance of taildraggers.
