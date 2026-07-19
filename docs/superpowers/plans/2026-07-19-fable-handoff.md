# Handoff → next Fable session: autopilot APR/GS bug (round 4), then close Phase 4

**Read first:** `2026-07-13-sonnet-handoff-phases-2-9.md` (active plan: Global
Constraints, escalation protocol, `__oh*` verification hooks) and
`../FLIGHT-SIM-MASTER-PROMPT.md` (spec of record). For the autopilot bug
specifically, read `docs/plans/phase-4-autopilot-oscillation-fix-report.md`
in full — it has three rounds of history you should not re-derive — and
`docs/plans/phase-4-acceptance-report.md` (the original Finding A/B that
started this).

**Do not skip the fix report.** Three rounds of "this looks fixed" have each
turned out to be real-but-incomplete. The pattern that has worked: never
trust your own or a subagent's self-reported test pass at face value for
this file — reproduce independently, and prefer a longer/more realistic
scenario over the existing test suite's assumptions.

## Status

- **Phase 3: done, committed** (`e94539b` and earlier). Not touched this
  session beyond that.
- **Phase 4 Tasks 1–6: done, reviewed, committed.** Radio nav, GPS
  flight-plan, GFC700 autopilot (base build), CIFP procedures, airspace
  data, cockpit wiring. Commits `c825999`..`0d2cfe1` (see `git log
  --oneline` — each task has a `Phase 4 Task N` commit, some with a
  same-numbered `... fix:` follow-up from review).
- **Phase 4 Task 7 (acceptance): BLOCKED.** The coupled-ILS-approach
  acceptance criterion — CDI stays within half-scale continuously down to
  200 ft AGL — is not met. This is the open item. `PROGRESS.md` has **not**
  been updated for Phase 4 (its status table still says "not started") —
  leave it that way until Task 7 actually passes; don't write a Phase 4
  evidence section prematurely.

## The autopilot bug: three rounds, then a fourth root cause found

`src/sim/autopilot.ts`'s NAV/APR/BC lateral tracking law (and, as of this
session's last hour, the coupled GS vertical law too) has been through:

- **Round 1** (commit `c1eeec9`): fixed a derivative-kick-from-moving-setpoint
  bug in the bank-attitude inner loop (confirmed correct, still holds).
  Reworked the NAV/APR outer loop too, but that part only delayed a growing
  oscillation past the test's 150s window — reviewer caught it by extending
  to 300-500s.
- **Round 2** (commit `f00380e`): added a low-pass filter + genuine integral
  term + dynamic cap to the tracking law. Fixed that specific growing-
  oscillation failure mode (confirmed via 1200s runs). But the re-review
  built the first *realistic descending approach* test in this investigation
  (`APR`+`GS`, armed→captured, real altitude loss — every prior test froze
  altitude) and found **40°, 60°, 90° initial heading/course errors all fail**
  (deviation 0.64–1.00) in the first 10–90s after capture. 20° passes.
- **Round 3** (commit `ebe7fe7`, this session): investigated the capture-phase
  transient. Found and fixed a real bug (`navTrackFilteredDeviation` wasn't
  seeded to the actual deviation at capture, so the P term under-reacted for
  ~15-25s post-capture) — kept, it's a genuine correctness fix and doesn't
  regress anything — **but direct re-verification showed it doesn't close the
  gap**: 40°/60°/90° still fail by nearly the same margins.

### The real finding (not yet acted on — this is round 4's job)

While checking whether "cap intercept angles to 45°" (the user's initial
instruction after round 3) would be a legitimate way to close Phase 4, I ran
the actual realistic GS-descent scenario across an angle sweep and then a
**0° initial-error control case** — aircraft starts flying exactly the
localizer course, zero intercept angle, the best possible case. **It still
fails**, deviation growing to full scale by t≈180s well before reaching
200 ft AGL:

```
t=0s   loc=0.017   dist=11111m
t=100s loc=0.060   dist=5742m
t=140s loc=0.225   dist=3460m
t=160s loc=-0.587  dist=2315m   <- already broke half-scale
t=180s loc=1.000   dist=1187m   <- full-scale, well before DH
```

**This means capping intercept angle would not have closed Phase 4** — the
bug is not about intercept angle or capture geometry at all (that was rounds
1–3's frame, and it's now clearly incomplete). It's a **slowly-growing
lateral oscillation that only appears once a real descent is coupled in**
— altitude dropping, IAS/ground speed changing (90→112kt observed over the
descent), which changes `gainScale()`'s output over time. No prior test in
three rounds exercised this because every one of them froze altitude/IAS.
Round 2's own code comment already named a suspect: *"the ~70-100s
lightly-damped mode a bare instantaneous P term rings at"* — the filter
suppresses it in the frozen-altitude case but something about the descent's
changing dynamics likely re-excites it.

**User decision (this session, via AskUserQuestion):** investigate this as
round 4, rather than paper over it with the angle cap or escalate again
first. **This was chosen but not started before the session ended** —
that's exactly where you're picking up.

### Diagnostic harness (recreate this — it was scratch, not committed)

