# Stage7 — integrated verification and repair

Read all completed stage reports/current source, preserve entire goal. Full tests,
build/validate, meaningful browser checks for models/airports/safety/voice/loading/
hardware. Review complete feature diff independently. No claim of perfection.

Root main-flight smoke atKHAF30 found a serious possible terrain overlap bug:
737left runway under old hardwarethrottle74%; mesh mostly hidden under terrain
although physicsHUDAGL~8ft. Resetwhilepaused revealed aircraftbackonrunway,HUD
cachedstate untilphysics tick. Need reproduce carefully paused/known inputs.

Source evidence: TileManager.update in world/tiles.ts only skips whole coarse
tiles based on center-distance+half-width < finerRadius*.82. TerrainShader has
no coverage mask/discard for higher-resolution ready terrain; all overlapping
meshes render with only .5/6/18m coarse depth biases. AtKHAF lat37.5092lon-122.4959,
the tile containing ownship is retained at ALL4LODs:
z13/1308/3174 dist1888m halfwidth1940m;
z11/327/793 dist5675m halfwidth7761m;
z9/81/198 dist19221m halfwidth31045m;
z7/20/49 dist26904m halfwidth124179m.
Coarse interpolated mountain heights can exceed fine runway terrain by far more
than18m. Physics elevationAt picks finest ready grid; rendering can pick a higher
coarse triangle. This is an evidence-backed hypothesis, not verified solecause.
Runway flatten is additionally evaluated analytically by physics after sampling,
while render flatten occurs only at tile vertices; test that near runway edges.

Repair if reproduced: finer ready coverage must hide overlapping coarse surface,
retaining coarse fallback when finer tiles unavailable. Need holes/failure/evict/
rebase tests and actualvisualverify, not merely a bigger negativebias that hides
water/mountains. Camera terrain probe should agree with actual rendered surface.
This may deserve a bounded terrain fix before other full-project QA. Also revisit
airport foundations offrunway: primaryrunway grade handlesknownheight, but hilly
aprons can float/sink. Avoid treating tiles.elevationAt fallback0 as measured sea.

Real control smoke beforeStage6: connectedTCA whilemainshowedTHR74% afterreset.
Hardwarelevers were not deliberately moved for this test, so don't assumeidle.
Use new calibration panel and ask user for physical movement only after complete
software setup. Joystick/quadrant→state→physics→visible geometry is finalStage8.

Voice actualfixture /tmp/openhorizon-atc-phrase.wav:6.5015s16kHzmonoPCM16,
recognized "Tower, Sessna November 1-2-3 Alpha Bravo, holding short runway 27,
ready for departure." LocalCLIbase.en runs; verify sameoriginendpoint thenactual
microphone/PTTtransmit (user gesture/permission), not just constructor detection.

CONFIRMED root streamed-geometry reproduction: tests/browser/terrain-inspection
loads actual Airports+TileManager, no flight/hardware/WebGL, imageryoff, all182tiles
ready. Three downward raycasts atKHAF37.5092,-122.4959 show layers z7=60.35m,
z9=27.41m,z13=11.51m,z11=10.86m; physics=11.51m. Thus coarsegeometry49mabove
runway, with shadercurrentlyno clipping. Nearby±100m differences43.57–54.11m;
(+250north,+250east)diff60.33m,(-250,-250)diff39.26m. This confirms overlapping
coarseLOD is a real renderer/physics mismatch; notjustunknownhardwaremovement.
Finegeometry matchescenterphysics exactly; edge±100m mismatch0.0–0.31m much
smaller, still worthfixingcontract. Harnessnote rawgeometryraydoesNOTapplyfuture
fragmentclipping, so oncefixeduse actualrenderedpixel/visiblecoveragecheckor
exposeproductioncoveragepredicate to filterhits; don'texpectrawraytoptochange
ifshaderdiscardimplementsfix. Preserve coarsefallback forfinefail/evict/rebase.

Additional root source evidence Sept18: tile geometry width is computed using
metersPerDegree(tile.latC), while frame placement/physics longitude conversion
uses metersPerDegree(frame.anchor.lat). Per-tile east scale should be reconciled
with the frame so shared geographic edges coincide, particularly coarse rings.
For coverage clipping, use actual ready tile footprints with exact boundaries;
do not rasterize a coarse occupancy mask that erases kilometres of valid fallback.
Coverage must update onready/evict/rebase and survive imagery off/on. A bounded
rectangle lookup or hierarchy can avoid perfragment scans over all tiles; verify
shader uniforms do not leak between shared base and imagery materials. Root has
not implemented any terrain fix yet. Sept18 main reload now185tilesready andnative
737visible; old emptyterrain was stale tab after server restart, distinct issue.
