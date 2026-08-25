---
status: proposed
---

# Bounded exhaustive-Vitest stage termination

**BI/WC:** `BI-F3422349` / `WC-B7D92C90`
**Incident:** `286b14ef3e70` / `cmt8185by0gfi01mgcyu4jhq0`

## Problem and scope

Exact-tree CI can remain `running` when exhaustive Vitest stays alive after useful work stops: its observer samples and its parent renews forever. This is a missing finalizer, not permission to skip tests, shorten leases, or infer failure from idleness.

Change only the process observer, Vitest runner/test, and supervisor; add no schema, lease type, product status, or other-stage timeout.

## Contract

The observer accepts an optional maximum duration. Only exhaustive Vitest opts in: 30 minutes by default via `DPF_LOCAL_CI_VITEST_MAX_DURATION_MS`.

On expiry: sample; request graceful termination; after bounded grace, if still open, terminate the verified PID tree (`taskkill /T` on Windows, process group on POSIX); resolve only on `close` so streams and descendants finalize.

A deadline is `runner-termination`, never `passed` or product red. A failed-test summary stays `test-failure`. Allow one lower-worker retry; a second termination persists `retryExhausted=true`. Lease release stays in `finally`.

## Invariants and evidence

- Inventory, reporter, assertions, exact tree identity, and retry budget stay unchanged.
- Normal close clears timers; stale timers cannot target later/unrelated PIDs.
- One graceful request and at most one PID-bound escalation occur per attempt.
- Other observed commands remain unbounded by default.
- Receipt adds duration, `deadlineExceeded`, termination/escalation evidence, attempts, and classification.

Tests prove deadline/grace order, close-only resolution, cleanup, PID binding, opt-in, classification/retry, test-failure preservation, and executable receipt/exit. Require preflight, independent review, and fresh exact-tree CI.
