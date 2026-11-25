# Documentation index

## Maintained session documentation

| Read | Purpose |
|---|---|
| [START-HERE](START-HERE.md) | Reading order, evidence precedence and handoff checklist |
| [CURRENT-STATE](CURRENT-STATE.md) | Dated checkout, fresh verification, blockers and next actions |
| [ARCHITECTURE](ARCHITECTURE.md) | Runtime/data flow, ownership, subsystem paths and integration contracts |
| [DEVELOPMENT](DEVELOPMENT.md) | Setup, test/build commands, browser tools, APIs/cache, persistence and troubleshooting |
| [Voice ATC](voice-atc.md) | Microphone/recognition/reply behavior and optional local setup |
| [Master contract](FLIGHT-SIM-MASTER-PROMPT.md) | Original requirements and engineering/acceptance discipline |
| [PROGRESS](../PROGRESS.md) | Milestone history, verification evidence and recorded deviations |
| [CONTRIBUTING](../CONTRIBUTING.md) | Contribution workflow and quality gates |

## Topic evidence and historical plans

These are topic entry points, not an assertion that every plan is complete. Read
later review/QA documents within each group, and compare them to current code.

| Topic | Useful entry points |
|---|---|
| Original phases 0–17 | `docs/plans/phase-N.md` (there is no separate Phase 15 plan; see the phase index in PROGRESS) |
| Original cockpit/systems | [Phase 3 acceptance](plans/phase-3-acceptance-report.md) and task reports in `docs/plans/` |
| Navigation/coupled ILS history | [Initial blocked acceptance](plans/phase-4-acceptance-report.md), [later four-round fix](plans/phase-4-autopilot-oscillation-fix-report.md), PROGRESS Phase 4/13/Autoland entries |
| Graphics and aircraft fleet | [Graphics overhaul](plans/graphics-overhaul.md), [aircraft surfaces](plans/aircraft-surfaces.md), [fleet models](plans/fleet-models.md) |
| Current local assets and visuals | [X-Plane integration](xplane-integration.md), [November visual work queue](plans/2026-11-10-aircraft-visual-fidelity.md), [material packs](plans/2026-11-10-material-packs.md) |
| Later integrated fidelity work | [September implementation tracker](plans/sept13/implementation.md), [verification brief](plans/sept13/verification-brief.md) |
| Terrain continuity/contact | [Terrain contact design](plans/sept13/terrain-contact-design.md), [terrain report](plans/sept13/terrain-report.md), [review](plans/sept13/terrain-review.md), [GPU QA](plans/sept13/terrain-gpu-qa.md) |
| Native/local aircraft surfaces | [Native surface report](plans/sept13/native-surfaces-report.md), [review](plans/sept13/native-surfaces-review.md), [browser QA](plans/sept13/native-surfaces-browser-qa.md), [remaining A333 interfaces](plans/sept13/native-remaining-a333-interfaces.md) |
| Procedural control surfaces | [Procedural surface audit](plans/sept13/procedural-surface-audit.md), [repair report](plans/sept13/procedural-prop-surfaces-report.md), [repaired review](plans/sept13/procedural-prop-surfaces-repaired-review.md) |
| DG800 signed flaps/linkage | [Simulation design](plans/sept13/dg800-flaperon-design.md), [implementation report](plans/sept13/dg800-simulation-report.md), [request-changes review](plans/sept13/dg800-simulation-review.md), [fix brief](plans/sept13/dg800-simulation-fix-brief.md) |
| Safety speech/playback | [Safety report](plans/sept13/safety-report.md), [review](plans/sept13/safety-review.md), [playback report](plans/sept13/safety-playback-report.md), [playback review](plans/sept13/safety-playback-review.md) |
| Voice and controllers | [Voice report](plans/sept13/voice-report.md), [voice review](plans/sept13/voice-review.md), [CPU review](plans/sept13/voice-cpu-review.md), [TCA report](plans/sept13/tca-report.md), [TCA review](plans/sept13/tca-review.md) |
| Loading and airport scenery | [Loading report](plans/sept13/loading-report.md), [loading review](plans/sept13/loading-review.md), [airport report](plans/sept13/airports-report.md), [airport review](plans/sept13/airports-review.md) |
| Authored engine audio investigation | [X-Plane audio audit](plans/sept13/xplane-audio-audit.md), [mapping audit](plans/sept13/authored-audio-mapping-audit.md), [runtime design](plans/sept13/authored-audio-runtime-design.md), [transport plan](plans/sept13/authored-audio-transport-plan.md); proposals/proofs, not an integrated production runtime |

Older `docs/superpowers/plans/*handoff.md` files describe the point in time named
in each report. Their next-phase directions are superseded by later work; start
with CURRENT-STATE for today's baseline. Keep historical reports rather than
erasing failed attempts or replacing old counts with current ones.

For new work, keep this index and the session entry point short. Add detail to the
owning reference/report, and link it from CURRENT-STATE and PROGRESS when relevant.
