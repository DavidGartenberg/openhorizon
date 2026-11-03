# ATC radio: phraseology, other aircraft and voices

How the simulator's radio talks. Speech input (push to talk, Whisper) is in
[voice-atc.md](voice-atc.md); this page is about what is said back and by whom.

## What you hear

- **Controllers speak real phraseology**, with the phonetic alphabet and aviation numbers:
  "Skyhawk one two three Alpha Bravo, Palo Alto Ground, runway three one, taxi via Alpha, Bravo,
  hold short of runway three one." A facility names itself on first contact only; Tower gives the
  wind with every takeoff and landing clearance; departures are handed to Departure and arrivals to
  Ground by frequency; nothing is read out that the sim does not know (no weather, no wind).
- **Pilots call by name and read back.** Your menu and typed calls are spoken in a pilot's voice
  ("Palo Alto Ground, Skyhawk one two three Alpha Bravo, at the ramp with information Bravo, request
  taxi for departure"); a call you speak into the microphone is not repeated at you. The AI pattern pilots
  do the same with the tower and read back every instruction addressed to them, callsign last.
- **Traffic calls.** While you are airborne on the tower frequency, the controller points out the pattern
  aircraft that are within three miles and 1,500 feet of you: "Skyhawk one two three Alpha Bravo, traffic,
  eleven o'clock, two miles, southbound, Cherokee, altitude two thousand five hundred" (clock position from your
  track; at most one call per aircraft every 90 seconds and one overall every 25).
