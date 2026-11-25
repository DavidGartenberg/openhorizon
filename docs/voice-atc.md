# Local voice ATC

Source checked 2026-11-24. See [DEVELOPMENT.md](DEVELOPMENT.md) for shared server
setup and [CURRENT-STATE.md](CURRENT-STATE.md) for project verification limits.

**Quickest way to talk:** click **Talk to ATC** (microphone icon in the top toolbar), say your transmission, and it sends itself when you stop talking (click again to send immediately). Or hold **T** / **Hold to talk** as before.

**What the controller understands** (spoken, with numbers as words or digits — "heading two seven zero", "three thousand five hundred", "runway two eight left", "one one eight point seven"): requests for taxi, pushback, startup, takeoff ("ready for departure", "ready to go"), landing ("inbound full stop", "straight in"), touch-and-go / low approach, left/right/closed traffic, pattern positions ("downwind", "turning base", "established on the localizer"), go-arounds, weather/ATIS/altimeter, radio checks, flight following, IFR clearance, altitude and heading requests, direct-to, frequency changes, acknowledgments ("roger", "wilco", "unable") and every emergency ("mayday", "pan-pan", engine fire/failure, medical, low fuel). Replies use the real runway, wind and altimeter. Anything it cannot place gets an honest "say again".

**Speech engines.** Local Whisper (below) is used whenever it is set up — audio never leaves this computer. If it is *not* set up and your browser has speech recognition (Chrome, Edge, Safari), the app uses that instead, and says so in the voice panel: in that case your browser's own speech service processes the audio. Nothing is ever sent unless you are holding or have clicked Talk.

Hold **T**, the sidestick trigger mapped to T, or **Hold to talk**. Speak a complete English transmission, then release. Open **ATC menu** (backquote) to type instead. Voice uses the same free-text classifier and ground/tower/approach strip machines as typed ATC; it is not an unrestricted conversational controller.

Capture starts only after an explicit hold or click-to-talk action. In local
Whisper mode, audio is held in memory for at most 20 seconds, encoded as mono
16 kHz PCM WAV, sent to the local service when the transmission completes, and
temporary inference files are deleted afterwards. This mode does not send audio
to a cloud recognizer. The browser-recognition fallback instead uses the browser's
speech service and can involve remote processing, as disclosed in the voice panel.
The transcript is shown after processing. Hardware triggers require a physical
release before rearming after cancellation, and capture requires a focused,
visible page. Cancel, blur, text focus, hiding the page, disconnecting a controller,
pausing, changing frequency/facility or starting a flight discards pending
transmissions. Radio and copilot audio stop during recording; safety callouts
remain audible and cancel capture to prevent echo commands. Wait for a safety
callout to finish before trying again.

An earlier embedded Chromium language-pack installation failed; that historical
result is not a current capability check. The current app prefers local Whisper
when ready, otherwise offers browser recognition when exposed by the browser,
with the processing distinction shown in the panel. Microphone recording requires
a secure context (localhost counts) and browser microphone permission. If the
embedded browser denies access, open the local address in a compatible browser
and allow the microphone. **Check local voice** retries service detection; typed
ATC works without a speech engine.

## Setup on another computer

Run the Vite development server, or build the app and run `node server/index.mjs`. Both mount the same `/api/voice/` routes. Open the app through `localhost` or `127.0.0.1`; speech routes reject LAN clients and foreign origins even when other simulator data routes are exposed.

Install [whisper.cpp](https://github.com/ggml-org/whisper.cpp) and its English base GGML model. On Apple Silicon with Homebrew, `brew install whisper-cpp` installs `/opt/homebrew/bin/whisper-cli`. Download the model using the project's documented model download workflow and place `ggml-base.en.bin` at `server/cache/speech/ggml-base.en.bin` (ignored by git). Set `OPENHORIZON_WHISPER_BIN` and `OPENHORIZON_WHISPER_MODEL` when using another installation path or OS. These are local server configuration variables, never browser input.

On macOS, `server/voice.mjs::renderSpeech` produces temporary PCM WAVs.
`server/voice-cast.mjs` selects voices by role, speaker and phraseology style.
When a supported neural voice is available, the server uses the local Swift
helper in `server/voice-neural.swift`. An unavailable or failed neural voice
falls back to `/usr/bin/say`, with Samantha as the final local fallback. Browser
synthesis supplies dynamic replies when local synthesis is unavailable and the
browser supports it. The client applies spoken aviation normalization and
radio/intercom processing, caches dynamic clips, and prewarms standard copilot
calls. The speech driver plays the clips and releases their object URLs.
Standard safety warnings retain their prerecorded PCM clips. Verify audible
output with a listening check.

`GET /api/voice/status` reports executable/model availability, not successful
recognition or audible output. A permission prompt, unavailable microphone, empty
or near-silent recording, process failure, oversized recording, or timeout produces
a visible error. Whisper can mishear callsigns and aviation words; review the
displayed transcript. Normalization handles runway digits/directions, digit runs
for headings/squawks/flight levels, hundreds/thousands (including without feet
units), and spoken frequency decimals. Explicit November/NATO registrations are
shortened; there is no fuzzy callsign correction or invented clearance. The
current examples and limits are exercised in
`tests/atc-speech-understanding.test.ts` and `tests/voice-ptt.test.ts`.

The service accepts 20 seconds of input and one speech job at a time. Whisper
and `say` subprocesses have a 30-second timeout, and the request has a 35-second
timeout. Replies are limited to 600 characters and 60 seconds of audio. Uploads
are bounded before buffering. Temporary directories are private. Subprocesses
receive argument arrays. Cancellation aborts per-request Whisper and `say`
processes. The Swift helper persists across requests. Speech responses use
`Cache-Control: no-store`.
