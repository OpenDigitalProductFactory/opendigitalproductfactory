---
status: proposed
---

# Bounded exhaustive-Vitest termination

`BI-F3422349`; approval receipt + scope baseline required.

**OBJ-BOUND:** Bound exhaustive Vitest attempts without shortening another local-CI stage or skipping tests.

**OBJ-FINALIZE:** Terminate an expired Vitest process tree predictably and never classify an unclosed runner as pass or product failure.

**OBJ-EVIDENCE:** Preserve attempt, classification, retry, and cleanup evidence for governed diagnosis.

| Acceptance | Objectives | Statement |
| --- | --- | --- |
| AC-VITEST-ONLY | OBJ-BOUND | Only Vitest receives the explicit bounded duration; other stage budgets and test inventory stay unchanged. |
| AC-TREE-CLOSE | OBJ-FINALIZE | Expiry performs one graceful request, one bounded process-tree escalation, and a bounded final close check. |
| AC-NON-PASS | OBJ-FINALIZE | Kill error or missing close is runner-termination and cannot become pass or product red. |
| AC-RETRY-RECEIPT | OBJ-EVIDENCE | One reduced-worker retry records deadline, finalizer, escalation, attempts, classification, exhaustion, and cleanup. |

Scope: observer, Vitest runner/test, supervisor. Skip no tests; change no other stage, schema, lease/status, tree identity, or retry budget. Vitest alone opts into 30 minutes via `DPF_LOCAL_CI_VITEST_MAX_DURATION_MS`.

On expiry: sample; graceful stop; bounded grace; kill that PID tree (`taskkill /T` Windows; TERM then KILL POSIX); final bounded `close` grace. Kill error/missing `close` records finalization error. Normal close clears timers; one graceful request and at most one attempt-bound escalation.

Timeout/finalizer = `runner-termination`, never pass/product red; failed-test summary = `test-failure`. Retry once with fewer workers; second termination sets `retryExhausted=true`; cleanup/release stays in `finally`. Receipt records duration, deadline, finalizer/escalation, attempts, classification.

Tests cover cleanup/grace, OS PID binding, finalizer non-pass, opt-in, test-failure, retry exhaustion, receipt/exit, `finally`. Require independent review, preflight, exact-tree CI.
