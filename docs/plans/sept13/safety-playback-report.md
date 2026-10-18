# Stage 3 safety playback repair

Implemented a production browser speech driver for the existing
`SafetySpeechController`. The controller remains the sole arbiter of active
hazards, interruption, radio suspension, mute/reset, cadence and backlog.

## Playback behavior

- Every TCAS/TAWS phrase currently emitted by the simulators is in an explicit
  20-phrase allowlist. The matching original PCM WAVs are loaded from
  `/audio/safety/manifest.json`, preloaded once and reused per phrase.
- Static warnings complete only on the media `ended` event. Media error, play
  rejection, synchronous media exceptions and a 15-second completion timeout
  stop the media and release controller ownership through the same callback.
- Manifest fetch/load is bounded to three seconds and its rejection is handled
  even when no speech request is active. Cancellation generation checks prevent
  a late manifest, play rejection, `playing`, `ended` or synthesis callback from
  affecting replacement speech.
- Cancellation pauses and rewinds the current clip, clears handlers and timers,
  and cancels native synthesis. Repeated warnings reuse one audio element per
  phrase, so their resource count stays bounded.
- Arbitrary ATC/copilot text temporarily retains native English browser speech.
  A two-second start watchdog and 15-second completion watchdog cancel a stalled
  utterance and release ownership. Stage 4 still owns reliable dynamic local TTS.

## Integration

`main.ts` constructs one `BrowserSpeechDriver`. Radio squelch now fires from the
driver's actual start event, rather than when text is merely submitted. Driver
failures appear for five seconds in the existing safety status and also produce
a concise console diagnostic; they are not reported as successful playback.

The safety studio uses the same production driver when its audio checkbox is
enabled. Its unchecked path remains a deterministic silent stub, and the
existing direct PCM fixture button remains available for browser diagnosis.

## Verification

Test-first regressions cover all allowlisted routes and preload bounds, normal
completion, cancellation, media error, media stall, a manifest that never
settles, synchronous play failure, native start/completion stalls, and stale
callbacks across asynchronous load and reusable-audio restart.

Commands run after the final implementation:

```text
npx vitest run tests/browser-speech.test.ts tests/safety-regressions.test.ts tests/safety-speech.test.ts tests/safety-approach.test.ts tests/tcas.test.ts tests/tcas-multitrack.test.ts tests/taws.test.ts tests/safety-snapshot.test.ts --maxWorkers=1 --fileParallelism=false
npx tsc --noEmit
```

The focused command passed 54 tests in 8 files. TypeScript passed with no
diagnostics. Actual browser playback acceptance remains owned by root; this
report does not infer audible output from deterministic unit tests.

## Limits

The clips are simulator approximations and are not certified avionics audio.
Static phrase coverage is intentionally allowlisted: a newly introduced safety
phrase must add a manifest entry and a matching regression. Arbitrary native
speech remains dependent on the browser/OS engine until Stage 4 replaces that
dynamic path.
