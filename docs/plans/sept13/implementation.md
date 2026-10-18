# Simulator fidelity and controls implementation plan — 2026-09-13

User requested, in order: another major graphics improvement for every aircraft;
airport terminals and vehicles; correct TCAS/GPWS speech; voice ATC with push to
talk; adjustable weight/fuel; TCA Airbus Captain Edition quadrant; complete review.

Architecture: keep the pure simulation separate from rendering, speech and DOM.
Use existing exact local aircraft assets through the read-only X-Plane route;
retain robust procedural player models for unsupported aircraft. Extend existing
airport detail and ATC/comms systems rather than adding parallel implementations.
Use focused controllers for audio, loading and hardware input, wired from main.
Tech stack: Three.js, TypeScript, Vite, Node/Express, Vitest, browser audio/gamepad.

## Global constraints
- Preserve all pre-existing uncommitted work. Baseline: /tmp/openhorizon-sept13-baseline.
- Implement stages in the requested order; keep this progress file current.
- No publishing, external communications or commits. The Sept18 user update
  explicitly authorizes importing/copying installed X-Plane graphics, animation
  and sound assets into this local simulator. Preserve installed originals and
  keep imports local; no redistribution or remote uploads are requested.
- Keep all 123 selectable aircraft working. Exact-model substitutions only;
  do not stretch a different aircraft and present it as an exact model.
- No claimed numeric10x gain without measurement. Target major visible improvement;
  record actual mesh/texture/render evidence and remaining approximations.
- Do not claim certified TCAS/GPWS, universal airport-layout accuracy or perfection.
- Browser microphone permission and physical device motion require the user;
  perform all software preparation and supported automated checks first.
- Regressions and lifecycle/resource behavior need meaningful tests, with a final
  full test suite, build, representative browser checks and independent review.

## Stages / progress
- [x] 1 Aircraft graphics: exact local models, correct physical-material handling,
  animation alignment, upgraded shared finishes, graceful fallback, studio QA.
- [x] 2 Airport detail: commercial terminals and GA terminal/FBO appropriate to size,
  windows/roofs/jet bridges, recognizable service vehicles and safe apron routes,
  bounded instances/updates; ensure OSM airports also get missing building detail.
- [x] 3 Safety: aircraft-appropriate TCAS mode, correct warning/callout state logic,
  actual descent crossings, ground inhibition, sane conflict clearance, coherent
  priority/repeat/deduplication for spoken TCAS/GPWS vs ATC/copilot.
- [ ] 4 ATC voice: visible hold-to-talk control, keyboard/hardware press/release,
  microphone status, recognition connected to the existing transmission parser,
  English aviation normalization, transcript/error recovery, no stale sends.
- [x] 5 Loading: fuel and payload editor with units, tank capacity and mass checks,
  total-weight display, transactional changes to actual aircraft/fuel state,
  aircraft-specific persistence and safe ground-only application.
- [ ] 6 TCA: respect measured axis polarity, two thrust levers, reverse logic,
  quadrant add-on flaps/speedbrake/parking brake, calibration/identity/reconnection,
  PTT press/release; UI instructions and a live device verification checklist.
- [ ] 7 Whole-project verification: full tests/build, all model routes, representative
  airport/speech/loading/controller browser checks, independent code review.
- [ ] 8 Added user goal (finish current sequence first): audit and bind every
  available Captain Edition quadrant control, add/verify visible moving ailerons,
  elevators and rudders across the fleet, and give flaps/spoilers proper attached
  hinges/supports/mechanisms across their complete range. Verify the additional
  work with motion/attachment tests, browser inspection and available hardware.
  User reinforced: joystick movement must drive visible surfaces; quadrant
  flaps/spoilers and every button must operate actual simulator functions.
- [ ] 9 Added visual reference goal: inspect the installed X-Plane renderings and
  use their shape/material/glass/gear/control-surface detail as the reference for
  every simulator aircraft. Exact models where available; improve remaining
  type-specific models toward the same visual detail, without relabeling one
  aircraft's mesh as another or claiming equality unsupported by comparison.

- [ ] 10 Added sound goal: substantially improve engine/prop/jet, airflow, cockpit,
  ground/gear/flap and exterior audio with aircraft-specific behavior, smooth
  transitions, view/distance acoustics and sensible mixing. Preserve the verified
  safety/radio priority and PTT echo prevention. Verify actual browser playback,
  audio resource lifecycle and representative aircraft sound profiles.

## Stage 1 brief
Files: render/xplane-obj8.ts, xplane-manifest.ts, new local-aircraft adapter;
player-aircraft.ts; shared materials/detail; main.ts and aircraft-studio integration;
tests for importer material packing, asset identity, animation, fallback/lifecycle.
Existing endpoints: /xp/manifest.json, /xp/aircraft/<relative path>.
Local assets: /Users/davidgartenberg/X-Plane 12/Aircraft/Laminar Research.
Existing API: AircraftMesh {group,propDisc,surfaces?}, updateProp(mesh,rpm,dt),
SurfaceState {flapFrac,spoilerFrac,gearPos,roll?,reverseFrac?}.
Steps: inspect exact assets/datarefs and placement; write failing adapter/material
regressions; implement full matching-model load with atomic swap, bounded resources,
correct animation/texture/PBR semantics; retain visible fallback on any failure;
upgrade fleet-wide finish cues; pass focused tests and TypeScript; root rendered QA.
No copying local assets into repo. Do not use browser tools from child agents;
prior child browser creation hung for ten minutes. Root owns rendered checks.

