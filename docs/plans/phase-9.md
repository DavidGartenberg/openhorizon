# Phase 9 plan — Sound, polish, performance, §27 flight (§16, §17, §19)

## Slices (one commit each)

- **9a. Sound core (§16).** `src/audio/engine-sound.ts`: WebAudio synth —
  4-cylinder engine (firing-rate fundamental = RPM/60×2 with harmonics +
  shaped noise through a lowpass, gain by shaft power), slipstream noise by
  IAS, ground-roll rumble by surface speed, stall horn (steady tone above
  stallFraction threshold), touchdown thump. Starts on first user gesture
  (autoplay policy); M toggles mute. Automation cannot *hear* — verified by
  node-graph introspection via `__ohAudio` + an honest PROGRESS note that
  the audible check is the user's.
- **9b. Save/load + loading (§17 subset).** O saves a snapshot (position/
  alt/heading/speed/fuel/time/weather mode) to localStorage, P loads it;
  `weight <lb>` search command sets payload (W&B sliders → deviation).
  `__ohSave/__ohLoad` hooks; verified across reload.
- **9c. Performance gate + the §27 flight.** fps measured fronted at the
  busiest scene we have (towered field + AI + live wx + safety layer);
  then the definition-of-done run end-to-end from a fresh boot: search an
  airport, taxi/talk/fly a circuit with ATC among AI, land, debrief +
  logbook entry — screenshots, PROGRESS final close.

Phase 10 (737, Cub) remains stretch, explicitly after §27 per §25.
