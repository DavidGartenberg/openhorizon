# Stage 4 — voice ATC implementation report

Implemented the local voice path in the existing simulator. Main and UI are frozen for root's actual browser QA. This report does not mark the overall goal or Stage 4 live acceptance complete.

## Behavior and integration

- Permanent Hold to talk button and held T keyboard binding. ATC menu moves to backquote with an obvious visible button. Typed transmissions and transcript remain available; their positions avoid the voice panel.
- Sidestick KeyT alias is now a held alias. Main reads virtual held state after gamepad polling; disconnect and pad-layout resync clear PTT. Stage 6 still owns the broader controller reconnect/multi-device mapping work.
- The controller distinguishes idle, requesting microphone, listening, processing, transcript and error. Recording starts only from a hold and stops on release; releasing during permission acquisition cancels instead of starting later. The current local recorder has no interim recognizer callbacks or endpoint restarts: one bounded continuous PCM recording produces exactly one final transcript.
- Pointer release outside, pointer cancel, blur, text input focus, page hiding, page teardown, disconnect, cancel, pause, frequency/facility change and new flight invalidate pending sessions. Late capture permission, release flushing and transcription results cannot transmit or detach a newer capture.
- Voice calls `sendFreeTextAtc` exactly once. Existing classifier and ground/tower/approach strip authorities and their auto-tuning semantics remain the only ATC path. No duplicate or parallel clearance system was introduced.
- Spoken runway digits and valid numeric runway sides, explicit thousands of feet, and unambiguous November/NATO registration sequences are normalized narrowly. Unfamiliar words and aircraft-name misspellings are preserved; unknown intents use the existing say-again behavior.
- PTT suspends radio and copilot speech through SafetySpeechController. Existing safety callouts remain audible; already playing safety audio blocks capture, and newly starting safety audio cancels an active capture to prevent echo commands.

## Local service and playback

`server/voice.mjs` is shared by Vite and standalone Express via the existing route dispatcher, extended only with an optional IncomingMessage argument. Existing GET data handlers retain their behavior.

- `GET /api/voice/status`: local executable/model presence and maximum capture duration. Presence is not a claim of successful inference.
- `POST /api/voice/transcribe`: audio/wav, mono 16 kHz PCM16, 0.1–20 seconds. Upload byte limits are enforced incrementally before aggregate buffering. Client capture adds a minimum-duration/RMS silence gate.
- `POST /api/voice/speak`: JSON text, 1–600 printable characters. macOS `/usr/bin/say`, Samantha, outputs validated nonempty PCM WAV, capped at 60 seconds.
- Both require a loopback remoteAddress and local Host; foreign Origin and cross-site browser requests are rejected. Standalone wildcard data-route CORS is removed on speech responses. No external speech service, user API key, or permanent recording.
- One bounded speech job at a time; 30-second subprocess timeout and 35-second total request timeout. Argument arrays, no shell. Client cancellation aborts child execution. Private ephemeral directories are deleted in finally; busy state releases even if cleanup throws. Safe error stage/code diagnostics distinguish process timeout, permission, missing file, cancellation and validation without exposing command text or recordings.
- BrowserSpeechDriver retains all 20 static safety clips. Arbitrary replies use the local WAV resolver when status reports synthesis ready. Cancellation aborts outstanding synthesis and revokes late/current object URLs; completion releases URLs. Native synthesis remains a bounded fallback on other OSes and exposes failures, including synchronous voice enumeration/utterance creation exceptions.
- Setup/recovery and privacy documentation: `docs/voice-atc.md`. Browser recognition language-pack install had failed during root preparation; no second uncontrolled recording pipeline or silent network fallback was added.

## Verification

Fresh command:

```
npx vitest run tests/voice-ptt.test.ts tests/voice-service.test.ts tests/voice-bindings.test.ts tests/voice-client.test.ts tests/browser-speech.test.ts tests/safety-speech.test.ts tests/gamepad-map.test.ts tests/atc tests/atc-ground.test.ts
```

Result after independent-review fixes: **110 tests passed, 13 files**. `npx tsc --noEmit`: **PASS**.

New regression cases include held/released single transmission, combined keyboard/hardware holds, cancelled/stale frequency results, release during permission, permission denied/no speech, maximum hold limit/rearm, paused/unavailable capture, late release flushing across replacement sessions, PCM headers/resampling/clipping, narrow aviation normalization, outside pointer release/key repeat/blur/disconnect/teardown, aborted audio-context resume, late microphone stream cleanup, local request paths/error propagation/object URL lifetime, service validation/origin/LAN restrictions/ephemeral cleanup/concurrency/cancel/process diagnostics, copilot suspension and active-safety capture blocking. Existing ATC classifier/strip acceptance tests remain green.

Most controller, encoder, service, driver and newly found lifecycle regressions were developed with failing tests before implementation. Client/DOM binding tests were added after their initial integration; they should not be represented as strict test-first evidence. Server subprocess tests inject filesystem-writing adapters; they do not alone establish real inference or audio playback.

