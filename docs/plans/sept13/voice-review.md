# Stage 4 review

## Spec compliance

- ✅ Code-level spec compliance approved after the v2 fix: hardware polling now requires a physical release after reset/reconnect, independently of synthetic input clears (`src/voice/ptt.ts:45`, `src/voice/ptt.ts:102`, `src/main.ts:1820`). Foreground eligibility prevents background microphone capture (`src/main.ts:1843`).
- ⚠️ Actual transcription HTTP success and live microphone release-to-send remain unverified acceptance gates. Root reports status and synthesis HTTP success; subsequent transcription reached bounded `REQUEST_CANCELLED` at `transcription-process`, and later direct CLI/execFile checks also stalled under resource pressure. The injected process tests (`tests/voice-service.test.ts:16`) cannot establish actual inference. No particular code cause is established by those observations.
- ✅ Root separately verified substantive setup/privacy/platform documentation in `docs/voice-atc.md`, referenced by the UI (`src/main.ts:1848`). The local-only adapter is consistent with the amended fallback brief; the abandoned browser language-pack path need not become a second recorder.

## Strengths

- Voice uses the existing `sendFreeTextAtc` path and records flight/frequency context (`src/main.ts:1843`); token checks protect late capture and transcript callbacks, including replacement microphone ownership (`src/voice/ptt.ts:62`, `src/voice/ptt.ts:78`, `tests/voice-ptt.test.ts:20`).
- Endpoint defenses include loopback peer, local Host and Origin checks, incremental upload bounds, argument-array subprocesses, abort signals and ephemeral cleanup (`server/voice.mjs:25`, `server/voice.mjs:37`, `server/voice.mjs:67`, `server/voice.mjs:95`, `server/voice.mjs:107`).
- Dynamic audio retains the existing speech owner, releases object URLs and aborts stale synthesis (`src/audio/browser-speech.ts:111`, `src/audio/browser-speech.ts:149`). PTT suppresses copilot/radio while preserving safety audio (`src/audio/safety-speech.ts:22`, `src/main.ts:1591`).

## Issues

- No remaining actionable code findings in this task-scoped review.
- Previous Important hardware-rearm finding resolved: polled sources begin disarmed; unknown/disconnected or ineligible samples disarm them; resets preserve release requirements; main polls raw physical state (`src/voice/ptt.ts:45`, `src/voice/ptt.ts:102`, `src/main.ts:2360`). Tests exercise held-reset-repoll, eligibility loss, reconnect and genuine release/repress (`tests/voice-ptt.test.ts:30`).
- Previous Minor coverage finding resolved: actual editable `focusin` and hidden-document `visibilitychange` events now assert cancellation (`tests/voice-bindings.test.ts:16`).

## Assessment

**Task quality: Approved at the code-review gate.** Async ownership, hardware release-to-rearm, local service bounds and shared safety-audio ownership satisfy the reviewed implementation requirements. This approval does not mark live voice acceptance or Stage 4 complete.

**Checks:** Reviewed the supplied 1,081-line diff and task brief/report. No suite reruns or browser actions. One focused outside-diff check evaluated the named hardware-rearm/pause risk: `src/main.ts:1094` (input polling gate), `src/main.ts:1223` (held alias mirroring), `src/main.ts:2871` and `src/main.ts:2887` (foreground/background stepping), and `src/input/input.ts:32` (blur clears holds but leaves input enabled). Frame stepping continues while paused, so per-frame pause cancellation itself is present. Only this review report was written.

**V2 checks:** Reviewed the v2 review package and compared package deltas for the rearm/focus fix; read the updated implementer report. Reported validation is 110 tests across 13 files plus TypeScript exit 0. No tests rerun, no new outside-code inspection, and no browser actions. Initial focused-check line references above describe the v1 inspection.
