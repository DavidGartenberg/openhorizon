# Stage8 — complete moving surfaces and quadrant audit

After original stages1–7, complete the added user requirement: every available
Captain Edition quadrant control bound, visible moving ailerons/elevators/rudder
on every aircraft, flaps/spoilers physically attached through all travel.
Read global constraints and current TCA report; do not redo completed stage6.

Current audit: SurfaceState in aircraft-mesh.ts carries roll but no pitch/yaw;
main.ts passes roll only near mesh.surfaces. localDatarefReader maps authored roll
but pitch/yaw absent. Extend shared state and route actual authoritative controls
through main, all factories and native adapter. Verify sign using the simulation
body convention: right roll should right aileron up/left down; pull elevator up;
right rudder trailing edge right. Trim/AP effects should follow actual controls,
not raw hardware alone. Clamp nonfinite/missing values safely, preserve latest
state across async swap. Add studio full-travel sliders/presets for inspection.

All123 factory coverage:172 buildC172, CUB buildCub/cub-mesh,737 buildB738;
ROSTER jet types buildAirliner and nonjets buildPropAircraft. Traffic LODs separate.
Prop aircraft currently have fixed outer trailing wing named wingTrailingFixed,
solid fin plus decorative rudderAccent, and one solid horizontalStabilizer;
split actual geometry into fixed and moving sections, no overlapping whole wing
under a painted pretend aileron. Preserve type-specific V-tail ruddervators,
T-tails/canards/biplanes and authentic spoiler-only roll where needed. Do not
invent spoilers on aircraft without them solely to satisfy a generic control.
Jets also need true ailerons/elevator/rudder geometry alongside existing flaps.

Critical attachment issue: prop flap pivot currently rotates around constant-z
global-x while the taper/dihedral changes hinge positions along span. Use a hinge
frame through the real endpoints, preserving parent transforms so full-span
hinge stays attached as it rotates. Same for swept jet elevators/ailerons/rudder.
Fowler flaps need real rails/carriages/support arms connecting fixed wing mounts
to moving flap mounts, not fairing halves floating after translation. Spoilers
need panel thickness, hinge brackets and an actuator joining wing and panel;
actuator endpoints computed from actual transforms throughout travel. Legitimate
slots/gaps are okay; disconnected slabs are not. Keep pieces named and bounded.

Read native authored geometry/datarefs/ACF for all8matches. Reuse the authored
mechanisms; ensure all required parts are listed, travel calibrated and attachment
translations right. Don't overlay procedural duplicates on detailed native wing.
Include geometry/attachment regressions sampling0,.25,.5,.75,1 and ±roll/pitch/yaw,
not merely existence/name tests. Root visually inspects representative deployed
surfaces in studio and flight; tests cover entire factory catalog and real assets.

Quadrant final audit: Stage6 should have binding/calibration UI and identity-safe
state. Inventory each lever/switch/button actually exposed by connected hardware,
compare a complete table to meaningful simulator actions, add missing states and
input handling as needed. No fake no-op bindings. Hardware movement needed only
for mapping/verification; root asks user once a complete usable panel is ready.
Report any unverified physical controls honestly, don't claim all verified from
synthetic tests. Report surfaces-report.md with covering tests and limits.

Latest usergoal reinforces: also add animation to the rudder. Verify actual yaw
input and ruddertrim rotate rudder geometry in native andprocedural models.

Root exactnativeOBJdatarefinventory now native-surface-datarefs.json alongside
thisbrief (streamedread-onlyall8currentmanifestmodels). Everymodel has authored
rudder1_deg[10]; C750also rudder2_deg[10]. A333elevators usecustom
laminar/A333/flight_controls/composite_elevL/elevR, notstandardwingelevatorrefs.
C172/BE58authoredtrimrefs alsoexist. Useinventoryasstartingpointandinspect
signedkeys/hinges/ACFtravel; don'tassumeindexparityisphysicalleft/rightwithout
checkinggeometry. Failure refs found onA333mustremainhealthy, notactuated.

Sept18 USER UPDATE (supersedes earlier no-copy/reference-only restrictions):
User explicitly requests installed X-Plane graphics and authored animations
(rudder, ailerons, flaps, slats), original aircraft and ATC sound integration,
and traffic using installed737graphics with777onlyif actualassetsavailable.
See implementation.md Sept18 scope update. Keep source assets untouched, imports
local, no publishing. Investigate supported formats and verify actual playback/
motion; do not substitute synthetic sound and call it imported. No777ACF exists
in the current installed Aircraft tree. All20aircraft have FMOD.bank/.sndfiles.

Correction: actual B772 scenery assets were found under Resources/default scenery/sim objects/apt_aircraft/heavy; they can serve traffic after fixed-gear inspection. Absence of a flyable777ACF does not mean777graphics are unavailable.
Stage6 added Aircraft.appliedControlSurfaces: read this authoritative snapshot for final pitch/roll/yaw after AP/SAS/trim, not raw restored commands.