- **Callsigns** say their type word and shorten once an exchange is under way ("Skyhawk three Alpha
  Bravo"); airline flight numbers are grouped ("United twenty two sixty two") and never shortened.
- **Background traffic.** Tune the ground, approach or departure frequency of a towered field and other
  aircraft talk to the controller: taxi requests with the field's real taxiway names, airliners
  checking in on approach and being handed to the tower, climbing aircraft calling Departure. The tower
  frequency is left to the visible pattern pilots; background traffic never touches the tower's
  runway strips, so it cannot contradict a clearance you are waiting for. The amount follows the field's
  size and the AI traffic setting (OFF / LIGHT / REAL).
- **Outside North America** (anything but K, P, C, TJ, TI, MM idents) phraseology is ICAO: "tree", "fife",
  "niner", "decimal", winds in degrees and knots, QNH in hectopascals.
- **Everyone is a different person.** Each controller, airline crew and private pilot gets a stable
  voice, pitch and pace; Tower, Ground and Approach of one field never share a voice; airline crews have
  their airline's accent; other aircraft are a little noisier and quieter on the radio than the ground
  stations, each in its own way. The first officer and the cockpit warnings keep their own voices.
- **Order on the frequency.** One transmission at a time, with a short pause between speakers. Your
  exchange goes ahead of the other aircraft's traffic, which goes ahead of background chatter; a reply to
  you is never dropped because the frequency was busy. Pressing push to talk silences the radio.

## Where it lives

| Piece | File |
| --- | --- |
| Callsigns (parse, type words, short forms) | `src/sim/atc/callsign.ts` |
| Instructions and readbacks, shared by controllers and pilots | `src/sim/atc/phraseology.ts` |
| Tower / Ground / Approach / ATIS text | `src/sim/atc/{tower,ground,approach,atis}.ts` |
| Transmissions carry `to`, `kind`, `args`, `ambient` | `src/sim/atc/comms.ts` |
| AI pilot calls and readbacks | `src/sim/traffic/ai-pilot.ts` |
| Background traffic generator (seeded) | `src/sim/atc/ambient.ts` |
| Written text → what is said (FAA / ICAO) | `src/audio/spoken-aviation.ts` |
| Queue, ranking, gaps | `src/audio/safety-speech.ts` |
| Radio chains per role and per aircraft | `src/audio/radio-voice.ts` |
| Voice cast (voice, pitch, pace per speaker) | `server/voice-cast.mjs` |
| Synthesis (macOS `say`) | `server/voice.mjs` |

The written text on screen and in the transcript is never changed; speech is built from it at the
last moment.

## The voices

**Neural voices, when the Mac has them.** macOS keeps its best voices (the Siri natural voices and the Premium neural
voices) away from `say` and from any unsigned program, but Apple's own `swift` interpreter can reach them. The speech
server therefore runs `server/voice-neural.swift` as a long-lived helper (`server/voice-neural.mjs` manages it: started
on first use or when the page asks for the voice status, restarted if it dies, given up on if it keeps dying) and renders
transmissions through it: about a second per line once warm, to the same mono 16 kHz WAV `say` produces. On the
development Mac that is six voices: Nora and Simone (American), one British, Riya, Tara and Aman (Indian English; Aman is
the only male). Transcribed back by whisper.cpp they come out almost word-perfect ("Skyhawk 123 Alpha Bravo, Runway 31,
cleared for takeoff, wind 270 at Niner."). If the helper is missing, a voice is absent, or a render fails, the line is
spoken by a built-in voice instead and the radio never goes quiet.

Who gets which (`server/voice-cast.mjs`): Tower and Ground of a field take the two American voices, its other facilities
the rest, so a field's controllers all differ; the ATIS takes the first American voice; the player's and the AI pattern
pilots' voices come from the others, so a pilot is never the controller answering; airline crews take a neural voice of
their airline's accent when there is one (British Airways → the British voice); background traffic uses everything, the
neural voices counted twice against the built-in ones. The Siri natural voices ignore pitch, so only Simone and Aman are
varied (±8 %); pace comes from each voice's own measured curve. The first officer and the cockpit warnings keep their
own built-in voices.

**Built-in voices (`say`)** fill the cast where there are no neural ones (other Macs) and the background crowd:

- **Intelligibility** is measured, not guessed: `scripts/voice/audit-voices.mjs` speaks twelve radio
  transmissions in each installed voice and transcribes them with the same local whisper.cpp used for
  speech input. On the development Mac (rate 190): Samantha 88.5 %, Daniel 88.0 %, Karen 87.1 %,
  Moira 84.7 %, Sandy 84.2 %, Grandpa 82.3 %, Tessa 81.3 %, Rocko 80.4 % … Reed 73.7 %, Eddy 73.2 %. The weakest
  voices (the Eloquence ones, which also drop the "h" of "hold short") are kept to the background crowd.
- **Pace** is per voice: `scripts/voice/calibrate-rates.mjs` measures words per minute at several `say -r` rates (voices differ
  widely and several do not slow down below 150), and the cast interpolates each voice's own curve. Controllers run about
  168–190 words per minute, pilots 148–172, the ATIS 150.
- **Pitch** moves up to three semitones around each voice's own (`[[pbas]]`). Voices with no measured pitch are never shifted.
- **Premium or Enhanced voices that `say` can see** (System Settings → Accessibility → Spoken Content → System Voice →
  Manage Voices) are used automatically as well, ahead of the built-in ones, with their pace measured once in the
  background; covered by tests with fake voice lists only, since none of that kind is installed here.

**Checking it.** `scripts/voice/rehearse.ts` runs a short scenario through the real controllers, AI pilots and background
traffic, renders it through the speech server's own function (cast, neural helper, fallback) and reads it back: who said
what, in which voice (● = neural), at what pace, and how much was understood. 85 % of the words on the development Mac with
the base English model; the misses are mostly place names such as "Palo Alto" and the built-in background voices. A
recogniser is not a listener: it says whether the words survive, not how human a voice sounds.

## Settings

- `localStorage['oh-voice-my-calls'] = 'OFF'` stops your menu and typed calls being spoken.
- `localStorage['oh-ai-density']` (OFF / LIGHT / REAL) sets both the pattern pilots and the amount of
  background traffic.

## Limits

- The neural voices need macOS with `/usr/bin/swift` (the Xcode command line tools) and the Siri / Premium voices downloaded;
  without them the built-in voices speak and are clearly synthetic. Nobody has listened to either: a recogniser cannot judge
  how human a voice sounds.
- Background traffic is radio-only: the aircraft that talk are not drawn. The visible ones are the AI
  pattern pilots on the tower frequency.
- Live ADS-B traffic is not addressed by the controllers.
- Facility and place names are said as the synthesizer reads them; there is no pronunciation lexicon
  (respellings were tried and changed nothing a recogniser could confirm).
- Taxi routes come from the field's OpenStreetMap taxiway names where known, otherwise "taxi to runway N".
- The ATIS plays once when tuned, not on a loop.
