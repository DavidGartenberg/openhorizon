# A333 remaining interface audit — bounded read-only continuation

All 11 named candidates have a concrete geometric explanation and proposed local witnesses. No detached component or production mapping defect was demonstrated. These findings close the previous endpoint-identification ambiguity; they do **not** establish that the asset models internal bearings or that every original joint is mechanically complete. No source, test, mapping, or original asset was edited. Proposed witnesses below have not been added to the regression suite.

## Source and method

Only `/Users/davidgartenberg/X-Plane 12/Aircraft/Laminar Research/Airbus A330-300/objects/A330_wings.obj` was loaded. IDs below are `drawRange.start / minimum indexed vertex of welded island`, all within that file. Components come from actual indexed triangles, with coincident positions welded at 0.01 mm; unused shared-buffer vertices and whole-buffer bounding boxes are excluded. The existing OBJ parser/animation and A333 native dataref reader apply the authored transform chain. All measurements use flap fractions `0, .25, .5, .75, 1`, zero wingflex, and native slat1/slat2 values from the adapter.

The first ten components are narrow swept slat support/track geometry: their long principal geometric axis, terminal triangles, slat animation ancestry, and base contact with a specific slat skin identify their role. The last component is a broad slat skin with an integrated track. “Track” describes visible geometry and motion; no undocumented internal actuator type is asserted. The fixed partners are the specific drawn wing-skin islands vertically enclosing the terminal patch, not the nearest arbitrary fixed part.

For each terminal-patch vertex, `socketClearance` intersects the named partner’s actual triangles at that vertex’s x/z and finds a drawn skin below and above. Both clearances must be finite and positive at every sampled pose. This is evidence that the terminal is embedded in the wing envelope, not evidence of a modeled internal socket wall. The tip is not required to touch the outer skin: a buried rail end is expected to lie between skins. Earlier world-Z “aft 20%” selection missed swept-axis terminal patches; for the broad skin it selected the span extremity instead of the chordwise track tip.

## Per-component terminal and base evidence

`Min lower / upper` gives the smallest positive skin clearance over **every listed patch vertex and all five poses**, in metres. These depths are observed interior space, not attachment-distance tolerances. Base gaps are separately measured against a named drawn triangle.

| Candidate | Authored slat node / role | Terminal patch triangles | Fixed wing partner | Min lower / upper (m) |
|---|---|---|---|---|
| 19407/6449 | anim:15; slat2 rail | [6470, 6475, 6469]; [6476, 6475, 6470] | 160551/49547 | 0.081553 / 0.111629 |
| 19407/6457 | anim:15; slat2 rail | [6471, 6473, 6472]; [6474, 6473, 6471] | 160551/49547 | 0.086263 / 0.118115 |
| 24693/8112 | anim:28; slat2 rail | [8132, 8137, 8131]; [8138, 8137, 8132] | 163536/50374 | 0.100866 / 0.144596 |
| 62016/18239 | anim:59; slat2 rail | [18259, 18266, 18265]; [18260, 18266, 18259] | 45471/13102 | 0.081554 / 0.111724 |
| 62016/18247 | anim:59; slat2 rail | [18261, 18263, 18262]; [18264, 18263, 18261] | 45471/13102 | 0.086269 / 0.118211 |
| 67302/19902 | anim:70; slat2 rail | [19920, 19928, 19927]; [19921, 19928, 19920] | 48456/13929 | 0.100862 / 0.144581 |
| 13248/3796 | anim:34; slat2 rail | [4087, 4089, 4088]; [4090, 4089, 4087] | 158361/48907 | 0.111577 / 0.157681 |
| 95424/27508 | anim:82; slat2 rail | [27799, 27801, 27800]; [27802, 27801, 27799] | 43281/12462 | 0.111576 / 0.157700 |
| 107925/32278 | anim:100; slat1 rail | [32310, 32283, 32311]; [32282, 32283, 32310] | 27975/8478 | 0.084584 / 0.398850 |
| 117075/35297 | anim:101; slat1 rail | [35329, 35304, 35301]; [35330, 35304, 35329] | 27975/10282 | 0.084572 / 0.398852 |
| 15366/4406 | anim:5; integrated slat skin/track | [5457, 5456, 5458] | 3330/1242 | 0.073672 / 0.102704 |

Each rail’s other end is locally registered to the following slat skin. These are exact proposed witnesses, not a fresh nearest-part search at each deployment. The geometry remains registered in the partner triangle frame at all five poses (largest numerical coordinate drift below `1e-12 m`). Retain original nonzero seams instead of forcing contact.

| Candidate | Source vertex → moving partner | Partner triangle | Maximum original gap (m) |
|---|---|---|---|
| 19407/6449 | 6599 → 19407/5794 | [5866, 5826, 5823] | 0.000004454 |
| 19407/6457 | 6621 → 19407/5794 | [5806, 5803, 5807] | 0.000002015 |
| 24693/8112 | 8251 → 24693/7477 | [7479, 7762, 7478] | 0.000000992 |
| 62016/18239 | 18390 → 62016/17584 | [17613, 17614, 17656] | 0.000003241 |
| 62016/18247 | 18411 → 62016/17584 | [17597, 17595, 17596] | 0.000003141 |
| 67302/19902 | 20055 → 67302/19267 | [19270, 19550, 19269] | 0.000001645 |
| 13248/3796 | 4194 → 13248/3668 | [3680, 3677, 3681] | 0.000001305 |
| 95424/27508 | 27906 → 95424/27380 | [27393, 27391, 27392] | 0.000000332 |
| 107925/32278 | 32407 → 107925/34375 | [34663, 34567, 34660] | 0.007912573 |
| 117075/35297 | 35424 → 117075/37382 | [37621, 37527, 37622] | 0.007913469 |
| 15366/4406 | 4564 → 15366/4427 | [5760, 5761, 5757] | 0.008718563 |
| 15366/4406 | 4464 → 15366/4670 | [4731, 4769, 4768] | 0.000435973 |