## Later-stage preparation
Audit existing files and official references while graphics implementation runs.
Write a stage-specific brief with exact interfaces before dispatching each stage.
Record review findings and test evidence below as stages complete.

### Live work record
- Stage2 complete:21/21 focused tests,tsc0, independent spec/quality PASS.
  Root studio visually checked commercial/strip/mapped facilities and vehicles;
  hangar canopy obstruction fixed/regressed. Reviewer withdrew duplicate-apron
  concern after verifying disjoint fallback pad. Actual global catalog planner
  audit:11,408/11,408 airports planned,3,679strip5,158GA2,571commercial,none missing.
  Off-runway rough terrain and real-airport flight QA retained for Stage7.
- Root main-simulator integration check atKHAF30: initial737THR74% with connected
  hardware, reset whilepaused againTHR74%; existing Stage6 mapping needs actual
  lever ownership/idle validation. After unpaused taxi aircraft left runway and
  rendered terrain obscured all but tail despite HUD~8ftAGL; resetwhilepaused put
  mesh back on runway but HUDheading/altdata remainedstale untilnextphysicstick.
  Stage7 investigate terrain/physics height consistency and camera placement,
  rather than assuming all correct from flat studio. No new fix applied yet.
- Stage1 complete: independent review spec/quality pass; final serial focused run
  6 files,60/60 tests (all123 procedural and8installed assets), fresh tsc exit0.
  Root visually confirmed intact C172/737/SR22 and C172 cabin/glass. 737 glazing
  remains pale without cockpit interior; carry into Stage9 reference-detail pass.
  Stage2 next. All stages remain part of active goal.
- Stage1 implementation built eight exact local models plus shared fleet finishes.
  Importer/adapter/procedural-focused checks53passed; main/studio native models
  load at60fps in representative172/737 studio. Visual approval pending: root
  isolated a clockwise OBJ8 vs counterclockwise Three triangle-winding defect,
  causing near surfaces to be culled and mirrored interior textures to appear.
  Implementer correcting winding; independent graphics-review.md also requests
  a valid engine/prop focus handle after swap and stronger geometry validation.
- Root added tests/browser/system-check.{html,ts}. Live Chrome152 in-app browser
  exposes recognition/mic/gamepads, en-US localrecognition returns downloadable,
  but official install API returnedfalse. Voice stage must handle/recover this.
- Both actual TCA devices observed connected. Current idle levers -1,-1, matching
  recordedpolarity. Detailed values appended to tca-brief.md; addon identities
  still require deliberate movement. No mic recording has started.
- Local preview restarted at127.0.0.1:5173 using approved npm run dev:client prefix.
  Initial browser startup/reload timeouts recovered. Full existing-suite snapshot
  87filespassed,1283testspassed,4skips; four in-progress newtests intentionallyred
  at that time. Final whole suite still required after all stages.

- Stage3 complete: TCAS/TAWS/corridor/reset/speech logic reviewedPASS; follow-up
  prerecorded-warning driver reviewedPASS; final54focusedtests8files+tsc0.
  Root actualbrowser FIFTY→TEN andDESCEND→CLEAR each start+ended, PTTterrain
  warning repeatsbounded/completes whileTCAS+radio inhibited, parked+450ftTA
  remain silent. Original20WAV clips generated locally, noXPlaneaudiocopy.
  NativebrowserTTS hangs; arbitraryATCspeech reliablelocalTTS remainsStage4.
  Minor review: nativeutterance construction/getVoices exceptions bypass driver
  failure diagnostic; carry into Stage4 driver integration/wholebranchreview.

- Stage7 terrain issue confirmed in actualstreamedCPUgeometryinspection: all182
  tilesready atKHAF; physics+z13mesh11.51m, z7mesh60.35m (48.84mabove runway),
  z9mesh27.41m. Neighborprobes39.26–60.33m rendering/physicsdifference. Existing
  shaderhasno finercoverage discard. Repairrequired beforeintegratedsignoff.

- Latest usergoal explicitly reinforces animatedrudder, joystick-drivenallsurfaces,
  fullquadrantbuttons/flaps/spoilers, and “make the sound amazing.” Rudder remains
  Stage8 mandatory; broad audioqualitypass addedStage10 aftercurrentsequence.

- Stage4 softwareimplemented+independentreviewPASS afterphysicalreleasePTTlatch
  andforegroundgate;110focusedtests13files+tsc0. Status200andrealTTS4.74sPCM
  passed. LiveSTTHTTPtwicefailedboundedtimeout; directCLIinitial2.25ssuccess,
  laterroot+agentdirectCLIalsostalledundersevereload, soHTTP-specificdefectnot
  established. Root stoppedalldiagnosticWhisperchildren. PendingusercloseXPlane
  andresponsivebrowser/micQA; Stage4checkboxremainsopenforacceptance. Proceeding
  Stage5implementationinoriginalsequencewhileexternalresourcegateawaitsinput;
  allpendingvoicechecksremainrequiredatStage7/finalverification.