## Actual evidence and remaining acceptance

Root supplied the original generated fixture `tests/browser/fixtures/atc-phrase.wav`: 6.5015 seconds mono PCM16/16 kHz. Root's exact server-flag CLI invocation succeeded with correct runway/departure intent in approximately 2.25 seconds. Root's actual status endpoint returned HTTP 200 with transcription/synthesis available. Actual synthesis POST returned HTTP 200 and 155820 bytes of valid mono16 kHz PCM, 4.741375 seconds. These were reported by root; this subagent did not run browser tools or copy assets.

The first actual transcription HTTP request returned 502 after approximately 35 seconds despite successful direct CLI. Safe diagnostic code/stage fields were added and tested; root is retrying and may need to restart Vite to invalidate native server-module import caching. Do not claim the actual transcription route works until that retry passes. Browser microphone permission, real PTT release-to-send, and spoken reply playback remain root-owned live QA at this handoff.

Remaining limits: no universal speech accuracy, no cloud recognition fallback, native synthesis can still be unavailable on non-macOS browsers, one speech-service job at a time can reject overlapping synthesis/inference with a visible busy error, and practical recognition latency depends on CPU load. ScriptProcessorNode is deprecated but currently supported in the target browser; the bounded recorder avoids an additional recording implementation. Broader controller ownership/reconnection remains Stage 6.

## Root live QA update

Actual second transcription POST failed with REQUEST_CANCELLED at
transcription-process afterboundedrequesttimeout. Samefixture+exactflags direct
CLI exited0 in2.25s earlier. Subsequent implementerexecFile and directCLI also
stalled whilemainGPUpreviewwasloading, so execFile-only/EOF hypothesis rejected.
Root mainbrowserinspection timedout repeatedly; vm_stat shows~119MBfree,
~3.37GBwired+~1.96GBcompressed on8GBhost. RequestedusertemporarilycloseXPlane;
continuepurecode/review whilewaiting. This is not evidenceofsuccessfulSTT.

Independentreviewfoundhardwareheldpoll couldreopenPTT afterblur/reset/newflight.
Implementeraddressing release-before-rearm withrawhardwarestate plusforeground
eligibility; finaltests/re-reviewrequired. Actualsynthesisendpointalready200,
mono16kPCM4.741375s, 155820bytes; /tmp/openhorizon-atc-response.wav.


## Independent review follow-up

The review found that clearing controller holds on reset allowed the next continuously held hardware poll to reopen recording. Fixed with a dedicated polled-source release latch: first-connected state and every reset are disarmed; only a physically released, eligible sample rearms. Disconnected samples are unknown rather than releases. Main now reads actual mapped trigger buttons, independent of Input's synthetic clears, and capture eligibility requires a focused, visible document. Regression coverage exercises continuous polls across reset, ineligibility/blur, reconnect, release and repress, plus initial connection with the trigger held. The binding test now actually dispatches editable focus and hidden-document visibility changes.

The second actual transcription HTTP failure reported `REQUEST_CANCELLED` at `transcription-process`. Root requested investigation of open stdin. Real execFile tests with stdin open and explicitly ended both stalled and were killed at six seconds. A direct CLI run in the same diagnostic period also stalled at `read_audio_data: trying to decode with miniaudio`; it was stopped with Ctrl-C (exit 130). Therefore no unproven stdin fix was applied. Root's earlier exact direct command succeeded in the default sandbox, ruling out a simple sandbox-mode explanation. System/tool scheduling became unusually slow during these experiments; resource pressure is being isolated by root. All diagnostic children were stopped. Actual HTTP success remains pending.

Fresh post-review verification: all 110 focused tests passed and `npx tsc --noEmit` exited 0.

## Sept18 CPU backend fix and live acceptance evidence
The installed ggml backend initializes Metal even with Whisper `-ng`. Direct
unrestricted execution stalled after embedded Metal library initialization.
With `GGML_METAL_DEVICES=0`, the same original fixture transcribed successfully
both inside and outside the sandbox. The server now passes that setting only to
its transcription child, retaining its inherited environment and existing
CPU inference option. The actual POST `/api/voice/transcribe` returned200 with:
“Tower, Sessna November1-2-3 Alpha Bravo, holding short runway27, ready for departure.”
Two new regressions failed before the fix, then passed: service subprocess
configuration and real child-process environment propagation. Focused service,
client and browser-driver run:24/24passed,3files.
Primary implementation reference:
https://github.com/ggml-org/ggml/blob/master/src/ggml-metal/ggml-metal.cpp
(`GGML_METAL_DEVICES` controls device creation during backend registration).

Browser root verified arbitrary ATC text plays and ends through production
LocalVoiceClient/BrowserSpeechDriver in safety-studio. Sept18 full main browser
also shows “Local Whisper ready — hold T to talk”. Actual user microphone capture
and resulting ATC conversation remain open acceptance; no live recording started.
