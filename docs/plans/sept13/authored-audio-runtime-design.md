# Local authored aircraft audio runtime

Design and bounded feasibility evidence, 2026-09-18. This is not an implemented flight-audio service or subjective listening acceptance. The Sept18 user update in sound-brief.md authorizes local original assets and supersedes the earlier no-copy restriction. Original installation files remain untouched; no publishing, dependency installation, browser playback or speaker output occurred in this investigation.

## Decision

Use one persistent local FMOD Studio helper for the active browser audio session, returning short PCM blocks on demand. Keep the original event instances alive and feed their parameters from actual simulation state. This retains the bank's layered samples, modulation, envelopes and transition history. Start with B738, C172 and ASK21, whose original events already render successfully. Loading metadata for all 20 banks does not establish complete event support.

| Approach | Benefit | Limitation | Decision |
| --- | --- | --- | --- |
| Offline event state grids | Easy WebAudio delivery; no live helper after preparation | Dimensions multiply across N1/N2/load/view/altitude/doors; crossfading snapshots loses transition history, randomization, cues and authored envelopes | Diagnostic references or clearly labeled fallback only |
| Persistent native event mixer, local PCM blocks | Executes original event behavior continuously; no editor projects or browser FMOD runtime needed | Local helper, parameter adapters, transport and timing acceptance required | Recommended |
| Custom native output plugin | Direct control over mixer reads | Larger version-sensitive ABI and lifecycle surface than needed | Reserve if DSP capture fails sustained tests |

A grid with even 8 N1 × 5 N2 × 3 loads × 2 views has 240 states before spatial direction, doors, altitude and transients. Two-second stereo float32 states already occupy about 184 MB at 48 kHz; blending them is a new sound engine rather than execution of the original event transitions. This calculation is illustrative, not a proposed asset export.

## New bounded capture proof

A derivative of fmod-event-render-probe.py is preserved at `docs/plans/sept13/fmod-capture-proof.py`, with result `server/cache/speech/xplane-probe/fmod-capture-result.json` (original temporary proof paths `/tmp/openhorizon-fmod-capture-proof.py` and `/tmp/openhorizon-fmod-capture-result.json`). It loads the installed 2.02.29 dylibs and original B738 bank, resolves the known engine GUID, and uses NOSOUND_NRT instead of WAVWRITER_NRT. It attaches a pass-through capture DSP to the Core master channel group. After clearing startup capture, 120 updates generated exactly 120 × 512 = 61,440 frames, stereo 48 kHz (1.28 seconds), peak 0.6087908, RMS 0.1106108, all finite. PCM remained in memory. The process exited successfully in about 0.26 seconds including loading and Python metrics; this is not a sustained latency benchmark.

An initial attempt silently ignored non-stereo callbacks. Inspection showed the DSP negotiated other channel counts. Explicit `FMOD_DSP_SetChannelFormat(dsp, 3, 2, 3)` (stereo mask, two channels, stereo speaker mode) fixed that. Production must reject unexpected formats rather than reinterpret memory. Sample loading/initialization can advance capture: reset counters and discard startup blocks before the session becomes ready. Count captured frames, never assume initialization emits none.

The proof uses a bounded Python list; production must use a fixed-capacity buffer. It proves native PCM access for this event, not mapping coverage, sample-exact equivalence to X-Plane, uninterrupted browser playback, or all-bank DSP compatibility.

## Native API boundary

Pin the helper to the installed runtime version and architecture, check `FMOD_System_GetVersion`, and fail explicitly on an unsupported ABI. The current 2.02 documentation is for a later patch (2.02.35), while the observed runtime is 2.02.29. Selected 2.03 pages below establish API concepts only; never copy a 2.03 structure layout into the installed 2.02 process.

The verified setup is: Studio Create with version argument `0x20200`; obtain Core; set output `NOSOUND_NRT` (4), software format 48000/stereo, DSP buffer 512; Studio Initialize with `SYNCHRONOUS_UPDATE` (4), Core `STREAM_FROM_UPDATE | MIX_FROM_UPDATE` (1 | 2). Keep all FMOD calls on the helper's single owning thread. Use symbolic constants in maintained code.

The capture callback is:

```c
FMOD_RESULT F_CALLBACK capture(FMOD_DSP_STATE *state,
    float *input, float *output, unsigned int frames,
    int inputChannels, int *outputChannels);
```