- Sept14 follow-up: original arbitrary ATC radio text synthesized through the
  production LocalVoiceClient/BrowserSpeechDriver in the lightweight browser
  studio, with actual Started and Finished media events. Main tab still times
  out on CDP focus while lightweight studio is responsive. CUA app inventory
  confirms X-Plane and Claude are now closed. Unsandboxed exact Whisper CLI
  also stalled (last output Metal embedded-library initialization), stopped
  with exit130. CPU-only backend isolation is the next diagnostic.
- Stage5 independent review found duplicate panel construction, snapshot trim
  before saved mass application, and stale fuel-selector reset metadata. Fix
  pass required before acceptance; initial tests did not cover these paths.

- Sept18 resumed from current files. Previous turn made progress: actual CPU-only
  transcription succeeded, arbitrary local ATC speech played and ended, and
  loading reset/trim/duplicate-panel fixes landed with27focusedtests+tsc0.
  Independent Sept18 re-review confirms all three fixes; live loading UI QA
  remains open. Starting Stage6 software while root verifies Stage4/5 browser.
  Git currently requires acceptance of a new Xcode license; no license accepted.
  File-based snapshots permit ongoing work without changing developer settings.

## Sept18 user scope update — authoritative added requirements
The user explicitly requests importing/copying installed X-Plane aircraft
graphics and authored rudder, aileron, flap and slat animations, aircraft sounds
and ATC sounds. Traffic must use X-Plane737graphics; include777traffic if usable
777assets are available. This expands Stages8–10 from reference-only visual/DSP
work to actual local asset integration. Preserve previous scope and current work.
Local Aircraft inventory:20aircraft families/24ACFfiles, no777ACF found. All20
aircraft have FMOD.bank/.snd rather than loose aircraftWAVs; Resources/sounds
contains ATC.bank, Master Bank.bank, environment.bank and loose sound folders.
Technical audio decoding/event mapping needs investigation; no claim of imported
sound merely from discovering a bank file. Existing eight exact player imports
are a foundation, not proof of full added scope. Traffic737requires actual
shared asset render instances and motion/LOD/resource checks. Do not relabel737
as777; report missing777asset evidence and retain737-onlyuntil a realmodelexists.

- Sept18 Stage5 accepted: all three independent source findings fixed and
  re-reviewed; actual browser singlepanel/application/restoration/blankinvalid/
  units/focustransfer checked. Cross-aircraft/airborne/hardware combinations
  remain included in later fullverification, not assumed from one737scenario.
- Sept18 Stage4 actualHTTPtranscription now200 after scoped CPUbackendfix,
 24focusedtests pass; narrow independent review underway. FullmainUI reports
 LocalWhisperready. User microphone/conversation acceptance remains unverified.
- Sept18 Stage6 dispatched tca_controls with completebrief and baseline
 /tmp/openhorizon-stage6-sept18-baseline. Added native737traffic brief.
- Sept18 new soundgoal concreteprogress: installedFMOD2.02.29Corelibrary loaded;
 original737bank327subsounds identified; sample16 “freqN175b” decoded completely
 after explicitseekData(0), converted48kHzstereoPCM16,9.091s. Actualbrowser
 metadata/start/end verified. Provenance/resultcache and diagnostic script recorded
 in xplane-audio-audit.md. Fullflightmix/originalATCphraseintegration stillopen.
- Stage6 rootbrowser found freshjets engineSTOP dueCaptain reading stale initial
 fuelFlowing=false. Implementer confirmed orderingbug and is correcting withnew
 integrationregression. Browsercurrently no gamepads; user asked connectandpress
 eachdevice nowmappingpanelready. Softwarework continuespendinghardwareinput.

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

### Sept18 controller software handoff and live follow-up
- Stage6 implementer reports67/67 focused tests across9files and fresh TypeScript exit0; independent review dispatched against tca-review.diff. Physical acceptance remains open.
- Actual browser exposed both TCA devices: pad0 Sidestick X Copilot044f:040f, pad1 Q-Eng1&2044f:0407. Raw throttles-.515/-.498 matched24/25% and sim25%; engines RUN after startup ordering fix. Later positions+.474/+.490 correctly displayed74% each. KeyboardW/S up, no override; former100% transient not reproduced or explained. Capture suppresses sim input (sim0% while capture active), so compare lever diagnostics separately.
- Asked user to put both throttles at IDLE then move only ENG1 to TOGA and leave it there for deliberate physical capture. No guessed add-on bindings saved.
- Controller and loading disclosures occupy overlapping top-right positions; independent review includes this visible layout risk.

