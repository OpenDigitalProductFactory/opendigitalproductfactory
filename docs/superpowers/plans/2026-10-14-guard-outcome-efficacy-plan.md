---
status: draft
backlogItem: BI-FEDD8F45
workroom: WC-B99B7ED2
---

# Guard outcome records, §11 efficacy measures and the retirement ratchet — implementation plan

**Item:** BI-FEDD8F45 / WC-B99B7ED2 (delivery-medium), epic EP-B932453F.
**Design:** [guard outcome efficacy design](../specs/2026-10-14-guard-outcome-efficacy-design.md) — objectives OBJ-GOE-01..04, acceptance AC-GOE-01..06.
**Follow-up outside this plan:** BI-3B2CE771 (sandbox gauntlet as a platform-written runner).

Coverage decision: **single item**. Medium shape, one implementation PR; every deliverable is covered by BI-FEDD8F45. Each slice is written test-first: the named test fails before the code exists and passes after.

## Slices

### D1 — Client record, spool and flush

1. `scripts/lib/guard-outcome-record.mjs` with `scripts/lib/guard-outcome-record.test.mjs`: record builder and `validateRunRecord`; `digestFiles`; `importClosure` (relative imports under `scripts/`, cycle-safe) feeding `digestLoopGuard` (guard, sibling self-test, closure) and `digestPolicyGuard` (command line plus the closure of every named script); `resolveDiffIdentity` (branch, `headSha`, merge base, `git patch-id --stable`, dirty flag, `cloneKey`); declarations loader and `declarationsDigest`; `overrideFromEnv`; `spoolRecord`, `readSpool`, `flushSpool` (3-second timeout, delete on acknowledge or refuse, keep on transport failure). No function on a runner's exit path throws.
2. `scripts/guard-declarations.json`: schema version, a `guards` map with declarations for the guards this item touches.
3. `scripts/check-guards.mjs`: `runGuards` also returns per-guard `{ guard, verdict, durationMs }` with `self-test-failed` for a failing self-test; `main` spools a `guard-loop` record. Existing return fields and exit codes unchanged (existing tests stay green).
4. `scripts/lib/ci-policy-guards.mjs`: mark `repo-guard-loop` `aggregate`; wire the new node tests into the source profile (the inventory is hand-enumerated).
5. `scripts/pregate-preflight.mjs`: after an executed (not reused, not skipped) run, spool a `pregate` record from the classified entries and flush; record the skip override when `DPF_SKIP_PREGATE_PREFLIGHT_REASON` is set.
6. `scripts/record-guard-outcome.mjs` (CLI, with test): spool one `hook:pre-push-gate` result for a given verdict and override, then flush. `.githooks/pre-push-gate` calls it on every exit path through one shell function, `|| true`, never changing the hook's exit status.

Verification: node tests above (fail first); `node --test scripts/check-guards.test.mjs`; the existing pregate-preflight and pre-push-gate tests.

### D2 — Platform write

1. `apps/web/lib/gpp/efficacy/guard-outcome-run.ts` (+ test): TS mirror of the v1 schema, `validateGuardOutcomeRun` with the size limits, `guardOutcomeRunRowId` and `guardOutcomeClassificationRowId`.
2. `apps/web/lib/gpp/efficacy/record-guard-outcomes.ts` (+ test): writes `guard-outcome.run` rows and the `guard-outcome.declarations` row with deterministic ids; a primary-key collision returns `acknowledged`; actor and recorder from the caller.
3. `record_guard_outcomes` in `apps/web/lib/mcp/packs/build-evidence-pack.ts` (definition, handler, grant `backlog_write`), `apps/web/lib/tak/agent-grants.ts`, the external-development OAuth profile, and `apps/web/lib/gpp/known-unclassified-side-effect-tools.ts` (an internal evidence write: not outward, authority or irreversible).

Verification: unit tests for validation, limits and idempotence; pack and grants tests; the GPP consequence-classification ratchet.

### D3 — Classifier and prune

1. `apps/web/lib/gpp/efficacy/classify-guard-refusals.ts` (+ test): pure; one test per row of the design's §4.3 table, plus the window, aggregate and hook exclusion, and intermediate refusals.
2. `apps/web/lib/gpp/efficacy/guard-outcome-store.ts` (+ test with a typed fake): load refused results and later results per clone and branch; write classification rows idempotently; delete `guard-outcome.*` rows older than 365 days.
3. `apps/web/lib/queue/functions/guard-outcome-classify.ts`, daily, registered in `lib/queue/functions/index.ts`, behind `gateAtEntry`.

Verification: unit tests; queue function registration test.

### D4 — Retirement ratchet

1. `apps/web/lib/gpp/efficacy/guard-retirement.ts` (+ test): pure evaluator for R-1a, R-1b and R-2 with floors, window restart, `keep`, and the cap of 3.
2. `apps/web/lib/gpp/efficacy/guard-retirement-filing.ts` (+ test): `ingestBacklogItem` with origin dedupe, the weekly digest item, the closed-item window restart, and the `guard-outcome.retirement-review` row.
3. `apps/web/lib/queue/functions/guard-retirement-review.ts`, daily after the classifier.

Verification: the fixture-guard test for AC-GOE-05 (zero catches, false-refusal rate above 0.25 → exactly one item; second run → none; `keep` → none).

### D5 — Measures and ops view

1. `apps/web/lib/gpp/efficacy/efficacy-measures.ts` (+ test): M-1..M-7 and G-1..G-5 from typed count inputs, each `{ numerator, denominator, value, omits }`, M-5 `null`.
2. `apps/web/lib/gpp/efficacy/efficacy-measures-store.ts`: Prisma counts for M-1..M-7 and one SQL aggregate over `details->'guards'` for G-1..G-5.
3. `apps/web/app/(shell)/ops/gate-efficacy/page.tsx`: server component, two read-only tables, theme tokens, `PlatformTabNav`; ops navigation entry.

Verification: measure tests; UX-fit review; served-target check on the dev install.

### D6 — Documentation

GPP Annex A "Evidence for §11" row and overall `GPP-Evidenced` status. Docs lint.

## Sequencing

D1 and D2 first (D2 needs D1's schema), then D3, then D4 and D5 in parallel, then D6.

## Traceability

Requirements are the design's objectives; verification is its acceptance criteria.

| Deliverable | Backlog item | Requirements | Contracts | Flows | Verification |
| --- | --- | --- | --- | --- | --- |
| D1 | BI-FEDD8F45 | OBJ-GOE-01 | `scripts/lib/guard-outcome-record.mjs`; `scripts/guard-declarations.json` | pregate, pre-push-gate and guard-loop runs spool and flush | AC-GOE-01 |
| D2 | BI-FEDD8F45 | OBJ-GOE-01 | `record_guard_outcomes` | spool flush writes guard-outcome.run rows | AC-GOE-02 |
| D3 | BI-FEDD8F45 | OBJ-GOE-02 | `apps/web/lib/gpp/efficacy/classify-guard-refusals.ts` | daily classification of refusals | AC-GOE-03 |
| D4 | BI-FEDD8F45 | OBJ-GOE-04 | `apps/web/lib/gpp/efficacy/guard-retirement.ts` | daily retirement review files items | AC-GOE-05 |
| D5 | BI-FEDD8F45 | OBJ-GOE-03 | `apps/web/lib/gpp/efficacy/efficacy-measures.ts`; `/ops/gate-efficacy` | operator reads measures | AC-GOE-04 |
| D6 | BI-FEDD8F45 | OBJ-GOE-03 | `docs/architecture/gated-permissions-process.md` | GPP Annex A states published measures | AC-GOE-06 |
