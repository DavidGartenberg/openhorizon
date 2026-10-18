# Stage9 — whole-fleet X-Plane visual reference

Latest explicit user request: go to X-Plane renderings and make all planes look
like those in this sim. This extends the goal; shared roughness alone is not
completion. Stage1 imported eight exact local exteriors;115procedural remain.
Stage8 must already supply physically connected animated surfaces. Preserve it.

User-authorized installed reference: /Users/davidgartenberg/X-Plane12 (actual
folder contains a space: /Users/davidgartenberg/X-Plane 12). Read-only licensed
assets via existing /xp route, never copied into repo. App automation attempted
but returned Computer Use permissions not granted; browser access works.
Official rendered references: https://www.x-plane.com/aircraft/cirrus-sr22/,
https://www.x-plane.com/aircraft/beechcraft-baron-58/,
https://www.x-plane.com/aircraft/airbus-a330-300/ and fleet aircraft pages.
Root browser can inspect screenshots; coordinate requests, don't open child CUA.
Official Cirrus gallery URLs exposed in DOM: /wp-content/uploads/2022/08/SR22_1.png,
SR22_5.png,SR22_2.png,SR22_6.png. Compare geometry/material/glass/gear, accounting
for illumination/camera rather than claiming renderer parity from one picture.

Native gaps:737 pale glass lacks interior obscuring sky; SR22 tinted opaque-looking
windows need real depth/cabin; others inspect. C172 now authored cabin/seats.
Possible additional local C90B in installed Laminar folder vs roster BE9L generic
C90: verify actual variant correspondence, or add explicit C90B selection rather
than silently relabeling. MD82 is not MD88, PA18 notJ3, A333 notA332.

Procedural shortcomings audited: prop-aircraft.ts full elliptical fuselage sits
under conformal glass patches; no actual openings/cabin depth, few surface seams
and details. Jet finishes already have per-family lofts but need credible glass
depth, distinctive gear wells/struts, inset control breaks, access panels, varied
paint/material treatment, recognisable engine intakes/exhaust/nozzle detail and
type-correct fuselage/wing junctions. Improve actual models across every profile,
not a uniformly applied metallic noise trick. Curate representative comparisons
for highwing piston, lowwing piston, twin, turboprop, glider, narrow/widebody,
regional, business jet and vintage; sweep all123 for intact bounds/assemblies.

Create high-quality shared geometric detail helpers plus profile-specific
placement, sensible instancing/batching and LOD bounds; avoid huge per-rivet draws
or bespoke 123 copies. Work within current physical dimensions; don't change
flight params to make art fit. Own render files/studio/tests. Meaningful failures
before behavior changes; focused serial tests and tsc; root browser visual QA.
Report reference-report.md with coverage table and concrete before/after evidence,
remaining approximations and resources. Numeric10x unmeasured; don't claim it.

Root rendered reference inspection completed through official Cirrus gallery:
SR22_1.png rear-quarter sunset shows actual inset rudder joint, flap separation,
hinges below the wing, thin static wicks and fabric/paint reflectance variation.
SR22_2.png daylight low side view clearly shows upholstered front/rear seats
through separate windows, dark window seals and handles, panel screws, connected
flap support brackets and wheel fairings with exposed tires. Current imported
SR22 studio windows are flat dark with no visible seats: inspect its additional
authored interior object attachments and add only necessary exterior-visible
interior, as with C172. Compare using similar low side angle and illumination.

C90 audit: actual directory Beechcraft King Air C90B/C90B.acf; descriptionC90B,
empty weight7000.12lb (~3175kg), CGY.25ft,CGZ11.449999809ft. Roster BE9L in
roster-ext.ts labelKing Air C90, empty3103kg,MTOW4581kg,span15.32m,length10.82m,
four-blade visualprofile. Variant mismatch isn't yet resolved; don't assume.

Sept18 USER UPDATE (supersedes earlier no-copy/reference-only restrictions):
User explicitly requests installed X-Plane graphics and authored animations
(rudder, ailerons, flaps, slats), original aircraft and ATC sound integration,
and traffic using installed737graphics with777onlyif actualassetsavailable.
See implementation.md Sept18 scope update. Keep source assets untouched, imports
local, no publishing. Investigate supported formats and verify actual playback/
motion; do not substitute synthetic sound and call it imported. No777ACF exists
in the current installed Aircraft tree. All20aircraft have FMOD.bank/.sndfiles.

Sept18 CORRECTION after broader asset inspection: while no777ACF is installed,
actual777scenery meshes ARE available in Resources/default scenery/sim objects/
apt_aircraft/heavy/B772_{AAL,ANZ,BAW,DAL,UAE}/B772_*_static.obj with DDSalbedo/LIT
and PNGnormal maps. Each has27,546vertices and35,692drawntriangles across two
LODblocks (0–1000m,1000–8500m). Bounds x±32.0648m,y−.0629..18.7146m,
z−6.8444..58.617m. No authoredANIMlines: inspect/correct fixedlandinggear for
airborne traffic, use proper node/trianglepartition if needed. This enables a
real737/777trafficmix rather than declaring777unavailable fromACF-onlysearch.
Do not treat scenerymesh as fullyanimatedflyable777without requiredsurfacework.
Many lightweightB738scenery meshes/liveries also exist underapt_aircraft/jet;
comparegeometry/material/LODquality withflyable737assets fortrafficperformance.

Sept18 root BARON browser QA: local-xplane source,74draws/59,543triangles in Side. Close-detail shows good panel/rivet/engine detail but transparent windows reveal wing through an empty cabin (B58_seats.obj,B58_cabin.obj,B58_panelback.obj exist and are absent frommanifest). Add relevant exterior-visible interior, not entireinstrumentstack unnecessarily. Sideviewtires appeared buried; an offline actual-index/drawRange traversal confirms native grounding mismatch below.

Root diagnostic server/cache/aircraft-audit/ground-audit.ts loads actual8OBJs withstubtextures andapplies gearPos1 plus EXACTstudio gear-derivedrootpose. It computes visible triangles only; do NOT use BufferGeometry.boundingBox per animateddraw because sharedpositionbuffersincludeunusedvertices andproducefalsehugebounds. Confirmed lowest renderedpoints relativeto ground(m): C172-.097,737-.125,BE58-.380,PA18-.354,AS21+.329,C750-.400,SR22-.118,A333-.160. EspeciallyBE58/C750/PA18tires sink andgliderfloats. Nativealignment/physicalgearcontact reconciliation is needed forcrediblegroundpose; investigate realcontactvertices,strutcompression andsimulationorigin beforechoosingfix, ratherthanscaleexactairframes orblindlyoffsetbbox (hidden/unusedverticespoisonbbox). Currentplanpreservesflightparametersforart; resolveviaaccuratevisualanchor/gearrepresentation unless a genuinephysicscorrection is separately justified. This is separate from terrainLODoverlap.
