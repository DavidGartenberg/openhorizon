# Installed X-Plane audio audit — 2026-09-18

Scope: read-only inspection of installed assets, plus this report. No assets copied,
no decoder installed, no unknown binaries executed, no browser playback performed.
The Sept18 user instruction authorizes local imports and supersedes the old
no-copy instruction in sound-brief.md. Originals must remain untouched; no upload
or publishing is part of this work.

## Findings that change the implementation plan

Original aircraft samples are present and inspectable. All 20 aircraft families
have an FMOD `Master Bank.bank`, `.snd` attachments and `GUIDS.txt`; there are 24
ACFs and zero loose aircraft WAVs. Every aircraft bank has a visible RIFF/FEV
container and FSB5 sample header. There is no evidence here of encryption blocking
these banks, although actual decoding has not been tested.

**ATC speech is not in `Resources/sounds/ATC.bank`.** That bank is only 4,272 bytes
and has no FSB5 header. Speech lives in
`Resources/default scenery/1200 atc data/voices/`: 64 ZIP archives and 41 `.voc`
dictionaries were found. This is a separate, promising import path.

There are also directly usable original PCM WAVs in `Resources/sounds/engine`,
`systems`, `contact` and `alert`. These are X-Plane's generic sounds, not the
aircraft-specific authored FMOD mix. They can provide an honest original-sample
fallback while exact aircraft playback is developed.

All paths below are relative to `/Users/davidgartenberg/X-Plane 12` unless noted.

## Bank evidence

Read-only Python mmap inspected headers and names without extracting the banks.
FSB fields below are version, sample count and codec-mode integer. All 20 aircraft
banks reported version 1 and mode 15. Treat the codec interpretation as needing
confirmation by the decoder; the binary integer alone is not a playback test.

| Aircraft folder under `Aircraft/Laminar Research` | Bank bytes | Samples |
| --- | ---: | ---: |
| Aero-Works Aerolite 103 | 4,868,352 | 64 |
| Airbus A330-300 | 16,579,104 | 330 |
| BETA Technologies Alia-250 | 6,481,312 | 80 |
| Beechcraft Baron 58 | 13,953,888 | 212 |
| Beechcraft King Air C90B | 8,836,224 | 194 |
| Boeing 737-800 | 12,357,184 | 327 |
| Cessna 172 SP | 11,106,400 | 200 |
| Cessna Citation X | 12,194,880 | 308 |
| Cirrus SR22 | 8,226,528 | 155 |
| Cirrus Vision SF50 | 8,281,600 | 148 |
| Grumman F-14 Tomcat | 19,086,080 | 299 |
| Lancair Evolution | 11,103,968 | 168 |
| McDonnell Douglas F-4 Phantom II | 5,811,968 | 118 |
| McDonnell Douglas MD-82 | 12,471,360 | 334 |
| Piper PA-18 Super Cub | 9,980,896 | 123 |
| Robinson R22 Beta II | 9,918,368 | 140 |
| Schleicher ASK 21 | 6,149,760 | 85 |
| Sikorsky S-76 | 8,827,456 | 146 |
| Stinson L-5 Sentinel | 6,802,080 | 141 |
| Van's Aircraft RV-10 | 6,497,216 | 134 |

Each listed bank is `fmod/Master Bank.bank`. For the 737 its FSB5 begins at byte
1,060,160; the 60-byte FSB header is followed by 17,040 bytes of sample headers,
6,132 bytes of names and 11,273,792 bytes of sample data. Readable names include
`freq N1 35 d`, `freq N1 75 b`, `humm N2 mid`, `reverser`, `flyby towards`,
`gear warn`, `gpws 100ft`, and `732 speedbrake deploy 2`.

`Resources/sounds/environment.bank`: 55,611,616 bytes, FSB5 at 220,032,
220 samples, mode 15. `Resources/sounds/Master Bank.bank`: 2,476 bytes, no FSB5.

## Preserve authored events with an FMOD runtime where possible

