# Stage 3 — TCAS/GPWS logic and speech

Read global constraints in implementation.md. Own src/sim/tcas.ts, taws.ts, a
focused speech controller, safety-related main.ts integration and focused tests.
Preserve preceding graphics/airport changes. User wants the systems to say correct
things at correct times. Improve simulation fidelity without claiming certified
TCAS/EGPWS or inventing aircraft-specific equipment that the roster doesn't model.

Fix observed defects with scenario tests first:
- main forces taOnly=true for every aircraft. Select TA/RA for appropriate jet/
  transport profiles and TA-only for GA; inspect roster types and document policy.
- TCAS worst level depends on iteration order (PROX masks later TA); RA sense
  takes first intruder. Make threats/order deterministic and consider encounter
  geometry rather than range/closure alone (crossing safely misses must not RA).
- CLEAR OF CONFLICT only after removal of RA, never after TA-only encounters.
- Ground/low altitude inhibits; clear state on respawn/change flight. Honor
  descending RA inhibitions near ground and prevent stale repeated/cancelled text.
- TAWS parked-away-from-airport false FLTA; use ground and motion context.
- Short-final callout backlog from spawning below gates: actual descending gate
  crossings, no past-gate recitation, one most relevant crossing for large steps,
  rearm on go-around and reset on spawn. Callouts distinct from caution lights.
- Current nearRunwayFinal merely means within4nm of airport. Determine actual
  runway approach corridor/alignment so terrain warnings survive heading away.
- Fix flight-phase/state persistence, config warnings, repeat cadence and real
  warning/caution escalation. Keep approximated envelope limitations documented.

Existing main updateSafety runs2Hz, TCAS speech before TAWS speech; second cancels
first. gatedSpeak cancels every safety utterance, radio has unbounded queue,
copilot drops if busy. Voices selected across unrelated languages. Replace with
coherent arbitration, English voice selection/fallback and lifecycle-safe tokens.
GPWS active alerts inhibit TCAS speech per FAA; radio/callouts must not interrupt
terrain warnings. Keep HUD warnings current even if speech inhibited. Avoid stale
radio/alert delivery after respawn, mute, cancellation or changed hazard. Repeats
must be based on persistent active hazards, not piling utterances in a queue.
Expose integration API for next stage PTT to mute/suspend radio while listening
without silencing active critical safety warnings. Existing typed ATC must work.

Primary reference already read:
https://www.faa.gov/documentlibrary/media/advisory_circular/tcas%20ii%20v7.1%20intro%20booklet.pdf
pp34–35: TCAS aural inhibited below500±100ft AGL; GPWS and windshear have priority;
GPWS active inhibits TCAS aural. Table4 lists v7.1 phrases (Traffic,Traffic;
Climb,Climb; Descend,Descend; Level Off,Level Off; Clear of Conflict on RA removal).
Do not copy >25 verbatim words from a source into report prose; implementing
standard short callout constants is appropriate. Browse primary references for
uncertain thresholds; no full certification algorithm implied.

Optional authentic local audio exists at X-Plane12/Resources/sounds/alert: 50ft,
100ft,10ft,1000ft,300ft,glideslope,sink,pull,200ft,te_climb,te_descend,tcas,30ft,
40ft,20ft,500ft,400ft,mini,wshr.wav. Do NOT map ambiguous filenames without
verifying audible contents. If used, only an allowlisted read-only server route
for these files, no copying proprietary assets; browser English TTS fallback.
Prefer finishing robust speech logic over extra audio infrastructure.

Run TCAS/TAWS/audio focused tests and tsc; report safety-report.md with evidence,
source links, decisions and remaining approximations. Root browser only. No commits.

Further FAA source check: printed p29 (PDF index29) says descend RA inhibited
below1100ftAGL, increase-descent below1450, allRA below1000±100. An existing
descend RA passing1100 becomes do-not-climb; v7.1 corrective vertical-speed-limit
commands use level-off. Current raSense onlyCLIMB/DESCEND cannot represent that:
extend output/UI coherently where needed instead of issuing unsafe opposite-sense
RA merely to satisfy no-descend. Preserve actual RA limitations transparently.
