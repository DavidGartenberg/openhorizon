# Native grounding follow-up

Read `native-ground-pose-audit.md` first. It contains measured indexed-tire evidence for all eight exact native variants. The user requests accurate aircraft appearance, moving parts and more accurate physics; correcting demonstrably incorrect gear geometry is within that scope. No additional permission is needed for these reversible project changes. Original installed assets must remain untouched and local.

## Delivery A: explicit gear contract and honest studio placement

Keep native scale and the established ACF CG/attachment transform unchanged. Define typed per-variant gear metadata with X-Plane indices, suspension references (including the C750 legacy alias), physical wheel/support identity, and provenance. Derive support from the actual indexed tire surfaces or a reviewed reproducible extraction, never the entire shared vertex-buffer bounding box. Avoid arbitrary per-model visual offsets.

After an asynchronous native upgrade, the studio must place the intended native support set on its floor and update camera targeting coherently. A procedural preview can retain its existing placement until the native model arrives. PA18 needs pitch and height; ASK21 uses main and tail support with the nose clear, not all three inline wheels forced onto a plane. Preserve the current surface, gear and lighting controls. Declare suspension state: an uncompressed geometry preview is not a claim about loaded parked attitude. A333 multi-axle bogies require an explicit interpretation; do not hide a remaining axle error behind the minimum wheel height.

Tests must use identified actual tire draw ranges, all intended support points, async replacement and alternate selections. Root browser acceptance covers all eight, with side views of PA18/C750/AS21 and all A333 axle clearances. This delivery fixes preview placement only; its report must not imply flight grounding is fixed.

## Delivery B: contact accuracy and authored suspension in flight

First reconcile ACF wheel hub, radius, leg extension and CG conventions with this simulation's point-contact model. Independently reconstructed ACF and visible native geometry agree to roughly 2–34 mm while the generic physical contacts differ substantially. Use that evidence to correct exact-variant contact topology and lever arms, with provenance. Do not simply copy lowest tire vertices into force lever arms, scale aircraft art, shift the whole aircraft relative to its CG, or rotate the visible aircraft independently of flight attitude.

Publish actual per-leg contact/compression from the simulation and drive the complete original gear animation paths, including PA18 bungee assemblies and C750 scissor linkage. Keep pure simulation free of Three.js/DOM. Gear-up, airborne extension, unsupported wheels, reset, pause and asynchronous load need defined zero/stable states. AS21 needs genuine inline gear/support behavior; A333 needs each bogie axle and authored articulation rather than one guessed deflection constant.

Use meaningful headless regressions for ground settling, load distribution under fuel/payload changes, braking, takeoff rotation, retraction and uneven ground. Preserve clean airborne aerodynamics and dimensions. Verify visible tire contacts against the same terrain contact heights used by physics; coordinate with the separate terrain contact correction. Main flight browser screenshots and effective gear values must show the result, not just studio success. Any aerodynamic/loading approximation must be identified and bounded.

## Workflow

Implement A and B as separately reviewed bounded tasks. Before changes, capture relevant files to a /tmp baseline. No Git or commits (Xcode licence is unaccepted); no asset writes, deployment, publishing or broad unrelated fixes. Add failing behavioral tests first, run focused serial tests and TypeScript, and report exact commands/results. No full suite until integration warrants it. Write `native-grounding-report.md`; root owns live browser/hardware acceptance. Keep limitations explicit until both deliveries have evidence.