For `107925/32278` and `117075/35297`, the paired 7.913 mm base seams are preserved on both sides and remain invariant through motion. Their geometry supports a frozen registration regression; it does not establish literal metal-to-metal contact across these original seams. Likewise `15366/4406` has original 8.719 mm and 0.436 mm seams to adjacent slat pieces. There is no evidence here that these are new motion-induced detachments.

## Integrated skin/track 15366/4406

This island spans approximately 3.064 m; its dominant principal axis follows span, not the narrow track. Projecting world +Z perpendicular to that span axis gives chord direction `[0.5008364, -0.1060768, 0.8590172]`. Vertex 5458 is at the aft chordwise extremum, world position `[-23.27883, 1.83726, 36.39284] m` at neutral. Its adjacent triangle `[5457,5456,5458]` lies within fixed wing island `3330/1242` at every sampled pose. Its position in the whole-component span-axis range is about .22, explaining why a span-axis terminal selection fails.

The track tip belongs to the skin’s actual connected triangles, not merely the same transform node. A welded triangle-edge path runs from tip 5458 (coincident with 5158) through `5158 → 5156 → 5143 → 5141 → 5123 → 5120 → 5176 → 5166 → 4449 → 4450 → 4564`; another ends `4449 → 4464`. The two final vertices are the explicit adjacent-slat witnesses listed above. This establishes drawn geometric continuity from embedded tip to the slat body, with ordinary coincident UV/normal seam vertices welded.

## Proposed regression and remaining limits

For each row, freeze the terminal patch vertex IDs, exact fixed partner, and all five measured lower/upper clearance pairs; require finite positive containment and agreement with the baseline within `1e-5 m`. This numerical tolerance is much smaller than the observed interior depths and does not turn those depths into allowable detachment gaps. Freeze the base witness position in its named moving partner triangle frame with the same `1e-5 m` tolerance; retain each original seam offset. The complete five-pose proposed numeric fixture is in `/tmp/a333-remaining-proposed-witnesses.json`. A future regression must independently move one rail/skin and demonstrate failure while a sibling remains attached.

All eleven terminal partners are identified at the drawn outer-wing-envelope level. Internal bearing/socket walls, fasteners, detailed rolling contact, continuous-time clearance between samples, nonzero wingflex, damaged geometry, and independent controls outside these slat refs were not established by this bounded audit. In particular, the four explicit nonzero base seams above remain authored visual registrations, not proven physical joints. These limits must not be replaced by a blanket “every original joint passes” claim.

## Executed diagnostics

Commands (run from the repository; source/test files unchanged):

```sh
npx esbuild /tmp/a333-remaining-audit.ts --bundle --platform=node --format=esm --outfile=/tmp/a333-remaining-audit.mjs
node /tmp/a333-remaining-audit.mjs > /tmp/a333-remaining-audit.log
python3 /tmp/write-a333-report.py
```

The bundle and diagnostic exited 0. The diagnostic parsed only the original A330 wing OBJ, emitted the 11 requested candidates, and wrote `/tmp/a333-remaining-audit.json`. The report-generation assertions validate all terminal triangle IDs, every patch vertex’s finite positive lower/upper clearance at all five poses, and all 12 base witnesses’ frame drift below `1e-12 m`. Output: `11 candidate patches: 215 vertex-pose containment checks PASS; 12 base registrations PASS`. No test suite, TypeScript check, browser, or Git command was run for this read-only continuation. Prior focused test results remain in the main Stage8a report; they are not represented as covering these proposed additions.

## Root regression integration follow-up

The proposed witnesses are now preserved in
`tests/fixtures/native-a333-slat-patches.json` with five explicit deployment
states. `tests/render/native-a333-slat-patches.test.ts` parses the actual original
wing OBJ and checks the exact drawn triangle/vertex identities, all 215 terminal
vertex-pose clearances, and all 12 base registrations. It retains the 1e-5 m
numeric tolerance and original seam offsets.

A separate mutation test clones the real geometry and moves only rail island
`19407/6449` two metres upward. Its attachment checks fail while sibling island
`19407/6457`, under the same draw and animation, still passes. This prevents
same-animation membership or one attached sibling from masking a detached rail.

Root command `npm test -- tests/render/native-a333-slat-patches.test.ts
--maxWorkers=1 --fileParallelism=false`: 2/2 tests passed, 3.37 seconds total.
No original asset or production render code changed. Independent review passed
both spec and code in `native-a333-slat-patches-review.md`, including exact
fixture equality and mutation isolation checks. The internal-bearing, wingflex,
continuous-travel and original-seam limitations above remain unchanged.
