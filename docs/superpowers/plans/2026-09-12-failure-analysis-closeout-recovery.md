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

## Atomic backlog coverage

`BI-6B311DC8` maps OBJ-CLOSEOUT-001 through OBJ-CLOSEOUT-003 to this single repair. The worker regression proves AC-CLOSEOUT-001; the existing terminal-attempt single-flight regression proves AC-CLOSEOUT-002; the adjacent durable-worker suite proves AC-CLOSEOUT-003.

