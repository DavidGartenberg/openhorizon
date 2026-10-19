### Spec Compliance

- ✅ Reviewed software fixes comply with the scoped requirements. Both prior Important findings are resolved in `tca-review-fixed.diff`; the additional native Gamepad capture fix addresses the actual browser failure without weakening deliberate-movement capture.
- ⚠️ Physical calibration and full acceptance remain open. Root's latest deliberate user reports establish both-IDLE raw approximately +.481/+.485 and LEFT ENG1 TOGA raw axis0=-1 with right axis1 approximately +.485. Earlier raw -1 observations were not reliable evidence of physical IDLE. Historical presets remain unchanged; user-specific signed calibration must establish the correct current setup before claiming usable full-travel thrust/reverse.
- ⚠️ Add-on functions, reverse lifts, reload/reconnect with saved calibration, browser PTT/microphone behavior, all 123 aircraft and final integration acceptance remain root-owned checks. Scoped review does not establish certification, perfection or any numeric performance gain.

### Strengths / Resolved Findings

- **Legacy alias ownership fixed.** `src/sim/gamepad-map.ts:256` separates active aliases from retained `unverifiedBtnKeys`; `:262` activates only previously identified slots or exact known preset aliases. `readAlias` at `:234` explicitly rejects inactive keys. Parser validation at `:205` preserves the quarantined table through save/reload. Unknown custom actions therefore cannot acquire a newly discovered device merely from its index. Tests cover the original index16/KeyW failure, persistence, known preset migration and identity-backed custom reconnect (`tests/tca-controller.test.ts:82`, `:95`). Captured buttons clear matching conflicts (`src/ui/controller-panel.ts:52`) and the panel exposes pending recapture (`:64`).
- **Panel overlap fixed structurally.** Both constructors call the same dock (`src/ui/controller-panel.ts:35`, `src/ui/loading-panel.ts:98`). `src/ui/flight-panel-dock.ts:9` provides a viewport-bounded scrolling column; `:16` overrides old fixed positioning and disables child shrinking, so opening either panel moves its sibling in normal flow. The structural test checks shared parent, column layout and relative nonsinking children (`tests/flight-panel-dock.test.ts:9`). Real collapsed/expanded/narrow rendering remains a browser acceptance check, not a claim established by the synthetic DOM test.
- **Native capture baseline fixed.** `src/input/controller-capture.ts:8` explicitly copies id/index/connected, axis values and each button's pressed property, reading WebIDL getters rather than relying on enumerable own properties. The snapshot remains independent of subsequent hardware changes. The prototype-getter regression at `tests/tca-controller.test.ts:104` covers axis motion and the initially-held button release/press lifecycle. Existing same-device/baseline guards remain intact; newly connected devices still require Retry.
- **Evidence reporting corrected.** Updated `tca-report.md` separates actual raw readings from user-confirmed physical lever positions, records the contradiction in the earlier IDLE assumption, and leaves named-lever calibration unchecked. The early 100% transient remains unreproduced and unexplained rather than being claimed fixed.

### Issues

#### Critical (Must Fix)

- None found in the reviewed fixes.

#### Important (Should Fix)

- None outstanding in the reviewed fixes. Physical calibration is still an acceptance dependency, not completed by this verdict.

#### Minor (Nice to Have)

- `src/sim/gamepad-map.ts` still contains historical comments describing default polarity as actual measured IDLE/TOGA. Once root finishes current physical calibration, clarify those comments' historical/profile scope so they cannot override the newer named-position evidence. No default inversion is requested by this review.

### Assessment

**Task quality:** Approved for the reviewed software fixes; physical/browser acceptance remains pending.

**Reasoning:** The fixes repair the ownership and layout defects with narrow changes, and the native Gamepad regression now models the actual accessor behavior that synthetic plain objects missed. No further blocker was found in the changed contracts.

**Checks:** Reviewed only fix hunks and their mapping/parser/runtime, UI mounting and capture cross-contracts in the supplied frozen snapshot, plus the updated implementer report. No suite reruns, browser operations, Git commands or production changes. Implementer reports post-fix 20/20 passing tests in 4 files and fresh TypeScript exit0; these are reported evidence, not independently rerun results. Prior whole-suite/build evidence predates these fixes. Wrote this review report only.
