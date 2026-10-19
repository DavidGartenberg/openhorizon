# Original aircraft audio transport implementation plan

> **For agentic workers:** Use subagent-driven-development or executing-plans to implement this plan task by task. This is the bounded transport slice of Stage10, not acceptance of all aircraft sound.

**Goal:** Stream the installed original FMOD events continuously to a browser inspection page, with bounded buffering and reliable teardown.

**Architecture:** A single persistent Python ctypes helper owns FMOD. A loopback-only server service leases that helper to one browser, and an AudioWorklet consumes framed stereo PCM. Initial inspection inputs are explicitly scenario controls; actual flight integration follows the separate mapping audit.

**Tech stack:** Existing Node ESM server, Python standard library ctypes, installed FMOD 2.02.29, TypeScript/WebAudio, Vitest. No new package or library installation.

## Global constraints

- Original X-Plane installation files remain untouched. All work and imported assets stay local; no publishing, commits, uploads, or redistribution.
- Do not substitute synthetic sound and call it imported. The enabled mode executes original events, with the mapped coverage identified explicitly.
- Keep pure physics in `src/sim/` free of DOM/Three.js/audio service imports.
- Preserve TCAS/GPWS and ATC/PTT behavior; this transport slice does not replace their buses.
- No client-selected executable, bank path, GUID, dataref, or arbitrary FMOD method. Expose an allowlisted scenario schema.
- One helper and one audible lease across the local dev/standalone services. Bound every request, buffer, queue and subprocess lifetime.
- No speaker output from FMOD. Audio is emitted only through the gesture-unlocked browser graph.
- B738 N2 and separate engine state are not available in the current simulation. Diagnostic N1/N2 scenario values are not live simulation mappings. Consult `authored-audio-mapping-audit.md` before any flight integration.

## Task 1: Persistent native event renderer

**Files:** Create `server/aircraft-audio/fmod_helper.py`, `server/aircraft-audio/protocol.mjs`, focused protocol/helper tests. Use `docs/plans/sept13/fmod-capture-proof.py` as ABI evidence, not as an importable production module.

**Interface:** Fixed length-prefixed stdin commands and stdout replies containing a correlation ID, operation, epoch, sequence and bounded payload. Commands: initialize an allowlisted case, render 1–6 DSP blocks using typed scenario values, pause/resume/reset, dispose. PCM reply: interleaved float32 little endian, two channels, exactly the negotiated sample rate and declared frame count. No logs on stdout.

- [ ] Write failing framing tests for truncated/oversized input, invalid operation, nonfinite values, invalid sequence/epoch, unexpected audio format and overflow. Validate framing without installed banks.
- [ ] Separate maintained ABI declarations from orchestration. Verify runtime version and arm64 compatibility before initialization; use symbolic constants for the proven NOSOUND_NRT/synchronous setup.
- [ ] Implement one owner thread, a fixed capture buffer, explicit stereo channel negotiation and pass-through capture callback. No callback I/O, unbounded allocation, or FMOD reentry. A bad callback format becomes an explicit fatal diagnostic after returning safely to native code.
- [ ] Load only the selected aircraft and required banks. Resolve original event/snapshot IDs from an allowlist. Preserve event instances between blocks; discard startup capture before declaring ready.
- [ ] Implement pause/reset/dispose and single-pass cleanup with callback references retained until Studio release. Do not rely on Python exceptions propagating from ctypes callbacks.
- [ ] Run original B738/C172/ASK21 cases through repeated blocks and parameter ramps. Assert exact frame accounting, finite nonzero PCM where expected and bounded capture occupancy. Report native stop/restart evidence separately from event-specific acoustic expectations.

## Task 2: Local service and cross-process lease

**Files:** Create `server/aircraft-audio.mjs` plus small helper-process/lease modules if needed. Modify `server/handlers.mjs` only for route dispatch. Add `tests/aircraft-audio-service.test.ts` and process-lifecycle tests.

**Interface:** `createAircraftAudioService(options)` returns the existing route-shaped handler plus explicit shutdown support. Routes: GET status, POST session/block/control under `/api/aircraft-audio/`. Parent and helper exchange only the Task1 framed protocol. Request uses a random session token in a header; errors expose safe codes, not local paths or raw command arguments.