X-Plane documents FMOD Studio 2.02.xx for X-Plane 12. Its `.snd` files bind
events, locations and simulator conditions; parameters can use simulator
datarefs. These are bindings, not a complete description of the bank's internal
sample layers, pitch curves and mixing.
[X-Plane FMOD integration](https://developer.x-plane.com/article/using-fmod-with-x-plane/),
[SND specification](https://developer.x-plane.com/article/sound-snd-file-format-specification/),
[event parameters](https://developer.x-plane.com/article/fmod-event-parameters-for-x-plane/).

Concrete 737 binding in `fmod/b738.snd`:

- `/b738/engines/engine_1`: engine 0 position, parameter index 0, starts when
  `sim/flightmodel2/engines/N2_percent[0] != 0`, ends at zero, allowed for AI.
- `/b738/engines/reverser`: engine 0, parameter index 0, gated by actual
  `thrust_reverser_deploy_ratio[0]`.
- `/in_cockpit` snapshot: sound-space 0 inside ratio, positioned at
  `(0, 1.313, -15.883)`; the file also defines cockpit/cabin boxes.
- `GUIDS.txt` maps `event:/b738/engines/engine_1` to
  `{0e9a6d1d-5fab-4f71-95c8-cd8abdb8f653}` and `snapshot:/in_cockpit` to
  `{5a81b4eb-097a-4ec2-80df-53b532b16604}`. Thus absence of a separate
  `.strings.bank` need not prevent event identification by GUID.

The C172 `/c172/engines/engine` starts on engine rotation speed above 1 rad/s,
with crash and engine-separation gates. Other attachments use DELTA conditions,
commands and multiple conditions. Implement the SND grammar deliberately; do not
eval arbitrary file text or assume every attachment is a simple RPM loop.

Best-fidelity browser experiment: obtain a compatible official FMOD Studio
HTML5 JS/WASM runtime, load just the 737 bank, resolve the known event GUID,
enumerate its parameters, map actual simulation state, and demonstrate rendered
audio. FMOD documents a Studio JS/WASM runtime and FSB Vorbis/FADPCM/PCM support.
It still needs audio unlock and regular update calls; dynamic DSP plug-in loading
is unsupported in HTML5. Bank compatibility and any missing DSP dependencies need
an actual load test. [FMOD HTML5 platform documentation](https://www.fmod.com/docs/2.03/api/platforms-html5.html).

Fallback for aircraft samples: decode selected FSB subsounds to PCM, keep a
manifest with original bank/name/index/hash, then create WebAudio loops/events.
This uses original recordings but reconstructs behavior; it does **not** preserve
the full authored FMOD event mix. Do not describe it as exact FMOD playback.

## ATC evidence and feasible conversion

`voices/default controller/Matthew.zip` is 3,935,570 bytes and contains 489
unencrypted entries: 480 custom Opus clips and nine ordinary WAVs.
`voices/usa controller/usa_Matthew.voc` points to the default-controller ZIPs
(`Matthew.zip`, `_nav.zip`, `_apt.zip`, `_acf.zip`) and includes semantic
`ALIAS_TEXT`/`ALIAS_WAVE` mappings. Numbers have lead/mid/final variants;
special functions include altitude, frequency, runway, heading, callsign and
squawk. These functions need application implementations, not merely string
replacement. `procedures.voi` maps navigation identifiers to recorded clips.

The `.opus` extension is misleading for browser playback: the inspected files
start with `CHROPUS!`, **not** OggS. Read-only inspection of all 480 Matthew clips
validated this framing hypothesis against every byte:

1. Eight-byte magic `CHROPUS!`.
2. Four additional header bytes (meaning not yet verified).
3. Repeated big-endian uint32 packet length and that many compressed bytes.

For `0_final.opus` (1,222 bytes), 23 packets consume the file exactly; for
`0_lead.opus` (1,176 bytes), 21 packets; `0_mid.opus` (1,255 bytes), 23 packets.
This establishes framing, not successful decoding, sample rate, channel count,
duration, trimming or audible quality.

Next bounded experiment: decode one framed clip with libopus to WAV, or repackage
packets into standards-compliant Ogg Opus for browser decoding. Validate channels,
sample rate, packet duration and start/end trim before bulk conversion. Official
libopus exposes packet inspection and sequential packet decoding; use separate
decoder state per clip. [Opus decoder API](https://opus-codec.org/docs/opus_api-1.5/group__opus__decoder.html).

The ZIP also has PCM `mic_open.wav`, `mic_close.wav` and `bg_atc.wav`, plus
`bg_helo`, `bg_jet`, `bg_lso`, `bg_prop`, `bg_pushback`, `bg_turbo` WAVs. Python's
wave reader verified all nine as 16-bit mono PCM at 16/22.05/48 kHz. This permits
immediate original radio-click/background integration, but background clips must
not be passed off as dynamically generated ATC instructions.

After conversion, map the simulator's structured ATC intents to voice fragments,
preload complete utterances and schedule clips as a single interruptible turn.
Retain safety priority, PTT echo prevention and cancellation. Use current local
TTS only for missing phrases, with an explicit original-clip versus synthesized
diagnostic. Arbitrary copilot prose cannot be promised from this finite library.

## Local tooling and current integration gaps

- Python 3.14 and Node are on PATH. `ffmpeg`, `ffprobe`, `vgmstream-cli`,
  `fsbank`, and `fsbextract` are not on PATH.
- Installed X-Plane includes `X-Plane.app/Contents/Frameworks/libfmod.dylib`
  and `libfmodstudio.dylib`. They were located but not loaded/executed. A small
  native helper using verified ABI/architecture may be an alternative for local
  offline rendering; these native libraries do not run in the browser.
- No libopus/libvorbis/libogg was found directly in `/opt/homebrew/lib` or
  `/usr/local/lib`. This was a bounded search, not proof none exists anywhere.
  No standalone browser FMOD runtime was identified. A broader filesystem scan
  was interrupted; no installation or Xcode license acceptance occurred.
- Current `server/xp-static.mjs` only serves `.obj/.txt/.png/.dds` beneath the
  aircraft root. It cannot currently serve banks, SND files or global sounds.
  Add a narrow audio manifest/route or an explicit local import cache, preserving
  path validation and avoiding exposure of unrelated installation files.
- `src/audio/engine-sound.ts` currently synthesizes audio. Import inventory and
  fallback playback must remain distinguishable from exact-aircraft imports.

## Recommended implementation order and acceptance

1. Add a provenance manifest and copy/serve a small set of original loose WAVs
   and radio clicks. Verify real browser decoding and playback, then original
   aircraft-family fallback layers. Preserve existing verified safety clips.
2. Prove one CHROPUS conversion, then one structured ATC clearance assembled
   from original Matthew clips. Check all segment hashes, decoded duration,
   cancellation, microphone capture inhibition and actual browser completion.
3. Prove one exact 737 FMOD event using its GUID and live parameters. If runtime
   acquisition or compatibility blocks this, report that specific result and
   pursue selected-sample decoding without claiming authored-mix fidelity.
4. Extend aircraft coverage only after bounded loading/unloading, pause/reset,
   cockpit/exterior, engine shutdown/reverse and resource cleanup checks pass.

Open technical questions: actual FSB decode/runtime compatibility; potential
bank DSP dependencies; mapping every required event parameter to available
simulator state; CHROPUS header/trim semantics; browser performance and audible
quality. No imported aircraft or spoken ATC playback is established by this audit.

## Root follow-up: original737sample decode proved
The installed FMOD Core library loaded successfully through ctypes, reporting
version0x20229. With NOSOUND output (no device playback), an extracted FSB slice
opened and enumerated327subsounds. `freq N1 75 b` is index16, stereo48kHzfloat32,
3,491,048decodedPCMbytes. Crucial: CREATESTREAM|OPENONLY plus seekData(subsound,0)
is required before readData; without the explicit seek, readData returned EOF or
FILE_BAD withzero bytes. After seeking, readData returned0 and the full byte count.
Converted floats toPCM16:9.091270833s, peak.18164, RMS.03774. BankSHA256 and original
sample identity are recorded in server/cache/speech/xplane-probe/result.json.
Original bank remains unchanged. Diagnostic source fmod-sample-probe.py is next
to this report; it is a bounded experiment, not the production import pipeline.
Outputserver/cache/speech/xplane-probe/b738-n1-75.wav. Browser playback test harness
/tests/browser/imported-audio.html. Flight event mapping and full authored mix
remain future work; this proves original sample decoding, not entire soundgoal.
Browser confirmation during Stage6 code freeze: HTMLAudio decoded9.091seconds,
then produced actual Playback started and Playback ended events for the imported
737N1sample. Earlier playback was interrupted by Vite development reload and was
not counted. The successful uninterrupted run establishes browser compatibility.

## Sept18 original ATC decoding proof
- Read-only audit of installed Matthew.zip: all480CHROPUS clips have header frames×3 exactly matching Opus TOC packet duration at48kHz;0mismatches. Reproducible local re-containerization script: atc-opus-probe.py. Source packets unchanged, original archive untouched. OggOpus header mono, pre-skip0 pending subjective quality assessment.
- Local cached0_final.opus repacked as server/cache/speech/xplane-probe/atc-matthew-zero.ogg,23packets,0.460s. Installed FMOD Core rejected OggOpus(error19); noWAVproduced by that attempted route.
- Actual Codex browser imported-audio harness then decoded via WebAudio:1channel,48000Hz,0.460s,peak0.3228,RMS0.0700; media playback started and ended. This is actual decoder/playback evidence, not yet semantic ATC phrase integration or subjective hearing acceptance. Root closed test tab after verification.
- Format references consulted: https://www.rfc-editor.org/rfc/rfc7845.html and https://www.rfc-editor.org/rfc/rfc6716.html#section-3.1 . Future integration should parse VOC phrase metadata, retain all valid voice variants, handle unsupported phrases through established local speech fallback, preserve safety priority/PTT cancellation, and test timing/cleanup.

## Sept18 authored FMOD engine-event proof
Installed FMOD Studio library loads the original737Master Bank successfully:151events. Engine1 resolves through its GUID without a strings bank, with10parameters. Metadata probe: fmod-studio-probe.py; result server/cache/speech/xplane-probe/b738-studio-event.json. Parameters include N1,N2,jetwash,burningfuel,inside_any,altitude,radioaltitude,thrust_delta plus automatic distance/cone angle.

A separate bounded offline event render (fmod-event-render-probe.py) used the installed Studio/Core libraries, WAVWRITER_NRT, synchronous Studio updates and STREAM_FROM_UPDATE. Engine1 event instantiated, loaded samples and started with N1=75,N2=85,jetwash=100,burningfuel=1,thrust_delta=0,altitude=radioaltitude=inside_any=0; source position10m to the listener's right.750updates with512sample DSPbuffer produced8.16s stereo48kHzPCM16; peak0.69974,RMS0.11215,766747nonzero samples. Output b738-authored-event.wav and metrics JSON in same local cache. No source changes or speaker output during offline rendering. This proves actual bank-event mixing, not merely raw FSB decoding; no real-time browser FMOD runtime or complete XPlane sound environment is established.

API references: https://www.fmod.com/docs/2.03/api/studio-api-system.html , https://www.fmod.com/docs/2.03/api/studio-api-eventdescription.html , https://www.fmod.com/docs/2.03/api/studio-api-common.html , https://www.fmod.com/docs/2.03/api/core-api-system.html , https://www.fmod.com/docs/2.03/api/studio-api-eventinstance.html . Runtime is installed2.02.29; observed C API calls succeeded. The diagnostic does not claim full authored engine behaviour across other parameters or aircraft. Offline snapshots could preserve more original mixing than manually layered single samples, but continuous flight transitions still need deliberate integration and validation.
Browser follow-up: imported-audio.html decoded the original event render as8.160s; actual playback-start and playback-end both observed uninterrupted in a separate background test tab. Tab closed afterward. This is browser compatibility evidence, not subjective audition or live flight mixing acceptance.
Further bounded metadata census: all20installedaircraft Master Banks loaded with Studio runtime;0failures. Event counts/provenance SHA256 recorded in server/cache/speech/xplane-probe/bank-studio-inventory.json; reproducible fmod-bank-inventory.py. This is metadata compatibility only, not samples or event playback for all20.

## Sept18 additional original event renders

Extended metadata probe with explicit aircraft/GUID arguments and offline render probe with named cases. Initial metadata CLI shadowing bug (loop args overwrote parsed args) was corrected to a separate options variable before collecting results. No production sound graph or original asset changed.

Actual installed ASK21 event `/ask21/environment/airflow` GUID `{3b679540-5d21-4d59-9646-45e7cf16e98c}` has7parameters: IAS, AoA, airbrake ratio, canopy slider, crash state, interior flag, automatic distance. External airflow event has IAS/crash/automaticdistance. C172 `/c172/engines/engine` GUID `{a5b8d7bc-8098-4d46-828d-71991b0de687}` has8parameters including rotation rad/s, burningfuel, both doors, interior ratio, heading/pitch relative event and distance. GUIDs resolved from installed GUIDs.txt and linked .snd definitions.

`python3 docs/plans/sept13/fmod-event-render-probe.py --case as21-clean|as21-airbrakes|c172-cruise` ran separately. Each original event loaded, samples loaded, instance started, updates succeeded and WAVWRITER_NRT produced stereo48kPCM16. Glider cases use60KIAS,AoA3°,canopyclosed,interiorflag1,airbrakes0/1; sourceatlistener. C172 uses2400RPM convertedrad/s,burningfuel1,doorsclosed,exteriorflag0,10m source.

|Case|Duration(s)|Peak|RMS|
|---|---:|---:|---:|
|AS21 clean|8.106667|.254364|.049347|
|AS21 airbrakes|8.106667|.338715|.073304|
|C172 cruise|8.202667|.411102|.115684|

Full parameters, output paths, SHA256 and sample counts: `server/cache/speech/xplane-probe/{case}-event.json` and `family-event-metrics.json`; WAV files `{case}-authored-event.wav`. Nonzero bounded PCM verifies renders, not subjective quality or seamless runtime transitions. Separate FMOD random sources may vary across renders, so RMS difference alone is not an isolated proof of the airbrake automation; the authored parameter and actual supplied0/1 are verified. Cockpit snapshot routing is not recreated merely by setting event interiorflag. Browser playback of these three new events remains unverified because the temporary full-simulator test tab stalled; prior737/ATC browser results stand.

### Browser acceptance of the three additional renders

Fresh IAB tab16 `/tests/browser/imported-audio.html`: selected and played ASK21clean, ASK21airbrakes, C172cruise consecutively. Each realHTMLmedia decoded (8.107/8.107/8.203s), emitted playing then ended; each complete event was observed in DOM before starting next. Error-level browser logs empty. No synthetic engine ran in this harness. Added selectablecase/button, mutual exclusion among allmedia and Stop/pagehide cleanup. Closedtab after finalended. This establishes actualbrowserplayback of these three originalevent renders, not livecontinuousflightintegration or subjective timbreapproval.

### Memory-only capture follow-up

Root ran `fmod-capture-proof.py --case` separately for `as21-clean`,
`as21-airbrakes` and `c172-cruise`. Each original event produced exactly 120
callbacks of 512 frames, two input/output channels, 48 kHz: 61,440 stereo frames
in memory with no native device output. Parsed JSON assertions checked that no
error occurred, formats/counts matched, and all samples were finite and nonzero.

| Case | Peak | RMS |
| --- | ---: | ---: |
| ASK21 clean | 0.231057 | 0.049320 |
| ASK21 airbrakes | 0.299011 | 0.073466 |
| C172 cruise | 0.395735 | 0.117843 |

Results: `server/cache/speech/xplane-probe/{case}-capture-result.json`. This
extends the earlier B738 direct-memory feasibility evidence, not the duration
or coverage of browser playback. A fixed production buffer, persistent service,
cockpit snapshots and sustained latency are still unimplemented. The next
transport slice is specified in `authored-audio-transport-plan.md`.
