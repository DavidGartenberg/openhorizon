# Session documentation audit plan

**Goal:** Make new sessions productive from repository evidence without relying
on chat history or stale phase handoffs. Documentation-only; preserve the current
checkout and do not open the simulator browser during the audit.

**Approach:** Inspect source/configuration, reconcile existing reports, record
fresh automated results, and provide a short entry point with deeper references.
No flight behavior changes, new dependencies or regression-test edits.

- [x] Inspect working tree, original contract, phase history, recent code and reports.
- [x] Run `npm test`, `npm run validate`, and `npm run build`; record failures as
  baseline findings, preserving pre-existing untracked DG800 tests.
- [x] Add root `AGENTS.md`, `docs/START-HERE.md`, `CURRENT-STATE.md`,
  `ARCHITECTURE.md`, `DEVELOPMENT.md`, and documentation index.
- [x] Update root README, CONTRIBUTING, PROGRESS and stale voice/handoff pointers.
- [x] Review factual claims against source, check document links and diff, obtain
  independent documentation review, resolve findings, and report residual limits.

Review outcome: 98 local links resolved; concrete source paths checked. Independent
review findings on OSM cache age, voice normalization and Express reload behavior
were checked against source and corrected. All documentation whitespace checks
passed; simulator gate failures remain explicitly documented in CURRENT-STATE.

Verification is of documentation accuracy and recorded code health. A failing
existing simulator gate does not justify changing simulator behavior in this pass
or claiming fresh visual, audible, hardware or whole-project acceptance.
