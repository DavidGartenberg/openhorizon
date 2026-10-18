# Stage 4 — voice ATC with push to talk

Read global constraints in implementation.md. Build after safety audio controller;
inspect its current API rather than restoring old main speech functions. Own a
focused browser recognition/PTT controller, ATC voice UI, integration in main.ts,
input/Gamepad KeyT hold support as needed, and meaningful fake-adapter tests.

User wants actual voice ATC with push to talk. Reuse sendFreeTextAtc(said) in main:
it calls interpretTransmission in sim/atc/freetext.ts and the current ground,
tower and approach state machines. Transcripts must enter that same path exactly
once, with the correct active facility/frequency; no parallel pretend-ATC system.
Keep typed transmission available, ATC menu and transcripts readable. Use English
aviation normalization for spoken runway numbers/callsigns/altitudes only where
unambiguous; do not fabricate clearances when speech is unclear.

Provide a visible Hold to talk button and hold-T keyboard binding (current T
toggles menu: move menu action to an obvious UI button or another free key and
update help). Sidestick trigger currently aliases KeyT; add to HELD_ALIASES now
for actual press/release. Stage6 will complete controller ownership/reconnection.
Support pointerup outside button, pointercancel, blur, input focus, gamepad
disconnect, paused sim, cancel, teardown and new flight without stuck recording.
Distinguish idle/requesting microphone/listening/processing/transcript/error.
Use user gesture for recognition start; release flushes final result then sends
once. Late callbacks from a cancelled/replaced session must never transmit.
Hold across short recognizer endpoints should not silently stop early; bounded
capture/retry, no runaway auto restart. Make radio speaker echo unable to issue
new commands (coordinate speech while listening; critical safety remains audible).

Browser: SpeechRecognition or webkitSpeechRecognition; capability probe is not
sufficient (WKWebView may expose API yet fail permission/service). Handle actual
errors clearly, preserve transcript, give usable supported-browser route if
embedded engine cannot recognize. Prefer local recognition if API reports it
available; don't require experimental features universally. Explain browser
recognition service in UI if network-backed, no secret recording outside PTT.
No API keys/paid service. Root CUA recovered: live in-app browser is Chrome152
(NOT WKWebView), SpeechRecognition + processLocally exposed, secure context and
microphone API present. available({langs:['en-US'],processLocally:true}) returned
downloadable on systems check page. Add a clear Download local English speech
button using the official install API, report progress/errors, prefer this ready
local path. Root can perform download/actual checks once implemented. Do not
silently default to remote when local language is still missing.

Primary sources already checked:
https://developer.mozilla.org/en-US/docs/Web/API/SpeechRecognition
https://developer.mozilla.org/en-US/docs/Web/API/SpeechRecognition/processLocally
https://developer.mozilla.org/en-US/docs/Web/API/SpeechRecognition/available_static
https://webkit.org/blog/11648/new-webkit-features-in-safari-14-1/
https://bugs.webkit.org/show_bug.cgi?id=239816
processLocally and available are experimental; WebKit speech may require Siri and
embedder permissions. Deprecated SpeechGrammarList does not constrain recognition.

Tests first: held/released transcript, interim+final duplication, delayed final
after release, cancel/new flight stale callbacks, permission denied/no speech,
unsupported engine, key repeats/blur, hardware hold/release, echo and typed ATC
regression. Run voice/ATC/input focused tests and tsc. Root browser tools only.
Full report voice-report.md; concise status; no commits.

Live preparation update: root clicked browser's local install({langs:['en-US']})
through system-check page; it resolved false immediately despite availability
downloadable. Preserve explicit download-failed recovery; don't claim local model
ready. A usable fallback may require browser network recognition or a local
transcription service. Test actual service rather than only constructor presence.

