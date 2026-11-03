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

macOS `say` voices only; nothing leaves the computer. `server/voice-cast.mjs` knows each voice's accent,
gender, natural pitch, intelligibility and pace curve:

- **Intelligibility** is measured, not guessed: `scripts/voice/audit-voices.mjs` speaks twelve radio
  transmissions in each installed voice and transcribes them with the same local whisper.cpp used for
  speech input. On the development Mac (rate 190): Samantha 88.5 %, Daniel 88.0 %, Karen 87.1 %,
  Moira 84.7 %, Sandy 84.2 %, Grandpa 82.3 %, Tessa 81.3 %, Rocko 80.4 % … Reed 73.7 %, Eddy 73.2 %.
  The weakest voices, which also drop the "h" of "hold short", are kept to pilots. A recogniser is
  not a listener: the audit says whether words survive, not how human a voice sounds.
- **Pace** is per voice: `scripts/voice/calibrate-rates.mjs` measures words per minute at several `say -r`
  rates (voices differ widely and several do not slow down below 150), and the cast interpolates
  each voice's own curve. Controllers run about 168–190 words per minute, pilots 148–172, the ATIS 150.
- **Pitch** moves up to three semitones around each voice's own (`[[pbas]]`), which turns about ten voices
  into dozens of people. Voices with no measured pitch are never shifted.
- **Better voices are used automatically.** Download Premium or Enhanced English voices in System Settings →
  Accessibility → Spoken Content → System Voice → Manage Voices (Zoe, Ava, Evan, Nathan, Oliver, Serena, Matilda …)
  and restart the dev server: any installed English voice with "(Premium)" or "(Enhanced)" in its name is cast
  ahead of the built-in ones (controllers and the ATIS from the American ones, airline crews from the one matching
  their airline's accent), and its pace is measured once, in the background. Nothing in this repo was tested
  against such a voice (none is installed on the development Mac): the selection is covered by tests with fake
  voice lists, so give it a listen.
- `scripts/voice/rehearse.ts` runs a short scenario through the real controllers, AI pilots and
  background traffic, speaks it with the real cast and reads it back: who said what, in which voice, at
  what pace, and how much was understood (82 % of the words on the development Mac, with the base English
  model; place names such as "Palo Alto" are where the recogniser trips).

## Settings

- `localStorage['oh-voice-my-calls'] = 'OFF'` stops your menu and typed calls being spoken.
- `localStorage['oh-ai-density']` (OFF / LIGHT / REAL) sets both the pattern pilots and the amount of
  background traffic.

## Limits

- Voices are the Mac's own synthesizer: clear, not indistinguishable from people. Only a listening check
  can judge that; the recogniser audit cannot. Premium voices would help most (and are picked up on their own).
- Background traffic is radio-only: the aircraft that talk are not drawn. The visible ones are the AI
  pattern pilots on the tower frequency.
- Live ADS-B traffic is not addressed by the controllers.
- Facility and place names are said as the synthesizer reads them; there is no pronunciation lexicon
  (respellings were tried and changed nothing a recogniser could confirm).
- Taxi routes come from the field's OpenStreetMap taxiway names where known, otherwise "taxi to runway N".
- The ATIS plays once when tuned, not on a loop.