This test does NOT exist in the repo. Rebuilding it is the fastest way to
resume — it exercises the real `Aircraft`, `Autopilot`, and `navaids.ts`
stack together, which is what caught this bug in the first place. Drop this
in `tests/_tmp_gs_sweep.test.ts` (delete when done, or promote a trimmed
version into `tests/autopilot.test.ts` once round 4 actually closes the gap
— no test coupling lateral tracking to a real `GS`-engaged descent exists
in the permanent suite yet, which is exactly the blind spot that let three
rounds look complete):

```ts
import { describe, it } from 'vitest'
import { makeAutopilotState, stepAutopilot, type AutopilotInputs } from '../src/sim/autopilot'
import { Aircraft } from '../src/sim/aircraft'
import { trim } from '../src/sim/trim'
import { kcasFromKias, KT, FT } from '../src/sim/atmosphere'
import { localizerDeflection, glideslopeDeflection, LOC_FULL_SCALE_DEG, GS_FULL_SCALE_DEG, type IlsRef } from '../src/sim/nav/navaids'
import { fromNedMeters, type LatLon } from '../src/math/geo'

const REAL_DT = 1 / 60
const KSFO_28R_THRESHOLD: LatLon = { lat: 37.613, lon: -122.357 }
const KSFO_28R_COURSE_DEG = 298
const KSFO_28R_ILS: IlsRef = {
  threshold: KSFO_28R_THRESHOLD, courseDeg: KSFO_28R_COURSE_DEG,
  thresholdElevFt: 13, gsAntenna: KSFO_28R_THRESHOLD, gsAntennaElevFt: 13,
  gsAngleDeg: 3.0,
}

function baseInputs(overrides: Partial<AutopilotInputs> = {}): AutopilotInputs {
  return {
    iasKt: 90, altitudeFt: 3000, verticalSpeedFpm: 0, headingDeg: 0, pitchDeg: 0, rollDeg: 0,
    masterEnabled: true, lateralMode: 'ROL', verticalMode: 'PIT', headingBugDeg: 0,
    altitudeBugFt: 3000, vsTargetFpm: 0, iasTargetKt: 90, bankCommandDeg: 0, pitchCommandDeg: 0,
    navDeviation: 0, glideslopeDeviation: 0,
    ...overrides,
  }
}

function trimmedRealAircraft(headingDeg: number, distNm: number, altFt: number): Aircraft {
  const ac = new Aircraft()
  const altM = altFt * FT
  const tas = kcasFromKias(90, altM) * KT
  const t = trim({ tasMs: tas, altM, massKg: ac.massKg, flapsDeg: 0, throttle: 0.6 })
  ac.applyTrimState(tas, t.alphaRad, altM, (headingDeg * Math.PI) / 180, t.gammaRad, t.elevatorRad, t.throttle, t.rpm)
  ac.controls.throttle = t.throttle
  const reciprocalRad = ((KSFO_28R_COURSE_DEG + 180) * Math.PI) / 180
  const distM = distNm * 1852
  ac.posNed.x = Math.cos(reciprocalRad) * distM
  ac.posNed.y = Math.sin(reciprocalRad) * distM
  ac.posNed.z = -altM
  return ac
}

function runApproach(headingErrorDeg: number, distNm: number, maxSeconds: number) {
  const glideAglFt = distNm * 6076.12 * Math.tan((3.0 * Math.PI) / 180)
  const startAltFt = KSFO_28R_ILS.thresholdElevFt + glideAglFt
  const startHeadingDeg = (((KSFO_28R_COURSE_DEG - headingErrorDeg) % 360) + 360) % 360
  const ac = trimmedRealAircraft(startHeadingDeg, distNm, startAltFt)
  const ap = makeAutopilotState()
  const inputs = baseInputs({
    lateralMode: 'APR', verticalMode: 'GS', underlyingVerticalMode: 'VS',
    headingBugDeg: KSFO_28R_COURSE_DEG, iasTargetKt: 90, vsTargetFpm: -600,
  })
  const n = Math.round(maxSeconds / REAL_DT)
  let locCapturedAtT = -1, worstLocDev = 0, worstLocDevT = -1, reachedDhAtT = -1
  for (let i = 0; i < n; i++) {
    const aircraftLatLon = fromNedMeters(ac.posNed.x, ac.posNed.y, KSFO_28R_THRESHOLD)
    const locDev = -localizerDeflection(KSFO_28R_ILS, aircraftLatLon) / LOC_FULL_SCALE_DEG
    const gsDev = glideslopeDeflection(KSFO_28R_ILS, aircraftLatLon, ac.data.altitudeFt) / GS_FULL_SCALE_DEG
    inputs.iasKt = ac.data.kias; inputs.altitudeFt = ac.data.altitudeFt
    inputs.verticalSpeedFpm = ac.data.verticalSpeedFpm; inputs.headingDeg = ac.data.headingDeg
    inputs.rollDeg = ac.data.rollDeg; inputs.pitchDeg = ac.data.pitchDeg
    inputs.navDeviation = locDev; inputs.glideslopeDeviation = gsDev
    stepAutopilot(ap, REAL_DT, inputs)
    if (!ap.lateralArmed && locCapturedAtT < 0) locCapturedAtT = i * REAL_DT
    ac.controls.pitch = ap.pitchCmd; ac.controls.roll = ap.rollCmd
    ac.controls.yaw = ap.yawCmd; ac.controls.trim = ap.trimCommand
    ac.step(REAL_DT)
    const t = i * REAL_DT
    const aglFt = ac.data.altitudeFt - KSFO_28R_ILS.thresholdElevFt
    if (locCapturedAtT >= 0 && Math.abs(locDev) > worstLocDev) { worstLocDev = Math.abs(locDev); worstLocDevT = t - locCapturedAtT }
    if (aglFt <= 200) { reachedDhAtT = t; break }
    if (!isFinite(ac.data.altitudeFt) || ac.data.altitudeFt < -100) { reachedDhAtT = -2; break }
  }
  return { locCapturedAtT, worstLocDev, worstLocDevT, reachedDhAtT }
}

describe('gs-descent-sweep', () => {
  it('runs', () => {
    for (const [he, dist] of [[0, 6], [20, 6], [20, 8], [40, 6], [40, 8], [90, 8]] as [number, number][]) {
      const r = runApproach(he, dist, 260)
      console.log(`${he}deg/${dist}nm: captured t=${r.locCapturedAtT.toFixed(1)}s worst|dev|=${r.worstLocDev.toFixed(3)} at +${r.worstLocDevT.toFixed(1)}s  DH/end t=${r.reachedDhAtT.toFixed(1)}s  ${r.worstLocDev <= 0.5 ? 'PASS' : 'FAIL'}`)
    }
  })
})
```

