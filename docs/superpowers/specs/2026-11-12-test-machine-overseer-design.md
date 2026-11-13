---
status: draft
---

# Test-machine overseer: policy-ordered, fair, bounded lease admission

**Backlog:** BI-218A4555 (epic EP-INPLATFORM-CODING, milestone M1). **Workroom:** WC-230F1C07.
**Decision:** DI-2C6093E878DC, `extend-pure-planner` (composite 12.993 against 8.873 for a weighted score and 6.424 for a separate overseer service; margin 4.12, high confidence, no commandment conflict).
**Related:** BI-995E9530 (preview bounded hold, done), BI-B1CB7EC3 (self-admission), BI-D35B85BF (abandoned waiters), BI-0B1DF949 (active-only inference deferral), BI-88D51B8F / PR #6888 (routine release), WC-400B4A63 / DI-4358575D0EF0 (bounded review-turn custody, draft, separate slice).

## Problem

Shared test machines are leased through `NonProductionEnvironmentLease`. Admission is first-come (`planEnvironmentAdmission` sorts by `queuedAt`) and a holder may renew forever. Only one bound exists: a contributor preview yields after 20 minutes while a gate waits (BI-995E9530).

Observed on production:

- Previews held `local-integration-ci:slot-0` for hours, renewing every couple of minutes, and re-took the slot right after letting it go (BI-218A4555 evidence, 2026-11-03/04).
- Ad-hoc served-target verification leases held the slot for 151 and 175 minutes (14-day read of `NonProductionEnvironmentLease`, 2026-11-12). Gates in the same window: p50 3 min, p95 9 min, max 12 min.
- Local AI reviews do not take leases. They defer while any gate is active (`inspectLocalProviderCapacity`) and recheck on a 30 s to 5 min backoff. Back-to-back gates leave no gap they reliably hit, so a review can wait indefinitely.
- The owner had to referee a live hold through his inbox.

M1 go criterion: no test-machine hold exceeds its class bound while others wait.

## Research

| Comparable | What it does | DPF adopts | DPF rejects |
| --- | --- | --- | --- |
| Kubernetes API Priority and Fairness (KEP-1040) | Priority levels; within a level, fair queuing across flows (shuffle-sharded queues) | Priority tiers; fairness across flows, where a flow is a session and its executor | Shuffle sharding and seat accounting: there are one or two slots, not hundreds of concurrent requests |
| Slurm multifactor priority, fair-share and QOS `MaxWall` | Weighted numeric score of age, fair-share usage and QOS; per-QOS wall-clock limit | Age, recent-usage fair share and a per-class wall limit | A tunable weighted score: an operator cannot predict the order without the weights, and the kernel scored it lower on legibility |
| Deficit / weighted round robin (Shreedhar and Varghese, 1995), Linux CFS virtual runtime | A flow that was just served waits a bounded deficit before it is served again | Virtual start time: a recently served session's wait is discounted by a fixed, bounded amount, so it can never starve and cannot re-take a slot ahead of others | Per-packet quanta |
| Jenkins Lockable Resources, GitHub Actions concurrency groups | FIFO lock with optional priority; no hold bound | Nothing new: this is the status quo that failed | First-come order and unbounded holds |

Standard followed: priority classes with fair queuing inside a class and a bounded per-class hold, as in Kubernetes APF and Slurm QOS. Deviation: order is a lexicographic key, not a weighted sum, so every position has a one-sentence reason.

## Existing substrate (extended, not replaced)

- `environment-lease-admission.ts` `planEnvironmentAdmission`: the pure planner. Only its waiter order changes. Self-admission (a claim admits only itself) and proof of life stay as they are.
- `environment-lease.ts`: claim, renew, release and reap call the planner under the environment advisory lock. They now pass recent service history to it and report the policy position.
- `environment-lease-preview-yield.ts`: becomes one case of the general hold bound.
- `durable-wait.ts` `publishNonprodCapacityForHead`: wakes the policy head instead of the oldest row.
- `routing/local-provider-capacity.ts`: records local AI demand when it defers, and consumes the turn when it proceeds.
- `lease-queries.ts` (`list_nonprod_environment_leases`), the claim result and the gate client show position, estimate and reason.
- No schema change. Class comes from existing columns (`claimKey`, `resourceClass`, `environmentKey`); fairness history comes from existing `admittedAt`, `releasedAt` and `ownerSessionId` / `ownerProvider`; yield is recorded in `phase`.

## Policy (`overseer.v1`)

### Classes

Derived on the server from the lease; a client cannot name its own priority.

| Environment | Class | Matched by | Tier | Contended hold bound |
| --- | --- | --- | --- | --- |
| local-integration-ci | gate | `claimKey` starts `gate:` or `local-ci:` | 0 | 30 min |
| local-integration-ci | ai-turn | `claimKey` starts `inference-turn:` | 0 | not admitted (see below) |
| local-integration-ci | verification | any other claim | 1 | 45 min |
| local-integration-ci | preview | `claimKey` starts `dev-portal:` | 2 | 20 min (unchanged) |
| host-heavy-resource | ai-turn | `resourceClass` `semantic-review` or `inference` | 0 | 45 min |
| host-heavy-resource | check | `typescript`, `vitest`, `next-build`, `docker-build` | 1 | 45 min |
| host-heavy-resource | preview | `resourceClass` `preview` | 2 | 20 min |
| active-candidate | candidate | all | 0 | none (unchanged) |

