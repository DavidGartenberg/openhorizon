# Handoff: Sonnet 5 → Fable, Phase 2 verification (Task 1)

**Context:** Working from `2026-07-13-sonnet-handoff-phases-2-9.md`, Task 1
("Finish Phase 2 — verification + commit"). Phase 2 code was ~95% built and
uncommitted. Instructed to follow the plan's Global Constraints and
escalation protocol exactly, one phase per session, and to stop and hand
back a FABLE ESCALATION block instead of pushing through a stop condition.
This doc replaces two escalation blocks raised mid-session — read this
instead of re-deriving from the transcript.

**Status: STOPPED, uncommitted.** Do not commit yet — there is a live,
unresolved crash bug (see below). Two real bugs got found and fixed along
the way; a third, more serious one is open.

## What's fixed and verified (keep these)

All three are small, targeted diffs, not touched physics tuning or the
aero/propulsion model. `npx tsc --noEmit` clean and `npm test` 38/38 green
after each.

1. **Spawn elevation didn't account for runway slope** (`src/main.ts`,
   `spawnAtAirport`, the `!onFinal` branch). It used the runway
   *threshold's* raw elevation (`thr.e * FT`) as the spawn altitude, but
   places the aircraft 120 m down the runway centerline from the
   threshold. KHAF runway 12/30 has a real ~0.46% grade (36 ft at the "30"
   threshold vs 59 ft at "12" over 5000 ft) — 120 m in, the true elevation
   is ~1.8 ft higher than the threshold value used, which the gear model
   read as ~0.6 m of static penetration, tripping the crash guard
   (`maxCompressionM > 0.45`) on an aircraft sitting still. Fixed by
   querying the flattened elevation *at the actual spawn point*
   (`aircraft.groundElevAt(spawnN, spawnE)`) instead of the threshold's.
   Verified: KHAF and KTRK spawns both hold a stable altitude across 9.5
   sim-seconds of deterministic `__ohStep` ticks (KHAF ~41.9 ft, KTRK
   ~5901 ft — both match the plan's Step 2/3 targets).

2. **`spawnAtAirport()` never reset `aircraft.crashed`.** Only the manual
   `KeyR` reset handler did. Respawning via search after any crash left
   the sim permanently frozen (`step()` returns immediately while
   `crashed`). Added `aircraft.crashed = false` at the top of
   `spawnAtAirport()`.

3. **NaN ground query could reach the 6-DOF integrator** (`src/sim/gear.ts`,
   `computeGear`). See bug #2 below for how this arises. Added
   `if (!Number.isFinite(groundZ)) continue` right after the per-wheel
   ground-elevation query, before it's used in the penetration/force math.
   This treats a bad elevation sample as "no contact this wheel" instead
   of propagating NaN into `force`/`moment` and from there into
   `posNed`/`velBody`/`rates`/`quat`. **This alone did not fully fix the
   open bug below** — something is still crashing the KSFO 3 nm final
   spawn even with this guard in place; see next section.

## Open bug — STOPPED HERE, needs Fable

**Symptom:** `__ohSpawn('KSFO 28R final')` then one `__ohStep` →
`crashed:true` almost immediately, on every attempt (fresh reload each
time, so not a stale-flag artifact — bug #2 above is already fixed and
confirmed not the cause here). `__ohData()` afterward shows `agl:null`
(NaN) and lat/lon pinned at KSFO's ARP (37.61981, -122.37482) rather than
the actual 3 nm final point — consistent with the `!finite` crash branch's
reset (`v3set(this.posNed, 0, 0, this.posNed.z || 0)`, which zeroes x/y).

**What's confirmed:**
- A direct check at the KSFO 3 nm final spawn coordinates (lat 37.5902,
  lon -122.3015 — open bay-area terrain, not within any runway's flatten
  radius) showed `tiles.elevationAt(...)` returning NaN and
  `aircraft.groundElevAt(...)` therefore also NaN at that exact spot. This
  is the same intermittent terrain-tile-decode bug described below.
- Adding the `gear.ts` NaN guard (fix #3 above) did **not** stop the crash.
  Tested with a clean per-trial reload (not the earlier contaminated
  multi-trial-in-one-script test that was invalidated by bug #2).
- The last data point before I was asked to stop: comparing `__ohData()`
  immediately after `__ohSpawn` vs. one `__ohStep(1/120)` later — both
  reads showed `crashed` flip from `false`→`true` within that single tick,
  `agl` already `null` even in the "before" read (i.e. before any physics
  step ran), `alt` frozen at ~41.9 ft (a stale value — see hypothesis).

**My working hypothesis, unconfirmed:** the `onFinal` spawn branch in
`spawnAtAirport()` (the 3 nm final path, distinct from the `!onFinal`
path fixed in #1) computes a trim solution via `trim({tasMs, altM,
massKg, flapsDeg:10, gammaRad:-0.052})` and applies it with
`aircraft.applyTrimState(...)`, then separately overwrites
`posNed.x`/`posNed.y` (but not `.z`, which `applyTrimState` should have
set from `altM`). I had **not yet** confirmed whether:
  (a) the NaN is still coming from the terrain/`groundElevAt` path via
      some route the gear.ts guard doesn't cover (e.g. a second ground
      query elsewhere, or the guard not actually being hit because
      `groundZAt` isn't wired the way I assumed for this code path), or
  (b) `trim()`/`applyTrimState()` itself produces a non-finite result for
      this specific altitude/speed/flap/gamma combination, unrelated to
      terrain entirely, or
  (c) something in how `posNed.x/y` get overwritten *after*
      `applyTrimState` (but not `.z`) leaves an inconsistent state that
      then blows up on the first integration step.
  I was about to add a pre-step diagnostic (dump `t` from `trim(...)`,
  and `aircraft.posNed`/`velBody`/`quat` right after `applyTrimState`,
  before any `step()` call) when asked to stop and hand off instead.

**Suggested next step for Fable:** confirm which of (a)/(b)/(c) it is by
checking `trim()`'s return value and `aircraft`'s state immediately after
`applyTrimState()` in the `onFinal` branch, *before* the first `step()`
call — if it's already non-finite there, the bug is in trim/applyTrimState,
not gear/terrain, and criterion 3 of the escalation protocol
(NaN/instability requiring a 6-DOF-core change) likely applies squarely
there rather than to terrain-tile flakiness.

## Separate, still-live issue: intermittent terrain-tile NaN decode

Independent of the above (but the likely trigger for it away from
airports): `src/world/terrain-worker.ts` occasionally decodes a tile to
all-NaN heights. Confirmed:
- Main-thread decode (fetch → blob → `createImageBitmap` →
  `OffscreenCanvas` → `drawImage` → `getImageData`) of the exact same tile
  PNG is always clean (0 NaN).
- The identical sequence run inside a Worker sometimes returns valid pixel
  data and sometimes doesn't, on byte-identical requests, with no code
  difference between runs I could find.
- Two fix attempts in `src/world/tiles.ts` / `terrain-worker.ts`
  (skip-and-mark-failed; then bounded retry + explicit
  `bitmap.width/height === 0` guard) were tried and **reverted** — the
  second one regressed tile loading from ~182 ready tiles to 0 ready. Both
  attempts are fully reverted; `tiles.ts` and `terrain-worker.ts` are back
  to their original Phase-2 state (verify with
  `grep -n OH_NAN src/world/*.ts` → no matches).
- Best hypothesis: an intermittent `createImageBitmap`/`OffscreenCanvas`/
  `getImageData` limitation specific to Worker contexts in this
  preview/automation browser sandbox — the same category of issue already
  documented in the plan's Global Constraints (rAF suspension under
  automation). Not fully ruled out as a genuine app bug; worth re-testing
  on a real desktop browser before spending more time on it.
- The `gear.ts` NaN guard (fix #3) protects the *gear/ground-contact* path
  from this specific failure mode. It does **not** fix the tile decode
  itself (visual gaps in terrain where a tile failed) and, per the open
  bug above, does not fully explain the KSFO final-approach crash either.

## Files touched (current diff, all uncommitted)

- `src/main.ts` — spawn-elevation fix (#1), crashed-reset fix (#2), plus
  the pre-existing (already-built) Phase 2 spawn/search/world-wiring code
  this plan describes as "~95% built."
- `src/sim/gear.ts` — NaN-guard fix (#3).
- `src/world/tiles.ts`, `src/world/terrain-worker.ts` — **no net change**;
  two fix attempts made and fully reverted, confirmed via diff.
- Everything else in `git status` (`src/input/input.ts`,
  `src/render/chase-camera.ts`, deleted `src/render/ground.ts`,
  `src/sim/aircraft.ts`, `src/ui/hud.ts`, `vite.config.ts`, and all
  untracked files under `src/world/`, `server/`, `docs/plans/phase-2.md`,
  `tests/geo.test.ts`, `src/math/geo.ts`) is the pre-existing Phase 2 work
  from before this session — untouched by me beyond what's listed above.

## Plan progress (Task 1 steps, from the phases-2-9 plan)

- [x] Step 1: `tsc --noEmit` + `npm test` → 38/38.
- [x] Step 2: KHAF spawn — verified stable via `__ohStep` (not wall-clock
      waits — see methodology note below). Crash bug found + fixed.
- [x] Step 3: KTRK mountain elevation — verified ~5901 ft, stable.
- [ ] Step 4: KSFO dusk landing — **blocked on the open bug above**.
- [ ] Step 5: KHAF rebase check — not started.
- [ ] Step 6: FPS reading — not started.
- [ ] Step 7: PROGRESS.md update — not started (this doc + the eventual
      fix should feed its Deviations section: the terrain-tile NaN issue
      at minimum needs an honest entry per the master prompt's honesty
      rules, whichever way it's resolved).
- [ ] Step 8: commit — **do not commit until Step 4's crash is resolved**;
      right now `npm test` is green but the sim can still crash on a
      normal approach spawn, which fails the master prompt's own bar
      ("never silently degrade a requirement").

## Methodology note (worth keeping)

Wall-clock `computer wait Ns` + reading `__ohData()` afterward is
unreliable for verification in this environment — it lets the `setInterval`
watchdog (the rAF-suspension workaround already documented in Global
Constraints) drive physics uncontrolled between checks, which produced at
least one false "bug" this session (KTRK altitude appearing to decay to
~42 ft over an 8s wall-clock wait — fully absent when the identical
sim-time span was driven via a tight `__ohStep` loop instead, which held a
rock-stable 5901 ft). Global Constraints already say "never rely on
wall-clock waits" — this session is a concrete example of why. Prefer:
spawn → tight loop of `__ohStep(0.5)` calls within one `javascript_exec`,
reading `__ohData()`/`__ohDebug()`-style state between steps, only using
real wall-clock waits to let genuinely async work (network tile fetches)
happen in the background.