Create it with `FMOD_System_CreateDSP(core, &description, &dsp)`, get the master group, and insert via `FMOD_ChannelGroup_AddDSP(master, 0, dsp)`. Set stereo format explicitly and activate it. The description uses plugin SDK version 110, one input/output buffer, and a read callback; other unused fields are zero. Copy interleaved float PCM to a bounded capture buffer and pass it through to output. Do not perform I/O or call Studio from that callback; keep the callback object alive through teardown. These signatures and fields are documented by the [FMOD 2.02 DSP API](https://www.fmod.com/docs/2.02/api/plugin-api-dsp.html).

A custom output alternative calls `FMOD_OUTPUT_READFROMMIXER_FUNC(FMOD_OUTPUT_STATE *state, void *buffer, unsigned int length)` through the output state's function pointer from its update callback for non-realtime operation. It requires a registered output description and callbacks, not a standalone exported mixer-read function. The [FMOD output documentation](https://www.fmod.com/docs/2.03/api/plugin-api-output.html) describes this path, but its 2.03 output layout was not validated against 2.02.29; do not choose it for the first implementation.

Before each block, apply validated parameter changes, attachment triggers and listener/event transforms, then call Studio Update. Relevant maintained entry points are `FMOD_Studio_EventInstance_SetParameterByID(instance, id, value, ignoreSeekSpeed)`, `Set3DAttributes(instance, &attributes)`, `Start(instance)`, `Stop(instance, mode)`, `KeyOff(instance)`, `SetPaused(instance, paused)` and `Release(instance)`. Use ignoreSeekSpeed=false for continuous live updates so authored seek behavior remains active; initialize fresh instances deliberately. Automatic/read-only parameters are never assigned. Global parameters require System setters. [FMOD event instance reference](https://www.fmod.com/docs/2.03/api/studio-api-eventinstance.html).

## Minimal server and browser contract

Add an independent authored-audio service beside `server/voice.mjs`, mounted through the shared `server/handlers.mjs` route so Vite and production behave alike. The existing voice service already checks loopback address, Host and same Origin, removes permissive CORS, bounds request bodies, cancels child work on disconnect and cleans temporary resources. Reuse those policies, not its single speech busy lock. No persistent session route currently exists, and package.json has no direct WebSocket dependency.

Use bounded fetch POST responses first; no new WebSocket package is necessary:

- `GET /api/aircraft-audio/status`: availability, runtime version, supported aircraft, occupied lease and concrete unsupported reason; no absolute installation paths to the client.
- `POST /api/aircraft-audio/session`: allowlisted aircraft ID and sample rate. Returns random session token, epoch, format, provenance IDs and supported mapping coverage after bank/sample load. Exactly one audible lease per server; a second tab receives 409, without stealing the first session.
- `POST /api/aircraft-audio/block`: token in header; epoch, strictly increasing request sequence, latest typed state, ordered command edges and requested block count. Return binary float32 LE stereo with fixed versioned header containing epoch, sequence, first frame index and frame count. Normally 3 DSP blocks = 1536 frames = 32 ms at 48 kHz. At most one request in flight, at most 6 blocks per response, 16 KiB JSON body, bounded edge count, and explicit rejection of malformed/nonfinite state.
- `POST /api/aircraft-audio/control`: pause, resume, reset or dispose. Commands carry a generation number; serialize helper access, invalidate old queued render requests, and acknowledge the applied generation.

Spawn one persistent Python ctypes helper using a fixed executable/script and argument array, no shell or client-selected file paths. Frame stdin/stdout with length limits and a correlation ID; reserve stderr for diagnostics. Keep DSP callbacks in the helper, outside Node. Source paths come only from a canonicalized local aircraft manifest; verify realpath stays under the configured installation. Load one aircraft plus its declared required banks, not all 20. Expose PCM only, never a general bank/file-download endpoint.

Proposed limits: one helper, 128 active event instances, 128 real mixing voices initially, per-attachment polyphony cap 8, helper RSS ceiling 384 MiB, capture capacity 8192 stereo frames, one response outstanding, startup deadline 10 s, render deadline 250 ms, no-request lease expiry 5 s. Enforce process limits in the parent and terminate on overflow/deadlock. These are initial budgets requiring fleet evidence; an aircraft exceeding them becomes unsupported until deliberately accommodated, rather than silently losing required events. Share admission state across Vite/standalone processes through a local lock if both hosts can accept sessions; a module-level variable alone only bounds one process.

After a user gesture, an AudioWorklet consumes a fixed ring buffer. Post transferable PCM chunks; no SharedArrayBuffer requirement and no per-sample messaging. Request more when below 3072 frames (64 ms), with normal steady buffering 32–96 ms and hard ceiling 6144 frames (128 ms). Render only to satisfy consumed-frame credit, plus the initial bounded prefill; server also rate-limits credit against elapsed time. Suspended contexts stop pulling. Resample with phase continuity if the actual AudioContext rate differs; preferably initialize native mixing at the reported supported context rate. Never reinterpret 48 kHz as 44.1 kHz.

Use actual worklet consumption and frame counters, not RAF, as playback clock. Underflow produces a short fade to silence; overflow/epoch mismatch discards obsolete data and re-primes, with diagnostics. Do not accumulate seconds of late sound. Target under 150 ms p95 input-to-output during a loaded flight, measured across control receipt, applied block, worklet presentation and browser output latency; this is an acceptance target, not a result. Persistent fetch latency must be tested. Only if that target fails should transport switch to a deliberately implemented persistent channel.

## Simulator-to-event seam

Keep the pure 120 Hz physics untouched. A typed adapter at the existing main/audio integration boundary exports values, units and validity. A compiled attachment table combines `.snd`, GUIDS.txt, event parameter metadata and aircraft geometry. Store bank/SND/GUID hashes and mapping version. Resolve event and snapshot GUIDs without requiring a strings bank.

Implement an explicit grammar for start/end/auto-end, cue, command edges, always, polyphony, required banks, parameter indices, positions and sound spaces. DELTA/ABS_DELTA use elapsed simulation time and actual actuator position; reset derivative history on spawn/teleport and do not evaluate derivatives with zero dt. Unsupported directives or unresolved datarefs are reported per attachment. Sound spaces and snapshots participate in the authored cockpit mix; an inside flag alone is insufficient. The [X-Plane SND specification](https://developer.x-plane.com/article/sound-snd-file-format-specification/) defines these directives and coordinate conventions. Validate combined-condition semantics against representative attachments before enabling them; never eval source text.

| Initial case | Native identity and inputs | Coverage constraint |
| --- | --- | --- |
| B738 engine | `{0e9a6d1d-5fab-4f71-95c8-cd8abdb8f653}`; indexed N1/N2, burning fuel, jetwash, thrust delta, altitudes, inside state | Read actual available spool state; jetwash/custom thrust delta need a documented adapter or marked unavailable. Do not silently equate N2 with N1. |
| C172 engine | `{a5b8d7bc-8098-4d46-828d-71991b0de687}`; RPM × 2π/60, fuel burning, doors, inside ratio, listener bearing | Separate engine-running boolean from actual rotation/spin-down; closed doors only if modeled state supports that value. |
| ASK21 airflow | `{3b679540-5d21-4d59-9646-45e7cf16e98c}`; KIAS, AoA degrees, actual airbrake ratio, canopy, crash, inside | Distinct interior/exterior attachments as authored; no engine added to a glider. |

Use PARAM_DREF_IDX to resolve `[#]`/`[*]` per attachment and preserve explicit array indices. Normalize dotted FMOD dataref names through an explicit mapping table. Compute X-Plane relative heading/pitch in the event's oriented coordinate system; they are not raw world camera angles. [X-Plane event parameters](https://developer.x-plane.com/article/fmod-event-parameters-for-x-plane/).

Send source/listener positions in a consistent local metric frame with orthonormal forward/up vectors and consistent handedness; shift both together when rebasing. Derive sound attachment positions from actual ACF/geometry, including reference-point offset. Suppress artificial velocity on teleport/view switches; preserve physical relative motion. Let FMOD own distance/cone/Doppler behavior instead of adding a second WebAudio panner/filter. Attach cockpit/cabin snapshots and compute their sound-space penetration ratios. Test cockpit-to-exterior transitions explicitly.

Engine, gear, flap, reverse and wind state may be coalesced; command down/up edges and touchdown events need sequence IDs and exact-once consumption so polling cannot lose them. Derive contacts from physics transitions, not a browser ground boolean sampled every 32 ms. Do not replay start/touchdown impulses after a reset. Unimplemented plugin datarefs, cockpit systems and environment buses must be visible in coverage diagnostics. Authored event execution does not mean the entire X-Plane sound environment has been reproduced.

## Lifecycle, speech and failure

Pause locally fades/mutes and clears queued PCM immediately, then pauses native events and stops rendering; resume requires current state and fresh prefill without evaluating fake derivative edges. Reset/aircraft change increments epoch, aborts the request, stops/releases old instances, unloads old banks, clears browser/capture buffers and initializes trigger history. Preserve the user's Q mute preference. A paused lease may expire and be recreated; report the restart rather than assuming its event timeline survived.

Use a separate browser gain for aircraft PCM. PTT capture mutes that gain immediately and clears already queued audible data before microphone activation; keep or pause native state by explicit policy, then re-prime on release. Existing safety speech arbitration remains authoritative: GPWS/TCAS can interrupt/cancel capture, and their verified clips stay outside the aircraft gain. Apply configurable bounded ducking to aircraft sound during radio/safety playback, with smooth attack/release. Exclude overlapping authored warning attachments when the established safety channel already supplies that exact warning; enumerate these exclusions. Do not run the existing synthetic engine graph concurrently with the original engine event.

Dispose on pagehide/navigation, aircraft replacement, service shutdown, lease expiry or helper failure. Stop requests, detach worklet/messages, clear nodes/buffers, release event/snapshot handles, remove/release DSP, unload banks and release Studio. Server process exit is the final cleanup boundary if graceful teardown misses its deadline. Browser best-effort disposal is backed by the server expiry, not relied on alone.

On bridge failure, fade aircraft PCM out, preserve safety/radio services, and show the specific cause. If a fallback is enabled, label it `Original sample fallback — reconstructed behavior` or `Synthesized fallback`; label the main mode `Original FMOD events — partial/full mapped coverage` according to evidence. Never treat cached state-grid playback as live authored execution. Retry only with a bounded backoff or explicit retry, no repeated spawn loop.

## Acceptance before integration is called complete

1. Native capture: B738/C172/ASK21 finite stereo PCM through sustained ramps, actual stop/cue behavior, interior snapshots and exterior motion; verify callback buffer format and no device output. Compare continuous versus split rendering with controlled initial randomness where possible; do not require unrelated random renders to be bit-identical.
2. Mapping: test RPM units, each engine index, known start/end conjunction behavior, command hold/release, actual moving flaps/gear/airbrakes, reverse, fuel cut/spin-down, snapshot ratios and unsupported values. Fail closed on required unknowns; no fabricated live readouts.
3. Transport/browser: 10-minute representative flight while local speech runs; p50/p95/max latency, underruns, queue occupancy, CPU/RSS and no growing process/node count. Demonstrate actual WebAudio consumption and playback, not only successful HTTP or decoded PCM. User listening still judges timbre, seamlessness, balance and realism.
4. Lifecycle: repeated 20 aircraft switches/reset/pause cycles, mute, PTT, safety interruption, context suspension, tab hiding/closing, duplicate/out-of-order requests, worker crash and second-tab contention. Old epoch PCM never becomes audible; one lease/helper remains the enforced limit.
5. Provenance: unchanged source hashes, only allowlisted local reads, no bank/dylib/media bundled in dist or tracked artifacts; hostile paths/origins/bodies rejected. Run repository checks after actual implementation, alongside focused audio evidence.

Only original banks and runtime already installed on this computer are in scope. This design is not a redistribution license or a determination that standalone use of bundled proprietary libraries is licensed. No libraries, banks, extracted samples or rendered PCM should be committed, uploaded, packaged or published. Verify applicable FMOD and asset terms before any distribution or broader deployment; that review was not performed here. The local technical experiment does not resolve those rights.

Remaining unknowns: sustained helper/transport performance alongside rendering and Whisper; bank-specific DSP dependencies beyond tested events; full parameter availability (especially custom datarefs); combined trigger semantics and pause-time behavior across every aircraft; subjective sound quality; applicable standalone runtime/asset permissions. The next implementation gate is a single B738 continuous live-state session with measured latency and lifecycle cleanup, before increasing coverage.