### Sept18 confirmed physical throttle correction
- User explicitly confirmed LEFT/ENG1 at TOGA, ENG2 at IDLE: raw axis0=-1,axis1~+.491. User then explicitly confirmed BOTH physicalIDLE: raw axis0=+.481,axis1=+.485. Repeated LEFTENG1TOGA afterRetry: rawaxis0=-1,axis1=+.485. This establishes axis0 LEFT/ENG1 and reversed polarity relative to old presets; the earlier labels IDLE=-1 were UI interpretations without confirmed physical positions. Do not present them as measured physical facts. User-specific calibration must capture fullreverse,IDLE,TOGA and sign-1.
- Root found native capture blocker: ControllerCapture spreads native Gamepad/GamepadButton objects, losing prototype-accessor id/index/connected/pressed. Pure plain-object tests missed it; requested getter-backed RED regression and explicit field snapshots from implementer. No calibration saved yet. Source freeze released for this fix plus2review findings.
- Frozen pre-fix full suite:1424passed,4skipped,106files,97.52s,exit0 (/tmp/openhorizon-sept18-full-tests.log). Build TypeScript+Vite exit0;1,017KBmainbundle triggers existing500KBchunkwarning. These are pre-review-fix results; finalwholegoalchecksremain.

- Stage6 software re-review PASS after alias identity quarantine, shared paneldock and explicit WebIDL capture snapshots. Focused20/20pass4files + tsc0. Root verified expanded/collapsed Controller/Loading rectangles have8px separation; dockscrolls, nooverlay. Physicalacceptance notcomplete: pendinguserbothMAXREVERSE tobeginfixedcapture; no calibration saved. Continue independent Stage7 terrain repair whilehardwareinputpending; keep source changes coordinated withrootbrowsercapture.

- Root completed actualBaronlocalnative Side/CloseDetail browserinspection. Foundemptycabin andnativegeargrounding discrepancy, recordedreference-brief.md with8model actualindexedtriangleminimums. Diagnostic ignoresunusedsharedbuffervertices; naivebbox results were discarded asinvalid. Stage9mustresolvecrediblegroundpose andcabininteriors, notjustsharedsurfacefinish.
- User confirmed BOTH MAXREVERSE rawaxis0=+1,axis1=+1 (buttons11,15inadditiontoothers). ENG1capture restartedafterterrainHMR, pendinguser LEFTTOGA/rightfullreverse; terrain implementer nowfrozen whilecapture active. Sourcefixnativegettercaptureawaitingliveconfirmation.

### Sept18 Stage7 terrain software and browser recovery
- Terrain READY coverage/clipping, exactframefootprints/rebase, triangleelevations andresourceownership implemented;28/28 focusedtests + tsc0. IndependentreviewPASSsource, GPUacceptancepending. Reviewerminor stalequeuedgeneration canwasteworkers; implementerfixingwithqueue/accountingregression.
- OriginalGPUharness automatic7readbacks/3s stalledbrowser afterinitialready0; noactualcompletedGPUreadbacksaccepted. Browserfocus/DOM/close commands timedout repeatedly; kernelreset. NativeCodexUIcontrol explicitlynotallowed, no bypass. Requested userclose 'OpenHorizon · Terrain inspection' tab6manually, leavemain tab1. Main lastknownpausedonrunway, ENG1capture no candidate, bothphysicalMAXREVERSEraw+1; pendingearlier LEFTTOGArequest mustbe resumedonlyafterbrowserrecovered.
- HMRwaswipingcalibration onsourceedits. Added optional OPENHORIZON_HMR envflag to vite.config.ts (default behaviorunchanged) and restarteddevserverwithOPENHORIZON_HMR=0, session32384, port5173. A deliberatepageReload neededtoadoptstablecurrentcode; futureeditsnoautomaticrefresh duringhardwarework. InitialsandboxbindEPERM, approvedescalatedlaunchsucceeded. Noauto-reviewrejection.
- RevisedterrainharnessloadswithoutWebGLwork, explicitonepassincremental GPUmeasurement andStop/disposeresources. Root mustverifyafterbrowserrecovery. Native8asurfacesbriefprepared; implementationnotstarted. Preserveallmanualacceptancepending whileproceedingindependentsoftware.

- Stage7 final terrain source review PASS after stale queue identity guard and regression (14 terrain tests + tsc pass). Post-terrain full suite before final guard:1441pass/4skip/108files; build after guard exits0 with existing chunk-size warning. GPU acceptance remains pending.
- Stage8a native_surfaces implementation active against /tmp/openhorizon-stage8a-baseline. Actual indexed geometry directional tests for all8 native aircraft reported passing; attachment assertions and studio controls in progress.
- User closed stalled terrain tab; browser inventory was empty. Root reopened main sim, paused and expanded Controller panel. No gamepads exposed yet; requested button press on each with throttles held MAX REVERSE. New tab marked for handoff; no calibration saved.

- Stage10 investigation: original Matthew ATC0_final clip successfully re-containerized without changing source Opus packets; actual browser WebAudio decoding and playback start/end verified (mono48kHz,.460s,peak.3228,RMS.0700). All480headers match packet timing. No flight ATC phrase integration yet; evidence and script in xplane-audio-audit.md / atc-opus-probe.py.

