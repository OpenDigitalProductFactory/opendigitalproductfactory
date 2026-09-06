---
status: draft
---

# Build-resume review-incomplete backoff implementation plan

Backlog: BI-96885B6B. Workroom: WC-F8400101. Branch: `fix/build-resume-backoff`.

Canonical design: [Build-resume review-incomplete backoff](../specs/2026-09-05-build-resume-review-incomplete-backoff-design.md).

This is one atomic fix. The pure decision, activity interpretation, and resume-path integration are not independently useful or safe to release; they share one revert and one acceptance boundary.

## Backlog coverage

Proposed decision: `atomic` for BI-96885B6B.

| Deliverable | Backlog | Requirements | Contract | Flow | Verification |
| --- | --- | --- | --- | --- | --- |
| bounded review-incomplete resume | BI-96885B6B | OBJ-BRB-1, OBJ-BRB-2, OBJ-BRB-3 | existing `resumePreBuildPhase` contract | stranded ideate build → history classification → skip or canonical retry | AC-BRB-1, AC-BRB-2, AC-BRB-3, AC-BRB-4, AC-BRB-5, AC-BRB-6, AC-BRB-7 |

The live plan-coverage writer and independent baseline are intentionally pending while the provider transport they require is not yet served. No receipt or PASS is inferred at this source-only checkpoint. Do not open a PR until the canonical server can validate this immutable plan or an explicit bootstrap disposition records the missing writer as inconclusive.

## Ordered fix sequence

### 1. Freeze the live failure as a first-failing test

In `apps/web/lib/build/resume-pre-build-phase.test.ts`, model an `ideate` build whose persisted review is `decision=fail, reviewIncomplete=true`. Feed the exact activity shape: terminal incomplete outcomes interleaved with attempt 1/2 and 2/2 progress rows. Assert that the current eager resumer calls the fix loop; this is the RED proving the defect.

Also pin the non-regression boundaries before implementation: a real failed review still repairs, an elapsed backoff retries, no history is due, and a completed outcome resets the streak.

### 2. Add the pure bounded decisions

In `apps/web/lib/build/resume-pre-build-phase.ts`, add:

1. a newest-first reducer that counts only consecutive terminal incomplete outcomes while ignoring progress rows;
2. a pure 30m/1h/2h/4h/6h-capped due-time function;
3. a bounded read of the existing per-build `design_fix_loop` ledger.

Do not add schema, provider, queue, quiescence, or tool contracts. A ledger read failure continues through the existing fail-closed `resumePreBuildPhase` error boundary.

### 3. Gate only the review-incomplete resume path

Before calling `dispatchDesignReviewFixLoop`, apply the decision only when the persisted review is explicitly incomplete. Return a typed `skipped` result containing the streak, remaining wait, and exact next retry time when closed. Preserve the current dispatcher and its arguments when due. Do not back off real review findings.

### 4. Verify the complete atomic boundary

Run the colocated suite with an absolute runner/root and reconcile the number of tests with the file. Run linked `ideate-on-approval`, `review-fix-outcome`, and instrumentation resume tests, then web typecheck, diff/style/module guards, and the repository pregate relevant to the changed files. Record unavailable or occupied infrastructure as inconclusive rather than PASS.

Compare the final diff to protected main and require exactly the design, plan, implementation, and regression-test files plus generated artifacts required by hooks. Commit with DCO and push the exact signed head. Protected GitHub checks remain mandatory.

### 5. Protected and live acceptance

After independent artifact/coverage recovery is available, validate the immutable design and atomic plan, open one PR, and merge only through the protected queue. Publish one canonical release. Use one governed self-upgrade only after exact target, no-newer-run, emergency-off, health, and global-quiescence checks.

On the served SHA, verify CAN-TEST and observe a review-incomplete build across a sweep: no new provider dispatch occurs before `nextAt`; a due build still uses the canonical fix loop. Preserve all pre-fix activity as audit history.

## Risks and rollback

Incorrect streak parsing could either retry too soon or wait too long. Exact terminal prefixes, bounded history, reset-on-other-outcome tests, and the six-hour cap contain the risk. Revert the atomic PR if runtime evidence disagrees; do not delete activity rows, rewrite build state, or weaken quiescence to compensate.
