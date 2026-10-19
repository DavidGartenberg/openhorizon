# Stage 3 playback repair review

## Spec compliance

- **Compliant within the requested playback-repair scope.** Standard safety phrases route through a bounded PCM clip map, while arbitrary text retains bounded native synthesis and visibly reports failures. No blocking static-review finding.
- **Actual playback evidence remains separate:** root reports production-driver FIFTY through TEN start/completion events verified in the actual browser; closing-RA/clearance acceptance was still running at review dispatch. This reviewer did not operate the browser or infer audible playback from fake media. Reliable arbitrary ATC TTS remains Stage 4 work, as explicitly scoped by the brief.

## Strengths

- The 20-phrase allowlist matches the supplied production manifest; only allowlisted phrases allocate reusable audio elements (`src/audio/browser-speech.ts:3`, `src/audio/browser-speech.ts:96`, `public/audio/safety/manifest.json:2`). Generation occurs locally through argument-based macOS synthesis invocation, with PCM data validation and no proprietary copying (`scripts/generate-safety-audio.mjs:11`, `scripts/generate-safety-audio.mjs:20`).
- The asynchronous manifest wait is bounded, handled even without an active request, and checked against the current generation before playback (`src/audio/browser-speech.ts:82`, `src/audio/browser-speech.ts:124`). Cancellation clears media handlers and timers, pauses/rewinds the clip, and invalidates stale callbacks (`src/audio/browser-speech.ts:106`).
- Media normal completion uses ended; rejection, errors, synchronous play exceptions and stalls have explicit failure paths. Failure cleanup releases arbiter ownership without accumulating repeat resources (`src/audio/browser-speech.ts:135`, `src/audio/browser-speech.ts:165`, `src/audio/browser-speech.ts:173`).
- Native text has separate start and completion limits, and late native callbacks are ignored after completion/failure (`src/audio/browser-speech.ts:147`). The driver interface preserves the existing single arbiter; main squelch moves to actual start and failures reach visible status (`src/main.ts:1578`, `src/main.ts:1708`).
- The studio uses the actual production driver for enabled audio and labels its completion callback as finished/released, so failures are separately observable (`tests/browser/safety-studio.ts:15`, `tests/browser/safety-studio.ts:24`). Tests cover real lifecycle contracts through fake media/timers, including cancellation before manifest resolution, reuse, rejection, failure and stalled native synthesis (`tests/browser-speech.test.ts:40`, `tests/browser-speech.test.ts:53`, `tests/browser-speech.test.ts:86`, `tests/browser-speech.test.ts:98`).

## Issues

### Critical

- None identified.

### Important

- None identified in the reviewed repair.

### Minor

- Native setup exceptions before the speak call are not converted to the optional failure diagnostic: utterance creation and voice enumeration occur outside its try/catch (`src/audio/browser-speech.ts:149`, `src/audio/browser-speech.ts:152`). The surrounding arbiter catches a thrown driver call and releases its owner, so this does not block warnings, but those exceptional failures would be silent. Wrapping the entire native setup path would make its failure reporting consistent with the media path.

## Assessment

**Task quality: Approved.** Cancellation and normal/error completion consistently preserve the single-owner contract, and the implementation addresses the observed native-engine stall for standard warnings. Remaining arbitrary-text reliability is explicitly deferred rather than claimed fixed.

## Evidence and scope

- Read the task brief, implementer report and all of `/tmp/openhorizon-stage3-playback-review.diff` (527 lines). Reviewed only the supplied change and the already-reviewed arbiter contract; no broader crawl or implementation changes.
- Reported verification: 54 tests in eight files passed; TypeScript exit 0. No suite rerun: the existing focused tests answer the relevant lifecycle risks. No browser action, network action, asset generation/copying or repository-state mutation performed.
- The PCM bytes and browser event evidence were supplied by root, not independently reproduced by this reviewer. A passing driver review does not establish successful native arbitrary-radio output.
