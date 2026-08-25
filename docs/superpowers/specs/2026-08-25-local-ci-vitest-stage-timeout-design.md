---
status: active
---
# Vitest bound (`BI-F3422349`)

**OBJ-BOUND:** Bound Vitest only; keep tests.
**OBJ-FINALIZE:** Close expired trees; unclosed=termination.
**OBJ-EVIDENCE:** Persist retry/cleanup.

| AC-VITEST-ONLY | OBJ-BOUND | Other work unchanged. |
| AC-TREE-CLOSE | OBJ-FINALIZE | Bounded tree close. |
| AC-NON-PASS | OBJ-FINALIZE | Termination never product-red. |
| AC-RETRY-RECEIPT | OBJ-EVIDENCE | One reduced-worker retry+receipt. |

Scope: attempt runner alone uses positive `DPF_LOCAL_CI_VITEST_MAX_DURATION_MS` or 1,800,000ms; observer else unbounded. Observer owns finalizer; supervisor class/retry; writer receipt. No other stage/test/schema/tree.

Finalizer: set `deadlineExceeded`; Windows `/T` or POSIX group `SIGTERM`; wait 10s; if open `/T /F` or `SIGKILL`; wait 10s; no-close=`close-timeout`. Close clears timers; errors record.

Decision: early 0=`passed`; failed-test=`test-failure`/no-retry; nonzero/signal/spawn/deadline (including late 0)/stop/no-close=`runner-termination`/reduced-worker retry; second=exit86+exhausted.

Receipt: duration/deadline; stop/force time+result; close/error; PID/status/signal; workers/time/tail/samples/class; terminal attempts/recovery/recovered/exhausted; `finally` releases.

Verify: AC1 default/override/scope; AC2 Win/POSIX stop/force/close; AC3 error/no-close/late-zero/test-fail; AC4 retry/exhaustion/receipt/finally; review/preflight/CI.