Bounds sit above the observed p95 of each class, so they stop runaway holds and do not cut normal runs.

### Order

Live waiters in one environment are ordered by this key, first difference wins:

1. **Effective tier.** Class tier, improved by one step for every 30 minutes waited. Gates and AI turns come first; previews cannot be starved forever.
2. **Class turn (tier 0 only).** When gates and AI turns both wait, the class admitted least recently in this environment goes first. They alternate.
3. **Virtual start time.** `max(queuedAt, sessionLastServed + 10 min, executorLastServed + 2 min)`. Last served is the latest admission by that `ownerSessionId` (or `ownerProvider`) in the last 60 minutes, or now while it still holds a slot here. A session that just released cannot re-take the slot ahead of others, and the discount is bounded, so it cannot starve.
4. `queuedAt`, then id.

Portfolio priority (BI-7138C61B) is not on the lease and is not used in v1.

### Bounded holds

Contended means at least one waiter in the same environment proves liveness and belongs to another session. On renewal:

- uncontended: unchanged;
- contended and within the bound: the new expiry is capped at `admittedAt + bound`;
- contended and at or past the bound: renewal returns `lost` / `yielded`, and the lease `phase` records `yielded:<class>:hold-bound`.

Existing supervisors already fence the process on `lease_lost`. The reservation then ends on release or at its 2-minute TTL.

### Local AI turns (reviews)

When a local AI dispatch is deferred by an active gate, the server upserts one queued `inference-turn:local` lease (owner `coworker` / `local-inference`). It proves liveness for 6 minutes after each deferral, longer than the 5-minute review recheck ceiling. While it is live and first in policy order, no gate admits itself past it, so the slot stays free for the next local dispatch check. That check proceeds and settles the turn (`released`, phase `served`), and the class turn then favours gates. If no review returns within 6 minutes, the turn stops blocking. One turn costs at most 6 idle minutes. WC-400B4A63's release-time wake would remove that idle time; this design does not depend on it.

### Visibility

Every queued claim result, durable-wait checkpoint and `list_nonprod_environment_leases` entry carries:

- `queuePosition` in policy order;
- `estimatedWaitMs`: the shortest remaining active hold (bounded by its class bound when contended), plus the typical hold of each waiter ahead, divided by capacity. Typical hold is the 60-minute median for the class, or the class default;
- `queueReason`: one sentence, for example "2 ahead: a gate and an AI review turn (gates and reviews alternate)";
- `policyVersion: overseer.v1`.

Active entries carry `holdClass`, `holdBoundAt` and `contended`. The gate client prints the estimate next to the position.

## Objectives and acceptance

**OBJ-OVS-1:** Mandatory work (gates and local AI turns) is never starved by optional work or by each other.
**OBJ-OVS-2:** No session or executor can monopolise a class by renewing or re-taking.
**OBJ-OVS-3:** No hold exceeds its class bound while others wait.
**OBJ-OVS-4:** The queue explains itself to agents and the owner.

| Acceptance ID | Objective | Statement |
| --- | --- | --- |
| AC-OVS-1 | OBJ-OVS-1 | A queued gate or AI turn is admitted before an older queued preview or verification. Under continuous gate arrivals, a live AI turn is admitted within one gate hold; under continuous AI demand, a gate is admitted within one turn. |
| AC-OVS-2 | OBJ-OVS-1 | Any waiter rises one tier per 30 minutes, so a preview's wait is bounded. |
| AC-OVS-3 | OBJ-OVS-2 | A session that held the slot within 10 minutes is ordered behind another session's waiter that queued up to 10 minutes later, and never further back. |
| AC-OVS-4 | OBJ-OVS-2 | With N sessions continuously re-queuing, each is admitted at least once per N admissions. |
| AC-OVS-5 | OBJ-OVS-3 | A contended renewal never sets `expiresAt` past `admittedAt + bound`; past the bound it returns `yielded` and records the phase. Uncontended renewals are unchanged. |
| AC-OVS-6 | OBJ-OVS-3 | A waiter from the holder's own session, or one without proof of life, does not count as contention. |
| AC-OVS-7 | OBJ-OVS-4 | Claim results and the list tool show policy position, estimate, reason and policy version; active holds show class bound and contention. |
| AC-OVS-8 | OBJ-OVS-1 | The durable-wait wake goes to the policy head. |

## Compatibility and rollback

No schema change and no new tool. Existing clients read the same fields, with the extra ones ignored. The preview yield keeps its `yielded` reason. `active-candidate` keeps first-come order. Rollback is a code revert; no data needs migrating, and `inference-turn` rows expire on their own within 10 minutes.

## Out of scope

- Original-task custody and wake-on-release for parked reviews (WC-400B4A63).
- Portfolio priority in the order (BI-7138C61B).
- Sessions that churn their own `ownerSessionId` to dodge fair share. The executor term limits the effect; provenance-bound identity is a follow-up.
