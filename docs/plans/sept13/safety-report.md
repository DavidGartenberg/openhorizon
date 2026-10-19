# Stage 3 safety implementation

Implemented simulator advisory logic and actual speech arbitration, preserving the
preceding aircraft and airport edits. This is a simplified training/game model,
not certified TCAS II, GPWS or EGPWS equipment.

## TCAS

- Main selects TA/RA for jet-powered profiles or aircraft with modeled MTOW above
  5,700 kg; lighter non-jets remain TA-only. This deliberately uses available
  aircraft parameters across the full roster, not an invented installed-equipment
  inventory. It is a simulator profile policy (including vintage/military types),
  not a claim those individual aircraft carry TCAS II.
- Threat ranking no longer depends on array order. Horizontal closest-approach
  miss distance must enter the sensitivity-level horizontal envelope; safe crossing
  misses no longer trigger an RA merely because their radial closure is high.
- Multi-intruder sense maximizes the minimum predicted vertical separation across
  active RA threats. This remains uncoordinated linear extrapolation, without
  transponder coordination, RA strengthening/reversal logic, acceleration modeling
  or a full certified vertical-speed-limit envelope.
- All RA inhibited below 1,000 ft AGL. Descending guidance below 1,100 ft becomes
  LEVEL_OFF rather than an arbitrary opposite-sense climb. No increase-descent
  command is modeled, so none can occur below the FAA 1,450-ft inhibit.
- TCAS aural output inhibited below 500 ft AGL; HUD advisory text remains separate.
  Ground input suppresses alerts. CLEAR is emitted only on RA removal, including
  when a TA remains, never after a TA-only encounter. Reset removes retained state.

## TAWS

- Ground/stationary near-ground context prevents parked FLTA warnings. Main feeds
  onGround explicitly. Terrain lookahead requires airborne moving flight.
- Runway inhibition uses both runway ends, incoming track alignment, cross-track
  corridor and threshold-relative height; proximity to an airport alone cannot
  silence terrain alerts while flying away or beside the runway.
- Callouts require a prior altitude sample and actual descending gate crossing.
  Multiple crossed gates produce only the lowest relevant callout. Initial spawn
  below a gate produces none. Climb above a gate plus margin rearms it; respawn
  resets all gates. Callouts have NONE alert level, not a caution lamp.
- Configuration checks suppress premature landing-config warnings during takeoff,
  retain low-flap protection on jet final, and prioritize gear over flaps when both
  are unsafe. Existing sink/terrain escalation and glideslope tests remain passing.
- Main only starts the takeoff timer on an observed ground-to-air transition,
  rather than treating an airborne spawn as a new takeoff. Ground and respawn
  clear takeoff history. Mode 3 remains takeoff altitude-loss, not a modeled
  separate go-around protection envelope.

## Speech

One SafetySpeechController owns browser synthesis. Main evaluates both computers
before speaking. Any active GPWS caution/warning inhibits TCAS speech while both
HUD warnings stay current. Warnings preempt lower-priority speech. Current hazards
repeat at bounded 5-second (warning/RA) or 8-second (caution/TA) intervals only when
synthesis is idle; no repeating hazard queue exists. Cleared/changed hazards cancel
obsolete speech. Clearance uses a one-shot channel, so the next 2-Hz update does
not truncate it, including with residual TA; new terrain warnings or RAs can
preempt it. Height callouts preempt radio.

Radio uses at most two waiting messages with an 8-second expiry. Hazards, mute,
respawn and listening suspension discard pending radio. Completion/error callbacks
have generation tokens so cancelled speech cannot release ownership of a newer
utterance. English voices alone are selected, with en-US language fallback when
no English voice is enumerated. Typed ATC still feeds the original transcript and
transmission parser, then this radio path. Radio squelch occurs on actual start.

PTT integration: main `setRadioListening(boolean)` calls
`SafetySpeechController.setRadioSuspended(boolean)`; debug hook
`__ohSetRadioListening` exposes it for browser verification. This suspension affects
radio only. The controller also exposes reset and setMuted. Main ties Q/engine
mute to speech mute on the safety tick. A dropped moment-sensitive callout is not
replayed later. Actual speech availability/pronunciation still depends on browser,
OS installed voices and user audio settings. No proprietary audio was copied.

## Evidence

