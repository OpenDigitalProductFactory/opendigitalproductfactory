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

1. `scripts/lib/guard-outcome-record.mjs` with `scripts/lib/guard-outcome-record.test.mjs`: record builder and `validateRunRecord`; `digestFiles`; `importClosure` (relative imports under `scripts/`, cycle-safe) feeding `digestLoopGuard` (guard, sibling self-test, closure) and `digestPolicyGuard` (command line plus the closure of every named script); `resolveDiffIdentity` (branch, `headSha`, merge base, `git patch-id --stable`, dirty flag, `cloneKey`); declarations loader and `declarationsDigest`; `overrideFromEnv`; `spoolRecord`, `readSpool`, `flushSpool` (3-second timeout, delete only on matching acknowledgement; quarantine permanent payload refusal with reason, preserve repairable/unknown failures). No function on a runner's exit path throws.
2. `scripts/guard-declarations.json`: schema version, a `guards` map with declarations for the guards this item touches.
3. `scripts/check-guards.mjs`: `runGuards` also returns per-guard `{ guard, verdict, durationMs }` with `self-test-failed` for a failing self-test; `main` spools a `guard-loop` record. Existing return fields and exit codes unchanged (existing tests stay green).
4. `scripts/lib/ci-policy-guards.mjs`: mark `repo-guard-loop` `aggregate`; wire the new node tests into the source profile (the inventory is hand-enumerated).
5. `scripts/pregate-preflight.mjs`: after an executed (not reused, not skipped) run, spool a `pregate` record from the classified entries and flush; record the skip override when `DPF_SKIP_PREGATE_PREFLIGHT_REASON` is set.
6. `scripts/record-guard-outcome.mjs` (CLI, with test): spool one `hook:pre-push-gate` result for a given verdict and override, then flush. `.githooks/pre-push-gate` calls it on every exit path through one shell function, `|| true`, never changing the hook's exit status.

Verification: node tests above (fail first); `node --test scripts/check-guards.test.mjs`; the existing pregate-preflight and pre-push-gate tests.

### D2 — Platform write

1. `apps/web/lib/gpp/efficacy/guard-outcome-run.ts` (+ test): shared validated v1 contract consumed by JS/TS, or parity-tested projection where build boundaries require it, `validateGuardOutcomeRun` with the size limits, `guardOutcomeRunRowId` and `guardOutcomeClassificationRowId`.
2. `apps/web/lib/gpp/efficacy/record-guard-outcomes.ts` (+ test): writes `guard-outcome.run` rows and the `guard-outcome.declarations` row with deterministic ids; an exact actor/content replay returns acknowledged; conflicting identity/content refuses; actor and recorder come from the caller.
3. `record_guard_outcomes` in `apps/web/lib/mcp/packs/build-evidence-pack.ts` (definition, handler, grant `backlog_write`), `apps/web/lib/tak/agent-grants.ts`, the applicable existing external-development tool attachment, and the canonical GPP internal-consequence declaration (bounded evidence write, no outward/authority/irreversible effect). Do not grow the shrink-only unclassified baseline or widen grants.

Verification: unit tests for validation, limits and idempotence; pack and grants tests; the GPP consequence-classification ratchet.

### D3 — Classifier and prune

1. `apps/web/lib/gpp/efficacy/classify-guard-refusals.ts` (+ test): pure; one test per row of the design's §4.3 table, plus the window, aggregate and hook exclusion, and intermediate refusals.
2. `apps/web/lib/gpp/efficacy/guard-outcome-store.ts` (+ test with a typed fake): page refused/later results per authorized clone/branch with stable cursor and explicit incomplete coverage; write classification rows idempotently with truthful proxy labels; prune only eligible operation-scoped telemetry under existing retention/floors, retaining declarations still referenced.
3. `apps/web/lib/queue/functions/guard-outcome-classify.ts`, daily, registered in `lib/queue/functions/index.ts`, behind `gateAtEntry`.

Verification: unit tests; queue function registration test.

### D4 — Retirement ratchet

1. `apps/web/lib/gpp/efficacy/guard-retirement.ts` (+ test): pure evaluator for R-1a, R-1b and R-2 with floors, window restart, `keep`, and the cap of 3.
2. `apps/web/lib/gpp/efficacy/guard-retirement-filing.ts` (+ test): `ingestBacklogItem` with origin dedupe, the weekly digest item, the closed-item window restart, and the `guard-outcome.retirement-review` row.
3. `apps/web/lib/queue/functions/guard-retirement-review.ts`, daily after the classifier.