For finer diagnosis (this is how the 0° case above was found), add a
periodic `console.log` of `alt`, `agl`, `distM = Math.hypot(ac.posNed.x,
ac.posNed.y)`, `groundSpeedKt`, `locDev`, `gsDev` every ~20s inside the loop
— watching how `locDev` grows as `distM` shrinks is what revealed this is a
range-dependent effect (full-scale angular width shrinks with range, so a
residual absolute cross-track error that isn't actually damping to ~zero
gets amplified into a growing fraction as the aircraft gets close).

### A hypothesis to check first, before any new tuning

Don't retune P/I/filter gains again — three rounds of that have each fixed
one real thing and left another. Instead, check whether the tracking law's
absolute cross-track error (not just the fraction fed to it) is actually
converging toward zero as the descent progresses, or just oscillating at
some roughly-constant *meters* magnitude that only *looks* fine far out
because full-scale width is wide there. If it's the latter, the bug is
that closing the loop purely on the fractional/normalized deviation
(`navDeviation`, already divided by a range-dependent full-scale angle) can
still leave a persistent absolute-position error that the fraction hides at
long range and reveals at short range — the fix would need to check whether
gain scheduling (`gainScale()`, keyed on IAS) or some other term is coupling
in a way that increases effective loop gain error as speed changes during
the descent, not fix the fraction-domain math itself which round 2 already
made convergent in isolation.

## Escalation discipline for round 4

This is now a bug that has survived multiple fix rounds under two different
framings (capture-phase transient, then this coupled-descent oscillation).
If round 4 also produces a fix that passes its own tests but you have any
doubt it's actually closed the gap, don't self-certify — get an independent
review (a fresh subagent with no stake in the fix, instructed explicitly to
reproduce rather than trust the report) before calling Task 7 done, exactly
as this session did for rounds 1–3. If round 4 also fails to close it,
that's a real stop condition (protocol: same bug survives 2+ distinct fix
attempts, and this would be 4) — raise a FABLE ESCALATION rather than a
round 5.

## Environment quick-start

- `export PATH="$HOME/.local/node/bin:$PATH"` — Node 24 is user-local, not
  on the default shell PATH in a fresh sandboxed shell.
- Run tests directly via the binary if `npx`/`npm` aren't resolving:
  `./node_modules/.bin/vitest run tests/autopilot.test.ts`.
- Dev server: preview name `openhorizon` (launch.json) or `npm run dev` →
  http://localhost:5173.
- Automation suspends `requestAnimationFrame`; drive via `__ohStep/__ohData/
  __ohCtl/...` per the phases-2-9 plan's methodology note — never wall-clock
  waits for anything involving sim time.

## Files touched this session (all committed)

- `src/sim/autopilot.ts` — rounds 1–3 (see fix report for line-level detail
  each round touched).
- `tests/autopilot.test.ts` — grew 25→37 tests across rounds 1–2; round 3
  added none (the fix didn't hold up, see report) — **still has the blind
  spot**: no test in this file couples lateral tracking to a real `GS`-
  engaged descent. That gap is what let three rounds look complete.
- `docs/plans/phase-4-autopilot-oscillation-fix-report.md` — full history,
  rounds 1–3, written honestly including residual limitations. Read this
  before touching the code.
- Phase 4 Tasks 1–6 source files (`src/sim/nav/*`, `src/cockpit/*`,
  `src/render/cockpit*`, `server/parse.mjs`, `server/handlers.mjs`,
  `src/main.ts`) — all done, reviewed, committed; not part of the open bug.