### Sept18 resumed browser / ATC proof / terrain isolation
- Previous goal turn made progress (terrain software, native surface implementation, original ATC format probe); this continuation restored browser and produced actual ATC decode/playback evidence. Goal remains active and full scope unchanged.
- Main browser tab1 reopened because inventory was empty after user cleanup; actual PAUSED, controller panel expanded, no gamepads exposed. Awaiting requested button press/release on each device while both levers remainMAXREVERSE. No capture/calibration saved. Main tab marked handoff.
- Staged terrain harness now separates CPU intersections, GPU initialization and depth measurement. CPU measurement completed six observed KHAF probes before next step: visible indexed mesh vs interpolated terrain differed under0.000001m. Analytic physics flatten adds up to0.30924m at east−100m shoulder; record separately, not a universal physics agreement claim. Center sample11.514202m vs coarse rawtop78.382110m demonstrates why READY clipping matters.
- Three new diagnostic pages (tabs3,4,6) crashed. Isolated to the GPU-initialization handler after terrain loads; that handler includes renderer construction/resize/append and target construction, so exact internal call remains unknown. CPU-only intersections worked; no terrain render/readback succeeded. Empty attached WebGL2, Three wrapping attached context, and default detached Three constructor+768x432resize all succeeded in lightweight page. Visible vs hidden terrain page did not resolve failure. Main remains responsive~33fps. No production terrain change justified yet.
- Browser close on crashed tab3 rejected by URL policy for internal data crash page. No bypass; crashed test tabs unmarked for automatic cleanup. Lightweight test pages explicitly released/closed. Next diagnostic should split initialization handler further or initialize before streaming rather than blindly rerun full test. tests/browser/webgl-context.html retains bounded manual isolation actions. Root tsc passed after staged-harness changes.
- Stage8a native implementer confirmed continuation without restart; attachment regressions/studio pending. Read-only procedural_surface_audit dispatched to prepare Stage8b exact geometry gaps while root does independent QA. No parallel production implementers.

- Stage8a software initial handoff33focused+final12nativegeometry+tsc pass; independentreview needs localizedattachmentverification, signedtrim anddiagnosticlogfixes. Existing implementer activelyfixing883identifiedweldedmovingislands; no productionmapping defectconfirmed. Root all8actualstudioQA recorded native-surfaces-browser-qa.md; notfullmechanicalacceptance.
- AS21 actualflightairbrakegap found (params onlyjets). Added glider-airbrakes-brief.md with directACF/manufacturer evidence, toaddress beforefinalsurfaceacceptance. Read-only procedural audit ready butits suggestion toomitgliderairbrakes basedonoldparams explicitlysuperseded.

- Stage7 GPU breakthrough: initializeWebGLBEFOREterrainassets, thenload182tiles; all7productiondepthreads complete, no shadererrors, maxGPU−sample2.079mm. Rawcoarsecenter78.382m versusrendered11.514m provesocclusioncorrection attheseprobes. Details terrain-gpu-qa.md. CPU/GPUtestclosedwithresource release. Analyticflattenresidualup to.309m shoulder andfallback/rebaseGPUacceptance remainopen; notwholeterraincomplete.
- Native signedtrim fix discovered realPA18signerror (priorcentroidheuristicwrong); implementer correctingstabilizerSign usingactualafttrailingvertices±trim. PriorrootPA18trim+1/ref+4 observation superseded, mustrepeatcorrectedbrowsercheck.

- PA18 corrected source reloaded in fresh studio: trim+1→stabilizer−4°, trim−1→+2.5°, elevator0both. Side screenshots inspected; studio closed. Main tab1 remainsPAUSED, controllersunexposed, pendingbuttonpressquestionunchanged. Root latest tsc session42758exit0; attachmentfixtureworkstillactive.

- Grounding read-only audit completed: native scale/ACF CG sound; physical contact anchors and missing per-leg suspension cause native tire mismatch. PA18 requires pitch+height, AS21 has incorrect lateral-main topology. Full all8 tire/ACF provenance in native-ground-pose-audit.md. Added native-grounding-brief.md with separate studio metadata/placement and flight contact/suspension deliveries; neither implemented yet.
- Terrain shoulder contact design dispatched read-only to resolve duplicate flattening while preserving unloaded runway spawn and actual strip contact. No additional production terrain change yet. Main tab remains paused, gamepads unavailable; existing hardware-button question remains pending.
- Stage10 new proof: original737FMODStudio bank loads151events and engine1 exposes10parameters. Original authored engine-event mix rendered offline via installed library (not rawsample-only):8.16s stereo48kPCM16,peak.69974,RMS.11215; actualbrowser decode/start/end completed. Source/probes/provenance in xplane-audio-audit.md and local cache. Continuous flight integration, otheraircraft and subjective listening remainopen.
- Read-only terrain contact design completed in terrain-contact-design.md: nullableREADY sampling, realstripgeometry contract, unbiasedsurfacecomposition, analyticfallback onlywhenmissing. Coarseburial/streaming discontinuity requiresseparatevisual/readiness treatment; no callback-only claim ofalways-exposedrunways. Implementationpendingaftercurrentnativefix.
- Native8a review fix handed off: PA18signedtrim corrected;352localized registrations+10embedded tips and detached-panel mutation replace aggregate contact acceptance;42focusedtests/4files19.68s and tsc0. Report explicitly keeps fulljoint gate open with exact remainingA333/etcinterface IDs. Native source frozen; re-review dispatched against native-surfaces-review-fixed.diff.
- Glider airbrake actual-flight repair now dispatched to glider_airbrakes from glider-airbrakes-brief.md; baseline /tmp/openhorizon-glider-airbrakes-baseline. Sole active production implementer. Native re-review read-only. Root owns browser/hardware; no calibration saved.
- Audio metadata compatibility census: all20installedaircraft FMODStudio banks load,0failures, each recorded with SHA256 and event count in bank-studio-inventory.json. This does not claim playback for all20; only original737engine-event and earlierATCclip browser playback verified.
- Native8a bounded review-fix re-review APPROVED for code quality and corrected signedmotion/coveredregistrationtests. Exhaustiveattachmentacceptance remainsOPEN; native-surfaces-review.md names jetmechanisms,AS21supports,PA18linkageends. Do not markStage8afullcomplete. Glider implementer continues; hardwarebuttonreply stillpending.

