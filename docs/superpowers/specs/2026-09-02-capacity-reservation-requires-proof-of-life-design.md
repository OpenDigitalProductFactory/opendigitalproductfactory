---
status: active
title: A capacity reservation is only as good as its last proof of life
---

# A Capacity Reservation Is Only As Good As Its Last Proof of Life

- **Date:** 2026-09-02
- **Scope:** platform — nonproduction environment lease registry, local provider capacity arbitration
- **Backlog item:** `BI-DC9CA20D`
- **Status:** Design — implemented in this branch.

> Six dead rows in a queue took the platform's own AI offline, and nothing about the
> system could tell that they were dead — because nothing ever asked.

---

## 1. What was measured

Live install, 2026-09-02 at 04:19. Not inferred.

```
leases:  []            ← nothing held the slot
queued:  [6 entries]   ← waiting 10 to 53 minutes
```

| lease | heartbeat advance | stale for | declared TTL | occupies until |
| --- | --- | --- | --- | --- |
| NPEL-0BFCE35A0D | **0s** | 53m | ~2m | +2h |
| NPEL-9742BE705D | **0s** | 53m | ~2m | +2h |
| NPEL-088F40091E | **0s** | 34m | ~2m | +2h |
| NPEL-E42846763F | **0s** | 32m | ~2m | +2h |
| NPEL-5FF6215312 | **0s** | 13m | ~2m | +2h |
| NPEL-19CB8E7052 | **0s** | 10m | ~2m | +2h |

**Not one heartbeat had ever advanced.** `heartbeatAt` equalled `queuedAt` exactly, on every row.
A live waiter renews while it waits — a successful lease earlier the same day showed `heartbeatAt`
23 minutes ahead of its `queuedAt`. These six queued once, their sessions died, and no process
remained to be admitted.

### 1.1 Why this became permanent rather than transient

Three facts compose into an outage that cannot self-heal:

1. `listCapacityReservingNonprodEnvironmentLeases` counted any row with `status IN (active, queued)`
   and `expiresAt > now`. **Presence was treated as liveness.** The heartbeat was never consulted.
2. `local-provider-capacity` defers local inference whenever *any* lease reserves the host. One dead
   row is enough.
3. Dead rows arrived roughly **every 7 minutes** and decayed over **2 hours**. Arrivals outpaced
   decay by ~17×, so the queue could never empty.

The result is a permanent outage of the platform's own AI. `contendsForInference` in
`local-provider-capacity.ts` already documents this exact failure for the preview case — its comment
records that *"a permanently non-empty queue became a permanent outage of the platform's own AI"*.
The same shape reached inference through a different door.

### 1.2 The declared TTL was not what the row cost

Every row stored `requestedTtlMs ≈ 118,700` — about two minutes — while `expiresAt` sat **two hours**
after `queuedAt`, roughly 60× the declared TTL. So expiry alone could never have been a timely
reaper, whatever the waiter asked for. This is recorded as an observation; §4 does not depend on it.

---

## 2. Research & benchmarking

The question is narrow: **what evidence entitles a claimant to keep holding a shared resource?**

- **Kubernetes node leases.** A node holds its lease by renewing it; the control plane marks it
  `NotReady` on renewal failure, not on the object disappearing. Presence never implies health.
  **Adopted:** a reservation is believed only while it is being renewed.
- **Consul / etcd session TTLs.** A session is invalidated when its TTL lapses without renewal, and
  everything it held is released. **Adopted in spirit**, with one deliberate difference: this change
  does not delete rows, it stops *counting* them. Reaping is a separate concern with its own risk.
- **The platform's own Workroom liveness rule.** `loadCapsuleLivenessInventory` states it outright —
  liveness is *"derived from lease/build/sync — never updatedAt (a daily-heartbeat artifact)"*.
  **Adopted wholesale.** The platform already knew this; host capacity was simply never held to it.

**Rejected: reaping the dead rows.** Deleting another session's lease is destructive, races with a
waiter that might still be alive, and would need its own safety argument. Narrowing what *counts*
achieves the outcome with no destructive action and no possibility of losing work.

---

## 3. Decision

**A lease reserves the host only while it proves it is alive.**

The rule narrows what counts as a reservation. It can never widen it, so it cannot admit work that
arbitration would previously have refused.

---

## 4. What was built

`leaseStillProvesLiveness(lease, now)` — a lease is believed while its last beat is within
`max(requestedTtlMs × 3, 120s)`.

- **Three missed renewals**, not one. A live waiter renews within its own TTL by definition; three
  misses is a dead owner, not a slow host. The grace is deliberate — a genuinely slow gate must
  never lose its slot.
- **A floor of 120s**, so a lease declaring an implausibly short TTL cannot self-reap seconds later.
- **`queuedAt` / `createdAt` are the implicit first beat**, so a row written moments ago is never
  judged before it has had a chance to renew.

`listCapacityReservingNonprodEnvironmentLeases` filters its result through it. Nothing else changes:
admission, queue ordering and the leases themselves are untouched.

### 4.1 Regression guards, verified to fail without the fix

Removing the filter turns two of the seven red. The suite is built from the **measured** rows — the
six real lease ids, their real timestamps, the real 2-minute-TTL-versus-2-hour-expiry pair — so it
reproduces the actual outage rather than an invented one. It also pins the directions that must not
regress: a live waiter keeps its reservation, an active lease is never evicted, a just-written row is
not reaped, and the grace boundary holds at exactly three TTLs.

---

## 5. What this does not do

It does not delete the dead rows; they age out on their own and stop mattering the moment they stop
being counted. It does not change admission, so a queue that was draining still drains the same way.
And it does not address the TTL/expiry mismatch in §1.2 — that is a real oddity, recorded for its own
decision, and this fix deliberately does not depend on it being resolved.
