---
status: proposed
---
# Vitest bound (`BI-F3422349`)

**OBJ-BOUND:** Bound Vitest only; keep tests.
**OBJ-FINALIZE:** Close expired trees; unclosed=termination.
**OBJ-EVIDENCE:** Persist retry/cleanup.

**AC-VITEST-ONLY [OBJ-BOUND]:** Other stages/tests unchanged.
**AC-TREE-CLOSE [OBJ-FINALIZE]:** Bounded stop/force/close.
**AC-NON-PASS [OBJ-FINALIZE]:** Error/no-close never passes/product-red.
**AC-RETRY-RECEIPT [OBJ-EVIDENCE]:** One reduced retry+receipt.

Scope: attempt runner alone uses positive env duration or 1,800,000ms; observer else unbounded. Observer owns finalizer; supervisor class/retry; writer receipt. No other stage/test/schema/lease/tree.

Finalizer: mark; Windows `/T` or POSIX group `SIGTERM`; wait 10s; if open `/T /F` or `SIGKILL`; wait 10s; no-close=`close-timeout`. Close clears timers; errors record; late zero terminates.

Decision: early 0=`passed`; failed-test=`test-failure`/no-retry; nonzero/signal/spawn/deadline/stop/no-close=`runner-termination`/retry; second=exit86+exhausted.

Receipt: duration/deadline; stop/force time+result; close/error; PID/status/signal; workers/time/tail/samples/class; terminal attempts/recovery/recovered/exhausted; `finally` releases.

Verify: AC1 default/override/scope; AC2 Win/POSIX stop/force/close; AC3 error/no-close/late-zero/test-fail; AC4 retry/exhaustion/receipt/finally; review/preflight/CI.
