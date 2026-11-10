---
status: active
title: A slot goes to a waiter on its own claim, and only if it can prove it is alive
---

# A Slot Goes to a Waiter on Its Own Claim, and Only If It Can Prove It Is Alive

- **Date:** 2026-09-02
- **Scope:** platform — nonproduction environment lease admission (`local-integration-ci`, `host-heavy-resource`)
- **Backlog item:** `BI-B1CB7EC3`
- **Epic:** `EP-ABB3AC9D` (change-delivery latency)
- **Kernel ledger:** `DI-BB107914F5B0`
- **Status:** Design — implemented in this branch.

> Half of every local-CI slot handed out for three days went to a process that no longer existed.

---

## 1. What was measured

Live install, `NonProductionEnvironmentLease`, admitted rows for `local-integration-ci` since 2026-08-30 02:25 UTC. Not inferred.

| phase | admitted | expired | expiry | p50 queue wait | sessions |
| --- | --- | --- | --- | --- | --- |
| capacity 2 only — PR #4869 landed, PR #4885 not yet (08-30 02:25 to 20:59) | 8 | 1 | 13% | 0s | 5 |
| after PR #4885 "make gate waits durable" (08-30 20:59 to 09-02 13:27) | 66 | 36 | 55% | 477s | 18 |
| after PR #4989 (09-02 13:27 onward) | 1 | 0 | — | 293s | 1 |

The earlier thread attributed the jump to the capacity-2 pool and expected PR #4989 to repair it. Neither holds. The pool ran at 13% expiry on its own, and #4989 changes verdict writing and the pre-push reader; it touches no lease code. The break coincides with #4885.

### 1.1 The mechanism

Of the 39 expired leases, 32 never heartbeated after admission: `heartbeatAt = admittedAt`. Of those 32, 28 were admitted at the exact instant another session claimed, heartbeated or released. They were promoted by a stranger's transaction, not by their own owner.

Two facts compose:

1. PR #4885 made `gate-worktree.mjs` exit 75 on **any** queued claim (`resumeMode: "durable-task"`). The waiter's process is gone after one claim; an AI session is expected to re-invoke it when the durable TaskRun wakes.
2. `claimNonprodEnvironmentLease` runs `reconcileEnvironmentInTransaction` with the pool's slot keys, and `planEnvironmentAdmission` hands the oldest queued waiter any free slot, whoever is claiming and whether or not the waiter's owner still exists.

So the claimant that did the work promotes the absent head into a slot with a two-minute TTL and nobody to bind it, then waits behind it. The slot is dead for up to two minutes, the pilot circuit breaker reads the expiry as infrastructure failure, and the claimant's own wait grows.

The release path already states the intended rule for these lanes and passes `slotKeys: []`: *"Preserve FIFO here and wake the durable queue head; its one fresh claim can admit."* The claim path was the exception.

### 1.2 Why the planner could not see it

Admission overwrites `heartbeatAt` with `now`. The signal that would have said "this waiter has not been heard from in 26 minutes" is destroyed at the moment it is needed. Liveness has to be judged on the row as it stands before the pass.

---

## 2. Research & benchmarking

- **Kubernetes Lease objects.** A holder keeps a lease by renewing `renewTime`; a controller that stops renewing loses leadership after `leaseDurationSeconds`, and nothing else can renew on its behalf. Admission here follows the same shape: the waiter proves itself, nobody proves it for the waiter.
- **SQS visibility timeout.** A consumer that receives a message and disappears does not keep it; the message becomes visible again after the timeout. Our two-minute admitted TTL is that timeout. The defect was assigning the message to a consumer known not to be listening.
- **The platform's own rule, already applied once.** `leaseStillProvesLiveness` (BI-DC9CA20D, PR #4976) stopped host-capacity arbitration from treating presence as liveness. This applies the same standard one step earlier, at admission.

Rejected: reverting the durable wait (undoes the polling reduction it was built for), seeding the pool back to one slot (the measurement shows capacity is not the cause and a shorter queue does not remove orphans), and shortening the unbound TTL (reduces the cost of each orphan without stopping them). Kernel scoring: `DI-BB107914F5B0`, high confidence.

---

## 3. Decision

For the lease-gated lanes (`local-integration-ci`, `host-heavy-resource`):

1. **A claim admits only itself.** A waiter is never promoted into a slot by another session's transaction. Release and reaping already wake the head through the durable TaskRun; its own next claim admits it.
2. **Precedence requires proof of life.** An older waiter keeps its place in line and blocks a younger claimant only if its last beat is within the admitted TTL for the lane (two minutes). A waiter that could not have kept an admitted lease alive cannot hold a slot hostage either. It is not expired; when its owner re-claims, the beat refreshes and it is first again.
3. **Everything else is unchanged.** Environments that pass no liveness window or admissible set (the preview lane, and the reaper's own pass) keep the legacy FIFO promotion.

---

## 4. What was built

- `planEnvironmentAdmission` takes `livenessWindowMs` and `admissibleLeaseIds`, both optional. `waiterProvesLiveness` reads `heartbeatAt`, falling back to `queuedAt` as the implicit first beat.
- `claimNonprodEnvironmentLease` passes `admissibleLeaseIds: [lease.id]` and `livenessWindowMs: admittedLeaseTtlMs(...)` for the self-admitting lanes. `isSelfAdmittingEnvironment` replaces the two inline environment-key ternaries the release and reap paths already carried.
- The slot-binding validation moved unchanged into `environment-lease-slot-binding.ts` so `environment-lease.ts` stays under the module-size ceiling.

### 4.1 Regression guards, verified to fail without the fix

`scripts/nonprod-environment-admission.test.mjs` (raw node): with the planner reverted, 3 of 14 fail — the stranger-does-not-promote case, the stale-head-cannot-block case, and the self-admission case.

`apps/web/lib/nonprod/environment-lease-self-admission.test.ts` (vitest): a stranded head is not admitted on a stranger's claim; a head that beat within the TTL keeps precedence and the claimant queues at position 2; the head admits itself on its own return.

---

## 5. What this does not do

- It does not stop a session from leaving a queued row behind (BI-EB864226 covers the duplicate-entry side; the two-hour queued expiry is unchanged). Such a row now costs a place in line, not a slot.
- It does not change the client's exit-75 behaviour or the durable TaskRun wake path.
- It does not touch the preview (`active-candidate`) lane, which has no durable-wait client.