- Glider airbrake review fixes accepted for bounded code:20focused tests+tsc PASS, independentre-review PASS. Liveflightbrowser acceptance remainsopen: temporarylocalhost tab14 stalled oninitialload andCDPfocus,closeunavailable; useraskedcloseonlylocalhosttest, preserve127main. No hardwarecapture/calibrationsaved.
- Procedural Stage8b1 next: sharedhinges/linkages, genericprops andJ3; source-evidenced AN2/MU2/DG80exceptions nowinbrief. DG80geometryexplicitanglecontract separatefromsignedsimulationimplementation, wholeflightgateopen. Snapshot /tmp/openhorizon-prop-surfaces-baseline.

- Native remainingA333 readonlyaudit identifies all11rail/slatskin terminalpatches;215vertex-posecontainment and12baseregistrations pass. No productiondefect proven. Explicitfourauthorednonzero seams andinternalbearingmodelgaps preserved; native-remaining-a333-interfaces.md and /tmp/a333-remaining-proposed-witnesses.json. Proposedfixtures notyetintegrated.
- DG800SmanufacturerMM obtained: derivednominal L18.148°, neutralroll20.137up/9.912down; fullairbrakehandle10mm beyond+5 supersedesneutral-onlyassumption. dg800-flaperon-design.md recordsprimarysource andapproximatelinkageschedule/persistence. Signedphysicsimplementationpendingafterpropsgeometrytask.
- Root originalaudioadditionalrenders: ASK21clean/deployedairbrake8.1067s andC172cruise8.2027s,stereo48kPCM16 finite/nonzero. xplane-audio-audit.md recordsmetrics/provenance/limits; noflightaudiointegrationornewbrowserplaybackclaim.
- Server127.0.0.1:5173 confirmedlistenerPID25381 andHTTP200/.012s; sandboxcurlfailed butapprovedread-onlycurlworked. Temporarylocalhost14CDPfocusstillstalled; toolsessionid32384obsoletebutserverexists. No inferredrendererrootcause orproductionfix. Mainpreserved.
- MinorUIwording followup: non-auto glider V helperstilllabelsFULL as SPEEDBRAKE FLIGHT DETENT; update to AIRBRAKES FULL during integration, behavioralreadyboundedreviewPASS.

- DG80 FMcalibration:18m525kg retractedairbrakes -9/0/+13/L stalls88/84/77/76kmh. Prior37KCASanchorwrong;37ktappears440kg/L. Rootnextbrief authorizes narrowneutralanchorcorrection andsource-derivedCLmaxincrements underexplicitIAS≈CASapproximation. docs/plans/sept13/dg800-simulation-brief.md prepared; notdispatchedwhilepropssoleimplementationactive.
- Originalauthored-audioruntimedesign dispatchedreadonly; assesscontinuouslocalFMOD→browserPCMbridge versusprerendergrids preservingoriginaleventbehavior. No runtimeintegrationyet.

- Goalcontinuation classification:previous turn PROGRESS (glider independentreview acceptance, additional originalaudio render evidence, DG80primarymechanical/stallsource corrections, proceduralimplementationstarted). Currentliveagents propsimplementation/audio-design revalidatedrunning. Main127browserresponsivePAUSED and stillnocontrollers; tab14alreadycleanedup, no additionaluserclose needed.
- Root actualearlypropsbrowserQA failed Cub skins-to-hinges placement; codealsofound prop tailhinge/cant andtopologyintervalgaps. Sentconcreteevidence backtoactiveimplementer; procedural-prop-surfaces-browser-qa.md records exactintermediatefindings. No handoffacceptanceyet. Studio15closed.

- Authoredaudioruntime feasibilityproved: persistentoriginalB738FMOD NOSOUND_NRT+masterDSPcaptures61,440stereo48kframes directlyinmemory, finitePCMpeak.6087908/RMS.1106108, no speakeroutput. ExplicitstereoDSPchannelnegotiationrequired. Design authored-audio-runtime-design.md recommendsboundedsingle-sessionPCMbridge+AudioWorklet; sustainedlatency/mapping/lifecycleallremainopen. Proofscript preserved fmod-capture-proof.py, resultcache fmod-capture-result.json.
- Rootstudioharness extendsInspectsurface toactualproceduralmesh UUID/name, usingdrawnindexedvertices; native dataref choicespreserved. Tscduringactivepropsedits found2productionintermediateerrors (unusedovalTail,FowlerPose.aft), sentagent; harnessverificationnotyetclaimedPASS.

