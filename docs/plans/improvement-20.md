# 20-step improvement plan

Written after the shader / physics / FPS pass (terrain shading, 737 cabin, Google layers,
physics mods, weather shaders, dynamic resolution). Each step is concrete, testable and
lands on its own commit. Status is updated as steps complete.

| # | Step | Why | Verification |
|---|------|-----|--------------|
| 1 | **Spawn fallback without airport data**: spawn on the terrain at the default position (not at sea level under the ground) and say so on the HUD. | The sim showed a black screen when the airport list failed to load (offline, or the host blocked). | Unit test for the spawn-height helper; browser boot with the airport endpoint failing. |
| 2 | **Browser smoke test** (`npm run smoke`): boots the sim headless against local fixtures and fails on console errors or a black 3D view. | Catches render regressions such as the black screen that unit tests cannot see. | The script passes here; it fails with the fixture removed. |
| 3 | **Windshear aural** on jets: "WINDSHEAR" through the existing safety speech, at the highest priority. | The alert is visual only today; real reactive systems speak it. | Unit test on the alert plumbing; spoken text observed in the browser. |
| 4 | **Glider variometer**: total-energy vario with climb/sink tones and a HUD readout for sailplanes. | Thermals are unusable without a vario. | Pure TE-vario tests; tone pitch follows lift in the browser. |
| 5 | **Cumulus over strong thermals**: puffs at the thermal tops when the air is moist enough (cloud base from dewpoint spread). | The visual cue glider pilots use to find lift. | Pure placement tests; harness render. |
| 6 | **Falling rain and snow** around the camera, stretched by the relative airflow. | Rain and snow show only on glass and ground today. | Harness render; no per-frame allocations. |
| 7 | **Lightning** in thunderstorms: sky and cloud flashes, with thunder delayed by distance. | +TSRA looks and sounds like plain rain. | Pure scheduler test; harness render. |
| 8 | **Touchdown tyre smoke**: wheel spin-up puffs scaled by sink rate and slip. | Landings have no visual feedback. | Pure trigger test; harness render. |
| 9 | **737 flight deck at the real nose station, full-length cabin**: deck, cabin and eye move forward together; about 30 rows. | The deck sat mid-fuselage, so the eye was 18 m behind the nose and the cabin had only 7 rows. | Fit-in-fuselage, aisle and camera tests; harness renders. |
| 10 | **Environment events in the recorder and landing debrief** (max G, overstress, wing failure, ice, windshear, hydroplaning). | Events are toasts that vanish. | Recorder/debrief tests. |
| 11 | **Ice annunciation + anti-ice control**: ICE caution in the GA alert list, ANTI-ICE ON/OFF (FIKI types), the jets' auto protection shown. | The pilot cannot see or act on airframe icing. | Annunciation tests. |
| 12 | **Convective + mountain-wave turbulence**: TS/CB raises turbulence to severe near storms; strong wind over high terrain adds lee rotor. | Turbulence today depends only on the reported gust spread. | Pure intensity tests. |
| 13 | **ATC wake caution**: the tower adds "caution wake turbulence" when you land behind heavier traffic. | Ties the wake model to the ATC realism. | ATC phrase test. |
| 14 | **Realism panel**: UI toggles for thermals, wake, icing, damage and contamination. | The physics mods are reachable only by typed commands. | Panel test. |
| 15 | **Save/load environment state** (ice, overstress, failure). | A reload today repairs ice and broken wings. | Snapshot round-trip test. |
| 16 | **Frame profiler** (`__ohProfile` + PERF overlay): per-subsystem milliseconds; fix the top CPU hot spot found. | Optimise against measurements, not guesses. | Profiler test; before/after numbers. |
| 17 | **AI traffic and scenery culling**: distance culling and LOD for traffic meshes. | Draw calls grow with traffic. | Draw counts before/after. |
| 18 | **In-app command help** (`HELP`): every typed command with a one-line description. | Many commands are undiscoverable. | Test that every handled command is listed. |
| 19 | **Docs**: README "Weather & physics" section and PROGRESS entries for all of the above. | Users and contributors need to know what exists. | Review. |
| 20 | **Final regression pass**: full tests, build, smoke test, and visual checks on the C172, 737 and a glider in clear, rain, snow and storm. | Ship confidence. | All green; screenshots reviewed. |

## Status

- [ ] 1 · [ ] 2 · [ ] 3 · [ ] 4 · [ ] 5 · [ ] 6 · [ ] 7 · [ ] 8 · [ ] 9 · [ ] 10
- [ ] 11 · [ ] 12 · [ ] 13 · [ ] 14 · [ ] 15 · [ ] 16 · [ ] 17 · [ ] 18 · [ ] 19 · [ ] 20
