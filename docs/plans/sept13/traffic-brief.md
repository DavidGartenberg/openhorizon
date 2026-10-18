# Added Sept18 requirement — X-Plane737traffic, optional777

The user requests all displayed traffic use the installed X-Plane737graphics,
with a737/777mix if actual777assets are available. This is an explicit visual
fleet override, not a request to falsify ADS-B type or change safety kinematics.
Preserve measured track positions/callsign/altitude/type metadata and identify
visual model independently. InstalledAircraft inventory has no777ACF; do not
stretch737orA330and call it777. Search other relevant installed asset locations
only if an actual candidate appears;737can meet the unconditional requirement.

Integrate into src/render/traffic-layer.ts (currently archetype merged silhouettes),
using the corrected OBJ8/material/placement/native loader from Stage1. Share
immutable geometry/textures across targets; independent transform and animation
state per aircraft. One bounded asynchronous model load, atomic substitution,
correct pending/disposed handling, no per-frame fetch or per-target texture load.
Retain visible fallback during failure, but expose the actual native load status
so fallback is not reported as meeting the asset requirement. Inspect local
737draw count/geometry; use distance LOD and culling to preserve useful framerate.
Models must retain correct dimensions, ground clearance, landing gear/flaps and
lights. ADS-B inferred attitudes are cosmetic, not measured controls. Ground
service vehicles should not be rendered as737s merely because type is unknown.

Tests: sharing vs independent animation, late load/dispose, target removal/reuse,
actual737asset geometry/material reference, ground/air gear state and bounding
boxes, no fabricated777, retained ADS-B safety state. Browser: multiple737traffic
at airport/airborne, close/highdetail and distantLOD, one sharedresource footprint,
drawcalls/frame timing. Add report and independent review. Own traffic files;
coordinate with main/native/surface ownership before touching their interfaces.

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