- Root actualbrowserplayback nowPASS originalASK21clean/airbrakesevents andC172cruiseevent: eachdecoded,started,ended, browsererrorlogs[]; tab16closed. xplane-audio-audit.md updated; no liveflightaudiointegrationclaim.
- Native smallplaneendpointaudit preliminaryskin-distance defectsrequirekinematicvalidation: rootrequested authoredpivot/terminalpatch containment andcableexitcheck beforedeclaringdetachment. Rotatingvertices/slidingcables neednotremainregisteredtoonefixedexteriorskintriangle. Auditfollowupactive; no productionnativefixjustifiedyet.

- Native smallplaneaudit CORRECTION: initialAS21/PA18defectclaims retractedafterrootchallenge andactualpivot/containmentchecks. AS21terminalpatchesremaininsideexactfixedwingenvelopeatall5poses; authored40°supportrotations+paneltranslations valid. PA18counterrotatingcableterminals slideatfuselageexit; old20.817mm distancewaswrongfrozennonlocaltriangle. Updated native-smallplane-linkage-audit.md haspropercontainment/exitregionregressionproposal. No demonstratednativegeometrydefect; donotalteroriginalmotionsbasedonoldclaim.

- Root actualmainbrowser glidercheck: intentionalreloadwhilecaptureinactive, FLY AS21, realVkey→command100% withoutARM, thenorbitcloseupshowsoriginalnativebrownupperwingairbrakesfullyraised. Mainruns60fpsatthissingleview (notbenchmark). Retractioncheckinprogress. AS21HUDstillreportsRPM47 andcontrollerEnginesRUN despiteunpoweredtype; queuecapability-correctHUD/audio diagnostics inDG80/engineintegration, no physicalgliderengineclaim.

- Glider realmainV/nativecheckPASS qualitatively: AS21 realV→100%noARM, actualbrownboardsraised incloseorbit; VDOWN+simulationadvance→flushretracted. Exact95numericmapping remainsunit/studioevidence, notmainDOMreading. Restored737pausedthrust0/PARKON/controlleropen,no gamepads,nocalibration.
- Propsinitialhandoff16tests+tscPASS butindependentAstrareviewFAILspec/quality with10concretefindings (sidewaysrudders,oppositeflaps/spoilers,missingwells/carriages/brackets,incorrectskinpartition/contours,etc). Originalimplementerfrozen. Freshprop_surface_geometry_repair(gpt6astra) soleproductionimplementer dispatchedfullreport+brief. Finalreviewpackageagainstoriginal /tmp/openhorizon-prop-surfaces-baseline stillrequired; donotacceptold16tests.

- Root loading browser follow-up PASS: B738 1250 kg / 10000 kg each tank persisted across FLY172/FLY737, while C172 retained its own 250 kg / ~72.1 kg tanks. Restored B738 250 kg / 10440.2 kg each. Airborne at 146 KIAS / 1490 ft AGL, attempted 800 kg payload correctly rejected; reopening showed actual payload still 250 kg. Returned main KHAF30 ground, PAUSED, thrust0/PARKON/controller panel open. No controllers exposed and no calibration saved. Details loading-report.md. Props repair remains active; six new independent geometry regressions initially failed and repair validation is ongoing.

- Root original FMOD memory capture also PASS for ASK21 clean/airbrakes and C172 cruise: each120×512 stereo48k frames, finite/nonzero; no speakers or WAV output. Cache `*-capture-result.json`; xplane-audio-audit.md records metrics. Prepared authored-audio-transport-plan.md for bounded helper/service/AudioWorklet diagnostic slice. Live-flight wiring remains separate: actual turbofan state has N1 only, matched engines; B738 event needs N2, so no fabricated mapping. Read-only mapping audit active while props repair retains sole production ownership.

- Audio mapping audit now complete: authored-audio-mapping-audit.md recommends ASK21 first live airflow slice, then C172; B738 original trigger also requires absentN2. Exact state/units, fixed closed canopy/door restrictions, original snapshot/listener alignment and unresolved metadata are listed. No production integration yet.
- Root adds native A333 regression fixture/test for the11 previously audited slat-track patches:215 vertex-pose clearances+12 registered bases acrossfivepositions, preservingauthoredseams. Actual single-rail geometry detachment fails while sibling under same draw remains attached. Focused2/2PASS3.37s; independentreview dispatched native_slat_test_review. Productionrender/originalassets untouched; this is bounded attachmentregressioncoverage, notallnativejointacceptance.
- Native A333 slat patch independentreview PASSspec/PASScode; no findings. Reviewer verified exact fixture equality/positiveclearances/drawntriangle identities and that same-draw sibling sees mutatedbuffer but remainsunchanged. Bounded regressiontask accepted; physicalbearing/continuousmotion/wingflex limits preserved in report.