Verification: the fixture-guard test for AC-GOE-05 (zero catches, false-refusal rate above 0.25 → exactly one item; second run → none; `keep` → none).

### D5 — Measures and ops view

1. `apps/web/lib/gpp/efficacy/efficacy-measures.ts` (+ test): M-1..M-7 and G-1..G-5 from typed count inputs, each `{ numerator, denominator, value, omits }`, M-5 null; overall M-2/M-7 unknown unless their actual decision/effect/observation coverage exists, with clearly named subset proxies and actual envelope counts (design section 5.1).
2. `apps/web/lib/gpp/efficacy/efficacy-measures-store.ts`: Prisma counts for M-1..M-7 and one SQL aggregate over `details->'guards'` for G-1..G-5.
3. `apps/web/app/(shell)/ops/gate-efficacy/page.tsx`: server component composed from report-kit and the existing ops shell/navigation; read-only counts, units, denominators, coverage and plain-language unknowns under design section 5.1.

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

## Current acceptance and recovery checkpoint (2026-10-25)

The following live BI acceptance criteria are quoted verbatim; design section 5.1 makes their proxy and observation limitations explicit, without claiming a causal defect catch:

- `pregate`, `pre-push-gate` and `check-guards` emit outcome records. A test proves a refusal followed by a fixing commit is classified "caught".
- An ops view, or `wiki_query`-reachable report, lists M-1 to M-7 with denominators for the last 14 days.
- The retirement ratchet files one item for a fixture guard with zero catches and a high false-refusal rate.

Existing work is preserved at stash 025ff525f23b53efba770b6761ffee699b6740b2 and an external immutable snapshot. Do not drop the stash or overwrite a new owner edit. First publish this reconciled design/plan with DCO, refresh Workroom head, obtain the native independent scope/architecture/plan decisions and actual coverage required by its effective shape, then claim implementation. Restore the inherited draft only after admission; reconcile each source hunk against current main and run failing behavioral tests for changed contracts before implementation. The historical 24-test green result is a baseline, not fabricated red/green history.

Coverage remains pending; historical single-item prose is not a receipt. The current declared grant/approval paths raise native effective size to large/high; retain its independent review and baseline traceability. One atomic BI remains proposed because client records, authenticated storage, classification, retirement review and honest reporting jointly satisfy the existing three acceptance criteria; an independent deliverable finding is reconciled through the existing backlog, not hidden by client-selected receipt schema.

Required additional checks: exact-content replay versus actor/content collision; oversized and hostile payload; spool transport/authorization/unknown/permanent refusal; no guard exit-code change; incomplete/mature series and stable cursor restart; noisy fixture dedupe/keep expiry; actual envelope counts versus zero kernel choices; agent-choice-only M-7; missing observations M-5; ratios exceeding one with correct units; unauthorized owner read; derived route/audience/shell/purpose manifests; UX-fit measured evidence; module-size and no-unclassified-growth guards. Consume WC-B99B7ED2 changeImpactContract, resolve related tests (or bounded documented fallback), regenerate declared artifacts, run scoped types/tests then the governed integration gate. Independent semantic review, normal PR readiness, protected CI/queue and served-runtime checks remain mandatory.

Contract references: GOE-AUTHENTICATED-RECORD, GOE-PAIRING-PROXY, GOE-OBSERVATION-COVERAGE, GOE-RETIREMENT-REVIEW. Flow references: client-record-to-platform-telemetry, refusal-to-pairing-to-review, approval-to-effect-to-observation. Verification references: AC-GOE-01, AC-GOE-02, AC-GOE-03, AC-GOE-04, AC-GOE-05, AC-GOE-06, V-GOE-CURRENT-INTEGRATION. Requirements: OBJ-GOE-01, OBJ-GOE-02, OBJ-GOE-03, OBJ-GOE-04.

Rollback removes the new integration paths/jobs/report while preserving existing authority and audit. No historic approvals are replayed or blanket-approved; no guard or permit enforcement is disabled by this item. Runtime acceptance remains unrun.