Root prepared a reliable local fallback with user-approved installations:
- Homebrew whisper.cpp1.9.4, CLI /opt/homebrew/bin/whisper-cli and whisper-server.
- English base model downloaded from the project's official GGML model hosting:
  server/cache/speech/ggml-base.en.bin (141MiB, ignored cache).
Implement a local transcription route as the preferred path when available, so
ATC does not depend on the browser's broken language-pack/service support. Record
only while PTT is held, encode bounded mono16kHzPCM WAV (no ffmpeg dependency),
POST to same-origin local handler, spawn executable with argument array/no shell,
timeout and bounded concurrency, clean ephemeral recordings and discard cancelled
responses. Status endpoint reports engine/model availability, no recording saved
permanently. The existing route(url,res,method) API does not receive request body:
inspect server/index.mjs and vite.config.ts and extend narrowly without breaking
existing GET handlers. Do not publicly expose transcription service; use same
local host and enforce body/type/duration limits and reasonable origin checks.
Document setup for another machine; current Mac is ready for actual inference.
Keep browser-recognition adapter only as an explicit supported alternative if
useful, not a second uncontrolled recording pipeline.

Actual CLI inference succeeded (exit0) using installed alert/glideslope.wav but
recognized the very short synthesized warning as "Light slow." This confirms
engine execution, not reliable aviation transcription. Validate with complete
ATC phrases and normalize only unambiguous terms. macOS say generated an empty
WAV in sandbox despite exit0; don't use that as a valid fixture without checking
duration/data length. Reference audio must contain real PCM samples.

Later actual phrase validation succeeded after authorized macOS say outside the
sandbox: /tmp/openhorizon-atc-phrase.wav is6.5015s mono16kHzPCM16 (208048audio
bytes), generated text Tower,Cessna November one two three Alpha Bravo,holding
short runway two seven,ready for departure. whisper-cli -m cachemodel -f thatWAV
-nt -np -t4 -ng exit0 returned "Tower, Sessna November 1-2-3 Alpha Bravo, holding
short runway 27, ready for departure." Correct operational intent/runway, one
aircraft-name spelling error; retain as actual endpoint integration fixture.

Stage3 live playback diagnosis: in-app native SpeechSynthesis enumerates180voices,
selects Samantha, returns speakingtrue/pausedfalse but never starts/ends; changing
hazard cancels both old/new callbacks. Ordinary HTMLAudio PCMfixture completes.
Stage3 now uses original prerecorded warning WAVs through BrowserSpeechDriver;
inspect its final API/report. For Stage4 arbitrary ATC replies also need reliable
spoken output: add a bounded local macOS say-to-WAV route alongside Whisper,
using trusted installed /usr/bin/say, argument array/no shell, inputlength/origin/
concurrency/time/tempcleanup bounds, validate nonempty PCM, no permanent user
recording. Prefer local dynamic audio when status says ready, native synthesis
only supported fallback with visible failure state. Keep warning clips instant;
route dynamic resolver through existing single speech owner, abort stale requests
and revoke object URLs. Do not block other OS/browser users from typed ATC.

PTT echo: setRadioSuspended currently does not suppress copilot priority1; ensure
copilot speech is suspended during capture while real safety callouts/warnings
remain allowed. Recognizer must not transmit delayed outputs after reselecting a
frequency, changing flight, or cancelling session. Root fixture is now available
at tests/browser/fixtures/atc-phrase.wav (original generated phrase, realPCM).

Stage3 reviewed minor: native createUtterance/getVoices exceptions currently can
skip driverfailure diagnostic; handle with dynamicdriverintegration. Stage3 final
54tests+tscPASS, actualwarningbrowserplaybackPASS. Keep20staticclips unchanged.
Local service enforcement includes loopback remoteAddress, not merely Origin;
standalone Express currently binds alladdresses bydefault, preserve existingdata
routes but do not expose microphone transcription/dynamicTTS over LAN. Reject
foreignOrigin, boundbinaryWAVrequestbeforebuffering, abortchildonclientcancel.