- Sept21 continuation: previous turn PROGRESS (newreviewedA333tests, loadingbrowseracceptance, originalaudio memorycapture). Authoritative liveagentinventory onlyroot; formerrepairagentgone beforefinalreport. Current edits retained. Root reran focused7files32testsPASS35.13s andtsc0. Oldserver/tabsabsent; loopbackVite restarted withHMRoff,session71601; freshstudiotab2.
- Current11filediff procedural-prop-surfaces-repaired-review.diff independentlyreviewed: original10findings substantially repaired, oneP2remaining DG80/LS8 stowedupperairbraketier extends24.58/26.25mm belowwing. Soleproduction glider_tier_stow_fix implements boundedcorrection+actualtriangle-envelope/mutationregression. Fullstage8b1notaccepted yet.
- Root refreshed browser Cub+/−tail, C182flapsneutral/full, MU2twoelementflaps/rightrollspoiler, BE35Vtail, P180foreplane/Ttail, AN2bothwingflaps, Discusairbrakeopening. Errorlogs[]. Detailsprocedural-prop-surfaces-browser-qa.md. Glidertierfixreload/undersideQA pending. Harnessdisabledsliders now displayeffectivezero; verificationpendingreload. AN2automaticAoAslats remain explicit futureintegration, notcompleted byabsenceoffalseflapcoupling.

- Glider tier fix complete: finitecurvedboard10%parentthickness/stowoffset12%, originalwingunchanged. RED24.58mmescape→23focusedtestsPASS+tsc; independentre-reviewPASSspec/PASScode, zeroescapesall4DG80/LS8sides, 12.29/13.13mmlowerminimumclearance. RootfreshDG80deployed2tiers/supportsandneutralwingheight screenshotslookcorrect; disabledflapsdisplayzeroverified. Added harnessSurfaceundersidebutton (hidesinspectionflooronly), tsc0; reloadtimedout thenbrowserinventory[] so thisbutton/LS8undersidevisualremainOPEN. No retryserverrestart basedonbrowserdisconnect.
- DG80 signed simulation nowdispatched soleproduction dg800_signed_simulation; successfullycaptured /tmp/openhorizon-dg800-sim-baseline-sept21. Rootowns main-harnessintegrationtests after agentAPIready. Browserdisconnection doesnotblock independentsoftwareprogress; fullgoalremainsactive.
- Root resolves originalaudio missingmetadata: ASK21exterior3parameters(includingautomaticDistance4), ASK21cockpitsnapshot2volumeparameters, C172cockpitsnapshotinside_ratio[0]; originalbanksmetadatareadonly/noaudio, cacheJSONs retained. OfficialSNDspecverifieddefaultCG/referencepoint semantics; omittedBLEND_DEPTHdefaultstillunstated. Auditappend hasexactnamesandlimits.

- Sept21 root main integration RED exposed7 failures (reset neutral, steady-vs-deliberate flap selection, snapshot identity/physical-angle migration, signed diagnostics); signed simulation author fixed them. Expanded12 main testsPASS plus3 legacy harnessfiles updated for new Aircraft API:21tests4filesPASS7.09s. Ground/final spawn and invalid-flight snapshot regressions additionally running. DG80 source frozen; report/independent review pending. HUD unpowered RPM remains separately open.
- Browser recovered via documented browser.tabs/get/playwright after CUA focus-emulation timeout. Aircraft studio tab2 working, Surface underside button verified. Actual DG80/LS8 underside exposes remaining airbrake rod/horn protrusion; reviewer measured up to42mm below real skin, tier-support up to6.7mm. Plate-only PASS does NOT accept complete stow. Fresh glider_linkage_stow sole production writer repairs geometry against new bounded brief; snapshot /tmp/openhorizon-prop-before-linkage-stow-sept21.ts. LS8 deployed2tiers visually connected; no browser errors. Black strip is dark lower wing material, correction scoped to exterior finish.
- Main tab3 restored127.0.0.1:5173, KHAF30 B738 PAUSED/controller panel open. No controller exposed; asked user press/release each TCA device button and leave MAXREVERSE. No capture active/no calibration saved. Earlier terrain-tab closure fulfilled; no repeat closure request.
- DG80 independentreview REQUEST CHANGES: transient brake floor outruns flap slew (at1s floor+5 butactual-1), and same-detent release/repress treated steady. Also complete separate neutral/default metadata per design. Existing24focusedtests miss these transitions. Fresh dg800_review_fixes sole production writer dispatched after glider linkage sourcefreeze; originalreport/review and newfixbrief binding. No acceptance from initial455passing checks.
- Glider linkage repair now includes all4proceduralgliders (DG80/LS8/AS21/DISC), actual rod/horn surface containment, continuous endpoints, externalwhite/internaldark material separation. RootbrowserLS8+Discusunderside clean, DG80 airbrakehardwareclean with distinct aftflaperonrodstillvisible. LS8full2tiers supportsattached. Focused23assertions initiallypass but VitestRPCtimeout givesexit1; tsc0 and unchangedserialrerunpending. Do not claim that initialrun as suitePASS.
