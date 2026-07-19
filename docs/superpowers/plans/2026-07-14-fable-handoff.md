# Handoff → next Fable session: finish flight assist, then Phases 3–9

**Read first:** `2026-07-13-sonnet-handoff-phases-2-9.md` (active plan: global
constraints, escalation protocol, __oh* verification hooks) and
`../FLIGHT-SIM-MASTER-PROMPT.md` (spec of record). `PROGRESS.md` has evidence
through Phase 2 ✅ (committed `07c4125` + 3 small commits after: daytime
default, orbit camera/parking brake/sloped runways, flight assist).

## Immediate task: verify flight assist (committed but NOT browser-verified)

Last commit added assist (X toggles, default on) in `src/main.ts`
`pollControls`: expo curve, wing leveler / pitch damper / auto-rudder when
axes untouched (airborne), and a ground yaw damper for the takeoff roll.
The ground damper was added AFTER the only browser test (which crashed from
a too-brief scripted rotation + ground swerve) and is **unverified**.

Verify (one javascript_exec, __ohStep loop per the methodology notes in the
Sonnet handoff — never wall-clock waits, never split flights across calls):
1. Spawn KHAF 30. Full throttle via dispatched KeyW keydown. Hold ArrowDown
   from 57 KIAS for ~1.5 s sim (12 × 0.125 steps), then release everything.
2. PASS = tracks runway heading ±10° during the roll, lifts off, climbs
   hands-off ≥ 60 s without exceeding ±15° bank (assist leveler) and without
   crash. FAIL → tune gains in pollControls (ground: −5·rates.z; leveler:
   −0.9·rollRad −0.35·p) — 2 attempts max, then escalate per protocol.
3. Also confirm X toggles it off (hands-off torque spiral returns — that's
   the honest baseline behavior, keep it).
4. Update PROGRESS.md (assist = deviation from §17 "assists default OFF" —
   record it; move default to OFF when the Phase 8 settings UI lands),
   commit.

## Then: continue the active plan at Task 2 (Phase 3 — cockpit & systems)

Work Phases 3–9 exactly per `2026-07-13-sonnet-handoff-phases-2-9.md` §Task
2–8 and the master prompt §24: plan doc → TDD systems → G1000 PFD/MFD →
3D cockpit → acceptance (cold-and-dark per real checklist) → PROGRESS →
commit. One phase per session. `npm run validate` must stay 10/10 — physics
tuning knobs live ONLY in `src/sim/aircraft/c172s.ts` + prop tables in
`propulsion.ts`.

## Environment quick-start

- `export PATH="$HOME/.local/node/bin:$PATH"` (Node 24 is user-local).
- Dev server: preview name `openhorizon` (launch.json) or
  `npm run dev` → http://localhost:5173 (Vite serves /proxy + /api too).
- Automation suspends rAF: drive via `__ohStep/__ohData/__ohSpawn/__ohCtl/
  __ohHold/__ohWind/__ohTime`; `__ohCtl` persists until `__ohCtl(null)` —
  release it before ending a call or the watchdog CFITs the plane.
- Known open items: water is solid ground; KTRK-area terrain spike artifact;
  airport buildings/PAPI deferred; NLCD texturing due in Phase 5.
