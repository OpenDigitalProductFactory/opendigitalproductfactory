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

## Boundary and owner

Only `createAttemptRunner` supplies `maxDurationMs=1_800_000`, read from positive integer `DPF_LOCAL_CI_VITEST_MAX_DURATION_MS`; the generic observer remains unbounded by default. `createObservedProcessRunner` owns deadline/finalization timers and returns finalizer evidence. `runVitestWithRecovery` owns classification/retry. The existing stage-receipt writer persists attempts and terminal classification. Skip no tests; change no other stage, schema, lease/status, tree identity, or retry budget.

## Finalizer contract

At the deadline the observer samples once, marks `deadlineExceeded`, and requests one tree stop: Windows `taskkill /PID <pid> /T`; POSIX spawns the attempt in its own process group and sends group `SIGTERM`. It waits 10 seconds for `close`. If still open it performs one force-tree action: Windows adds `/F`; POSIX sends group `SIGKILL`. It then waits a final 10 seconds for `close`. Normal close clears all three timers. Action failure is recorded but does not skip the remaining bounded step. Missing `close` after final grace resolves a synthetic attempt with `finalizationError=close-timeout`; the promise never remains pending. Any close after deadline remains a timed-out attempt regardless of exit status.

## Terminal decision table

| Condition | Classification | Retry/final result |
| --- | --- | --- |
| Close before deadline; status 0; no signal/error | `passed` | Finish 0. |
| Close before deadline; failed-test summary | `test-failure` | No retry; preserve nonzero status. |
| Close before deadline; other nonzero, signal, or spawn error | `runner-termination` | Retry attempt 1 only. |
| Deadline fired; close during either grace, any status | `runner-termination` | Retry attempt 1 only. |
| Stop/force error or no final `close` | `runner-termination` | Retry attempt 1 only. |
| Attempt 2 is `runner-termination` | `runner-termination` | Exit 86 and `retryExhausted=true`. |

The retry uses the existing reduced-worker profile. Cleanup and lease release remain in the outer `finally`; no finalizer outcome can become pass or product red.

## Evidence and verification

Each attempt carries `maxDurationMs`, `deadlineAt`, `deadlineExceeded`, `gracefulStopAt/result`, `forceTreeAt/result`, `closeObservedAt`, `closeTimedOut`, `finalizationError`, child PID, status/signal/error, workers, timestamps, output tail, host samples, and classification. Existing heartbeats record phase changes; the existing exhaustive-Vitest receipt persists the attempt array, recovery plan, terminal classification, recovered flag, and `retryExhausted` before exit.

Tests separately prove: unbounded default and Vitest-only opt-in; normal-close timer cleanup; graceful-close success; Windows and POSIX graceful/force PID binding; force-tree close; kill error; missing final close resolves non-pass; post-deadline status 0 stays termination; ordinary failed-test summary stays `test-failure`; one retry and second termination exhaustion; receipt fields/exit 86; outer `finally` release. Require independent review, preflight, and exact-tree CI.
