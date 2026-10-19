# Custom 737 audio pack (your own licensed recordings)

OpenHorizon ships only original, synthesized cockpit sounds. If you own a
licence to other recordings — for example an OEM or commercial add-on sound
pack — put the files in this folder with a `manifest.json`, and the 737 flight
deck will play them instead of the built-in sounds. Everything in this folder
except this README is git-ignored, so licensed files never get committed.

```json
{
  "aurals": {
    "fireBell": "fire-bell.wav",
    "apWailer": "ap-disconnect.wav",
    "configHorn": "takeoff-config-horn.wav",
    "gearHorn": "gear-horn.wav",
    "clacker": "overspeed-clacker.wav",
    "stickShaker": "stick-shaker.wav",
    "altAlert": "altitude-alert.wav"
  },
  "voice": {
    "PULL UP": "pull-up.wav",
    "SINK RATE": "sink-rate.wav",
    "TERRAIN AHEAD, PULL UP": "terrain-ahead-pull-up.wav",
    "TOO LOW, GEAR": "too-low-gear.wav",
    "BANK ANGLE": "bank-angle.wav",
    "TRAFFIC, TRAFFIC": "traffic-traffic.wav",
    "FIVE HUNDRED": "500.wav",
    "FIFTY": "50.wav"
  }
}
```

- Looped aurals (everything except `altAlert`) should be seamless loops.
- File names must be plain names in this folder (`.wav`, `.mp3`, `.ogg`, `.m4a`, `.flac`).
- Voice keys must match the sim's phrases exactly (see `STATIC_SAFETY_PHRASES` in
  `src/audio/browser-speech.ts`); anything you leave out keeps the built-in voice.
- Reload the sim after adding files. `__ohAurals()` in the console lists which
  aurals are playing your recordings (`custom`).