Test-first: eight initial behavioral regressions failed (rank ordering, crossing
miss, false clearance, low-altitude descent, multi-threat sense, initial callout
backlog, skipped gates and parked terrain); these passed after implementation.
Additional observed red-to-green regressions cover gear priority, separate HUD
text, radio interruption, clearance lifetime and clearance with remaining TA.
New-module contract tests initially failed import before controller/corridor files
existed. Browser synth is represented by a deterministic driver for lifecycle tests.

Focused command:
`npx vitest run tests/safety-regressions.test.ts tests/safety-speech.test.ts tests/safety-approach.test.ts tests/tcas.test.ts tests/tcas-multitrack.test.ts tests/taws.test.ts --maxWorkers=1 --fileParallelism=false`

Final focused result: 6 files passed, 44 tests passed (21.94 seconds), including
13 safety scenario regressions and 7 speech arbitration scenarios. TypeScript command: `npx tsc --noEmit`.
An intermediate tsc caught an unused squelch function after rewiring; the actual
radio-start driver now uses it. Root owns actual browser playback and its harness
in tests/browser/safety-studio.{html,ts}; no browser verification claimed here.

## Reference and approximations

FAA, [Introduction to TCAS II Version 7.1](https://www.faa.gov/documentlibrary/media/advisory_circular/tcas%20ii%20v7.1%20intro%20booklet.pdf),
printed page 29 (low-altitude RA inhibits) and pages 34–35 (aural priority and
standard phrases), supplied/read in the stage brief. Nominal thresholds are used;
radio-altimeter tolerance bands and aircraft-specific equipment variations are not
modeled. Existing simplified TAWS curves, runway-inhibit geometry, finite terrain
samples and current-speed straight-line predictions remain approximations. There
is no windshear sensor/model, so no invented windshear announcement is added.

Final TypeScript verification: `npx tsc --noEmit` exited 0, including the browser
safety studio. Its intermediate NodeList iteration compatibility error was fixed
with Array.from; no production type errors remain. Commands ran with one Vitest
worker and no file parallelism. Host memory pressure made process wall time much
longer than the test runner's measured test execution.

## Independent-review corrections

Verified both important findings in safety-review.md and fixed them with observed
red-to-green regressions:

- The RA score formerly subtracted a candidate target rate from separation already
  projected using current ownship VS. It now starts with current vertical
  separation and projects the intruder's absolute VS against each candidate
  ownship target rate over the same horizon. A 15-second encounter with ownship
  climbing 3,000 fpm and a stationary intruder 100 ft above failed with CLIMB
  before the fix and now selects DESCEND; the mirrored descent/below-intruder
  case selects CLIMB. This fixes candidate arithmetic without claiming that the
  simplified instantaneous-rate response models certified RA performance.
- Airborne loadSnapshot formerly skipped the new spawn reset. The shared
  resetFlightSafety function now runs for both airport spawn and airborne saved
  flight restore. It clears TCAS/TAWS state, speech and queued radio, takeoff phase,
  HUD/debug warnings, copilot history and pending ATC timers. The integration test
  executes the actual main restore/reset function declarations, extracted with
  the TypeScript AST, against real safety computers and a deterministic speech
  driver while stubbing unrelated terrain/render/trim dependencies. It first
  reproduced a spurious CLEAR after restore; after the fix it verifies no false
  clearance/crossing, no old queued radio or stale callback ownership, and reset
  phase state. Updated the obsolete TAWS airport-proximity comment as requested.

Post-review focused command adds tests/safety-snapshot.test.ts to the command above.
Result: **7 files passed, 46 tests passed**, 1.35 seconds, with --maxWorkers=1 and
--fileParallelism=false. The two new regression tests were observed failing before
implementation, then passing independently and in the covering run.
Post-review TypeScript verification: `npx tsc --noEmit` exited 0.

## Root browser playback follow-up

Stable-code browser test exposed native SpeechSynthesis stalling before onstart
or onend despite180enumerated voices and pausedfalse. Ordinary original6.5s PCM
fixture emitted playing+ended. Added original20-phrase warning WAVs and production
BrowserSpeechDriver; see safety-playback-report.md. Root then observed each FIFTY,
FORTY,THIRTY,TWENTY,TEN start+completion with no failures in real browser; TCAS
DESCEND and subsequent CLEAR OF CONFLICT each started+completed. This verifies
actual media lifecycle, not physical speaker volume or certified annunciations.
