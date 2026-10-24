---
status: active
---

# Failure-analysis closeout recovery plan

Implements [failure-analysis closeout recovery](../specs/2026-09-12-failure-analysis-closeout-recovery.md) for `BI-6B311DC8`.

## Ordered sequence

1. Reproduce the live failure: resolved evidence differs from the immutable packet and the worker parks the TaskRun as `input-required` without dispatch.
2. Terminalize only this immutable evidence-drift case as failed and publish a precise action to submit a refreshed immutable request.
3. Prove the worker does not dispatch a reviewer for stale evidence and retain the existing single-flight test proving terminal stale evidence permits one new attempt.
4. Run focused and adjacent review tests, web typecheck, source guards, DCO, and all protected PR checks. If a local leased gate is unavailable, record it as inconclusive; do not infer PASS.
5. Deploy through the canonical release path, resubmit the corrected failure review, verify a genuine receipt, then complete the original Workroom.
6. Reproduce the legacy closeout gap: an already-`done` backlog item carrying new completion evidence exits through the generic no-op before the canonical terminal transition.
7. Route only evidence-bearing `done` retries through the canonical transition. Preserve evidence-free retry idempotency, the original completion timestamp, and status-change history.
8. Prove the MCP handler and terminal transition together, then deploy and use the repaired path to reconcile the original Pet Rescue delivery evidence and complete its Workroom.

## Atomic backlog coverage

`BI-6B311DC8` maps OBJ-CLOSEOUT-001 through OBJ-CLOSEOUT-004 to this single repair. The worker regression proves AC-CLOSEOUT-001; the existing terminal-attempt single-flight regression proves AC-CLOSEOUT-002; the adjacent durable-worker suite proves AC-CLOSEOUT-003. The backlog-pack regression proves AC-CLOSEOUT-004, and the terminal-transition regression proves AC-CLOSEOUT-005.