- [ ] Add failing tests using an injected fake helper/clock for foreign origins/hosts, nonloopback clients, invalid content type/body/state, token mismatch, duplicate/out-of-order blocks, simultaneous clients, expiry and child failure.
- [ ] Implement exact same-origin loopback policy without inheriting the general handler's permissive CORS. Bound JSON bodies to 16 KiB, one render request in flight and six blocks per response.
- [ ] Enforce a process-shared lease using an OS-backed lock or equivalent owner-verified primitive. A second dev/standalone process must not steal a live lease. Test normal release, dead owner recovery and concurrent acquisition; never kill an unrelated PID obtained from a stale file.
- [ ] Apply startup/render/idle deadlines and fixed executable/argument spawning without a shell. Cancelled HTTP render work must not leave response bytes to be mistaken for the next request. Drain a validated reply or terminate/reset the session explicitly.
- [ ] Serialize lifecycle controls with rendering. Reset invalidates the old epoch immediately at the server boundary; stale queued/replied blocks cannot become current data. A rejected unauthenticated request does not refresh a lease.
- [ ] Run service tests and native-helper smoke tests. Verify expiry/server shutdown actually releases helper and lock, including while a render or bank load is outstanding.

## Task 3: Browser playback and inspection

**Files:** Create `src/audio/authored-audio-client.ts`, a pure framed-PCM/ring module, an AudioWorklet module, focused client/ring tests and `tests/browser/authored-audio.html`. Do not wire `src/main.ts` in this task.

**Interface:** Client explicitly starts after a user gesture, accepts the allowlisted typed diagnostic scenario state, and exposes pause/resume/reset/dispose plus status and queue/latency counters. AudioWorklet consumes fixed stereo frames, reports consumed frame credit and rejects obsolete epochs.

- [ ] Add failing ring/protocol/client tests for split blocks, rollover, underflow, overflow, stale epoch, truncated PCM, NaN samples, context suspension, late replies and disposal during initialization.
- [ ] Implement one request in flight with pull credit from actual worklet consumption. Use bounded transferable blocks, no growing message queue or per-sample messages. Negotiate a supported native rate or use a tested phase-continuous resampler; never relabel sample rates.
- [ ] Keep steady buffering within the design target of 32–96 ms and hard maximum 128 ms. Underflow fades to silence; discontinuity resets and re-primes without playing seconds of stale audio.
- [ ] Build a small page with Start, Stop, Pause, Reset, aircraft event selection and meaningful scenario controls. Show `Original FMOD event — diagnostic scenario`, current parameters, frame/epoch counts, queue occupancy, underruns and service errors. Stop audio on pagehide, and close the context on final disposal.
- [ ] Root verifies real browser Start/consumption/output, parameter changes and lifecycle controls. HTTP success or PCM decode alone is insufficient. Check that the main flight tab is preserved and no second helper is created by a second diagnostic tab.

## Task 4: Bounded acceptance and handoff

- [ ] Run a ten-minute representative playback session while the existing local CPU speech service is exercised sequentially, not with competing Whisper jobs. Measure wall-clock run duration, p50/p95/max transport and output latency, underruns, occupancy, helper CPU/RSS and final cleanup.
- [ ] Perform 20 scenario switches/resets/pauses plus a helper crash, context suspension and second-client contention. Verify no old-epoch PCM is consumed and no helper/node growth remains after disposal.
- [ ] Keep latency target under 150 ms p95 distinct from measured result. If fetch transport misses it, report evidence before redesigning transport.
- [ ] Run focused tests, TypeScript and build; root gathers before/after diff and independent review. Record evidence in `authored-audio-transport-report.md` and `implementation.md`.
- [ ] Proceed to live-flight mapping only after this bounded gate. That next task must implement real listener/source coordinates, original cockpit snapshots, simulation validity/units, warning exclusions, PTT mute/ducking, aircraft-switch lifecycle and documented unsupported mappings. This page alone does not fulfill Stage10.

## Evidence already available

The original in-memory capture proof produced 120 callbacks of 512 stereo frames at 48 kHz (61,440 frames) for B738. Fresh root runs also produced the exact same frame/format counts for ASK21 clean/airbrakes and C172 cruise, with finite nonzero samples. Results are local cache JSON files `*-capture-result.json`; they demonstrate bounded short-case feasibility only, not a maintained ring buffer, persistent service or sustained browser latency.
