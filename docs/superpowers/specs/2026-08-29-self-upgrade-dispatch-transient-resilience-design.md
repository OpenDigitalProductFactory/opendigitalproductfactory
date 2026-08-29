---
status: active
---

# Self-upgrade dispatch must survive a transient queue error

**Backlog item:** BI-965E65B7

## Problem

An operator clicked "Upgrade now" at 2026-08-29 02:52 UTC. The run was created
and immediately marked `failed`:

```
runId       | SUR-D71E8971
status      | failed
failureLog  | queue-dispatch-failed: fetch failed
startedAt   | (empty)
completedAt | 2026-08-29 02:52:29.67
```

The portal log carries the cause:

```
[TypeError: fetch failed]
  [cause]: Error [ConnectTimeoutError]: Connect Timeout Error
           (attempted address: inngest:8288, timeout: 10000ms)
    code: 'UND_ERR_CONNECT_TIMEOUT'
```

## Evidence that this was transient

- `dpf-inngest-1` had been up since 2026-08-27 13:33 and logged 4-9 events per
  minute continuously across 02:52, with no gap and no restart.
- Across the portal container's whole 2h20m uptime, `UND_ERR_CONNECT_TIMEOUT`
  appears exactly once, and `inngest:8288` is the only address it names.
- `fetch("http://inngest:8288/health")` from inside the portal returns 200 on
  demand.

One connect attempt lost a race against a 10-second timeout. Nothing was wrong
with the system, and the identical dispatch succeeded unchanged on the next
attempt (SUR-946F62CC).

## Root cause

`triggerSelfUpgrade` (`apps/web/lib/actions/promotions.ts:815-832`) creates the
run row, calls `inngest.send`, and on any throw calls `failRun` and returns.
`requestSelfUpgrade` (`apps/web/lib/self-upgrade/request.ts:177-206`) is the same
shape for the agent-initiated path.

There is no retry, no backoff, and no reaper that re-queues a run that died
before `startedAt` was ever set. A ten-second network hiccup therefore costs the
operator the deploy, leaves a `failed` run that reads as though the upgrade
itself broke, and requires a human to notice and click again.

That is a poor failure mode for the one action whose purpose is unattended
recovery. In this incident the install was already sitting on a three-day-old
image from a separate downgrade (BI-6CB35411), so the lost dispatch extended a
live regression by over an hour.

## Why the runner's `retries: 0` does not settle it

`selfUpgradeManual` sets `retries: 0` deliberately: a *promotion* must not be
attempted twice, because a half-completed swap re-entered is worse than a failed
one. That reasoning is sound and is not in scope here.

It does not extend to the *enqueue*. Publishing an event is idempotent from the
operator's point of view and has not yet touched the install: no quiescence
drain, no image pull, no container recreate. The two steps have different safety
properties and should not share one retry policy.

## Research and benchmarking

How comparable job systems treat the publish step versus the work step:

| System | Publish step | Work step |
| --- | --- | --- |
| Inngest (own SDK guidance) | Retry `send` on transport failure; the event key makes it safe | Per-function `retries` |
| Temporal | Client `StartWorkflow` retried by the SDK on transport errors | Workflow retry policy separate |
| Sidekiq / BullMQ | Redis client retries the enqueue | Job `attempts` independent |
| AWS Step Functions | SDK retries `StartExecution` on 5xx/throttle | State-machine `Retry` blocks |

The consistent pattern is that transport failures at enqueue are retried by the
client and are not conflated with work-level retry policy. DPF currently has no
retry at either layer for this path, which is stricter than any of them without
gaining anything.

## Decision

Retry `inngest.send` on transient transport errors only, then fail loudly.

1. **Classify.** Retry `UND_ERR_CONNECT_TIMEOUT`, `ECONNREFUSED`, `ECONNRESET`,
   `EAI_AGAIN`, `ETIMEDOUT` and generic `fetch failed` with no HTTP status. Do
   **not** retry a 4xx from the event API: a rejected event key or malformed
   payload is a real misconfiguration and must surface immediately.
2. **Bound it.** Three attempts, short backoff, a few seconds total. The operator
   is watching a button; this must not become a long silent wait.
3. **Share one helper.** Both call sites get the same behaviour from one module
   rather than two copies of a retry loop.

### Distinguish "never dispatched" from "promotion failed"

A run that never reached the queue has not attempted an upgrade. Recording it as
`failed` overstates what happened and makes run history misleading — an operator
reading `failed` reasonably concludes the upgrade was tried and broke.

The run row is created before the send specifically so a dispatch failure is
visible rather than silent, which is the right instinct. The fix is to keep the
row and make its terminal state honest, not to delete it.

### Name the endpoint in the message

`queue-dispatch-failed: fetch failed` tells an operator nothing actionable. After
retries are exhausted the failure should name the endpoint and the error class,
so the next step (is inngest up? is the network wedged?) is obvious from the run
history alone.

## Blast radius

- Two call sites, one new helper, no schema change and no API change.
- No change to the runner, to `retries: 0`, or to any promotion behaviour.
- A genuine outage still fails, just a few seconds later and with a better
  message.
- Existing `failed` rows are untouched; this is forward-only behaviour.

## Verification

- A simulated connect timeout on the first `inngest.send` attempt still queues
  the run.
- Three consecutive transport failures fail the run, with the endpoint and error
  class in the message.
- A 4xx from the event API fails immediately, without retrying.
- The runner's `retries: 0` is unchanged, asserted by the existing tests.
