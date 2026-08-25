---
status: proposed
---

# Bounded exhaustive-Vitest termination

`BI-F3422349`; approval receipt and scope baseline required.

**OBJ-BOUND:** Bound exhaustive Vitest without shortening another stage or skipping tests.

**OBJ-FINALIZE:** Close an expired Vitest process tree; never report an unclosed attempt as pass or product failure.

**OBJ-EVIDENCE:** Persist attempt, classification, retry, and cleanup evidence.

| Acceptance | Objective | Contract |
| --- | --- | --- |
| AC-VITEST-ONLY | OBJ-BOUND | Only Vitest gets the duration; all other budgets and test inventory remain unchanged. |
| AC-TREE-CLOSE | OBJ-FINALIZE | Expiry performs one graceful tree stop, one bounded force escalation, and one bounded final close check. |
| AC-NON-PASS | OBJ-FINALIZE | Stop error or missing close is `runner-termination`, never pass or product red. |
| AC-RETRY-RECEIPT | OBJ-EVIDENCE | One reduced-worker retry records deadline, finalizer, escalation, classification, exhaustion, and cleanup. |

## Complete contract

- `createAttemptRunner` alone supplies `maxDurationMs`. A positive integer `DPF_LOCAL_CI_VITEST_MAX_DURATION_MS` overrides the 1,800,000 ms default; missing, zero, negative, or invalid values use the default. The generic observer is unbounded when duration is absent.
- `createObservedProcessRunner` owns deadline/finalization timers and evidence. `runVitestWithRecovery` owns classification/retry. The existing stage writer persists receipts. No other stage, schema, lease/status, tree identity, inventory, or retry budget changes.
- At deadline: sample once; set `deadlineExceeded`; request Windows `taskkill /PID <pid> /T` or POSIX process-group `SIGTERM`; wait 10 seconds for `close`; if open, request Windows `/T /F` or group `SIGKILL`; wait a final 10 seconds.
- Normal close clears all timers. Action errors are recorded and do not skip the next bounded step. No final close resolves synthetically with `finalizationError=close-timeout`; the promise cannot remain pending. Any post-deadline close stays timed out regardless of status.

| Terminal condition | Classification | Result |
| --- | --- | --- |
| Pre-deadline status 0, no signal/error | `passed` | Exit 0. |
| Pre-deadline failed-test summary | `test-failure` | Preserve nonzero; no retry. |
| Pre-deadline other nonzero, signal, or spawn error | `runner-termination` | Retry attempt 1. |
| Deadline fired; close in either grace; any status | `runner-termination` | Retry attempt 1. |
| Stop/force error or no final close | `runner-termination` | Retry attempt 1. |
| Attempt 2 termination | `runner-termination` | Exit 86; `retryExhausted=true`. |

Retry uses the existing reduced-worker profile. Outer `finally` still releases cleanup and lease state.

## Durable receipt

Each attempt records `maxDurationMs`, `deadlineAt`, `deadlineExceeded`, `gracefulStopAt/result`, `forceTreeAt/result`, `closeObservedAt`, `closeTimedOut`, `finalizationError`, PID, status/signal/error, workers, timestamps, output tail, host samples, and classification. Before exit, the existing exhaustive-Vitest receipt persists attempts, recovery plan, terminal classification, recovered flag, and `retryExhausted`.

## Verification matrix

| Acceptance | Distinct tests |
| --- | --- |
| AC-VITEST-ONLY | Unbounded default; Vitest-only opt-in; valid override; invalid-value default. |
| AC-TREE-CLOSE | Timer cleanup; graceful close; Windows/POSIX graceful and force binding; force close. |
| AC-NON-PASS | Stop error; missing close; post-deadline zero; ordinary failed-test summary. |
| AC-RETRY-RECEIPT | One retry; second termination/exit 86; receipt fields; outer-finally release. |

Require independent review, preflight, and exact-tree CI.
