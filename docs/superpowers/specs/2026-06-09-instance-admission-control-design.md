---
title: Instance Concurrency Admission Control — backpressure + priority lanes for Inngest workloads
date: 2026-06-09
status: draft
relates_to:
  - BI-70D19D15 (self-upgrade substrate: produces no run under load)
  - BI-17377D05 (quiescence orphans/waits on stalled build phases)
  - BI-957970CA / EP-BUILD-4DB1C0 (portal unrecovered after self-upgrade)
  - BI-2E6CC391 (concurrent Feature Builds)
  - EP-UPGRADE-LIFECYCLE
principles:
  - structural-verification-is-not-functional
  - evidence-before-diagnosis
  - proper-fix-over-quick-fix
---

# Instance Concurrency Admission Control

## 1. Problem (evidence-grounded)

On a single instance, the portal becomes unresponsive and self-upgrades silently
fail to run when **too many AI sessions and Build Studio builds are active at
once**. Observed live over one session (2026-06-07 → 06-09):

- **`Upgrade now` produces no self-upgrade run.** `triggerSelfUpgrade`
  (`apps/web/lib/actions/promotions.ts:716`) correctly *queues* an event
  (`inngest.send({ name: SELF_UPGRADE_EVENT })`, returns `{queued:true}`), but
  the Inngest function that builds+deploys never gets scheduled — so the deployed
  bundle stays stale and merged fixes never go live. Two manual triggers, zero
  runs.
- **Build orchestrator stalls / drops builds** mid-phase; phase jobs die on
  portal recycles with no resume.
- **Plan-review loops crawl** (9 rounds over hours) — reviewer functions queued
  behind the load.
- **designDoc evidence lands late or on the wrong build** — contention amplifies
  the races (and the separate buildId bug, fixed in #1640).
- **localhost goes unresponsive** until the operator restarts the browser — the
  web server itself is starved of CPU.

These are not independent bugs. They share one root cause.

## 2. Root cause

Every heavy workload on the platform runs as an **Inngest queue function**:
self-upgrade, build dispatch (ideate/plan/build), dual reviewers, agent-task
dispatch, verification, etc. Each declares a tight *per-function* concurrency
(`concurrency: { limit: 1, scope: "fn" }` or `[{ limit: 2 }]` — see
`apps/web/lib/queue/functions/*`). But:

1. **There is no GLOBAL admission control** spanning builds *and* interactive
   sessions. Per-function limits don't bound the *aggregate* in-flight work, so N
   concurrent builds (each fanning out to orchestration + 2 reviewers + per-task
   CLI dispatches) plus M chat sessions saturate the shared instance capacity.
2. **No priority lane for critical functions.** A queued self-upgrade event sits
   behind the flood; the deploy that would *relieve* the situation is itself
   starved.
3. **Dead/stalled builds aren't reaped** — they hold slots, runtime targets, and
   "active" phase rows (`completedAt: null`), counting against capacity and
   against the self-upgrade quiescence drain (one build was 12.6 h quiet yet
   still blocking; see BI-17377D05).

Net: the instance degrades by **wedging** (everything contends and nothing
completes) instead of **queuing** (admit what fits, defer the rest).

## 3. Goal

Graceful degradation under load: the platform **queues** excess work instead of
saturating, **always reserves capacity for the deploy/recovery path**, and
**surfaces** what is holding capacity — so a self-upgrade can always run, builds
complete (slower, not never), and localhost never wedges.

## 4. Design

### 4.1 Instance concurrency budget
A single shared accounting of in-flight *heavy* work — builds (by phase) and
heavy agent sessions — with a configurable per-instance cap (sized to CPU/RAM,
not unbounded). This is the admission unit: work is *admitted* only if the budget
has room.

- Reuse/extend the existing `SandboxSlot` pool (PR #887) as the build side of the
  budget; add a session/agent dimension so chat-driven heavy work also draws from
  it.
- Express the cap as config (operator-tunable), defaulting conservatively.

### 4.2 Admission control / backpressure
When the budget is full:
- **New build dispatches queue** rather than dispatch — the build sits in an
  explicit `queued` state with operator-visible "N ahead", not a half-started
  orchestration that contends.
- **New heavy sessions** get backpressure (a clear "instance at capacity, queued"
  signal) instead of silently degrading.

Inngest supports this via global concurrency keys / throttle on the dispatch
functions; the budget check gates `inngest.send` for new heavy work.

### 4.3 Priority lanes (the keystone)
Reserve a **dedicated slice of capacity for critical functions** — self-upgrade
build+deploy, and sandbox recovery — so they can always drain even when builds
saturate the rest. Concretely: the self-upgrade function runs in its own
concurrency lane that the build/agent flood cannot consume. This directly fixes
BI-70D19D15 ("Upgrade now produces no run"): the deploy that relieves load is
never starved by the load.

### 4.4 Dead-work reaping
A phase quiet beyond a liveness threshold (e.g. 15 min with no observable signal)
**releases its budget** and is drainable immediately — instead of holding a slot
and blocking the self-upgrade quiescence for a fixed 30-min timeout (BI-17377D05).
Liveness = last observable signal age (already computed:
`quietAgent.minutesQuiet` / `lastObservableSignalAt`), not merely
`completedAt == null`.

### 4.5 Observability
Surface, per instance: current budget usage, queue depth, and *what* is holding
capacity (which builds/sessions, with last-activity age). The self-upgrade screen
should show "waiting on N builds — oldest silent 12.6 h" rather than a bare
30-minute countdown, so an operator can see corpses vs. live work (the
observability gap noted alongside BI-17377D05).

## 5. Phasing

- **Phase 1 — unblock the deploy (smallest, highest leverage).**
  - Self-upgrade **priority lane** (4.3) so `Upgrade now` always runs.
  - Dead-work reaping (4.4) so quiescence drains past corpses.
  These two alone make merged work actually deployable under load.
- **Phase 2 — global admission control + backpressure (4.1, 4.2).** The instance
  budget + queue-don't-saturate behavior for builds and sessions.
- **Phase 3 — observability surface (4.5).** Budget/queue/holding visibility on
  the self-upgrade + build screens.

## 6. Verification note

This capability **cannot be verified by structural checks alone** — it must be
exercised under real concurrent load (multiple builds + sessions) to confirm the
instance *queues* instead of wedging and that the self-upgrade lane drains. That
requires a non-saturated portal to test against, which is itself the constraint;
implementation should land behind a flag and be load-tested deliberately, not
blind-shipped to the deploy path.

## 7. Recommended Phase-1 slice

**Self-upgrade priority lane + dead-work reaping.** It is the keystone: it makes
every already-merged change (and every future one) actually deploy under load,
without the larger admission-control build. Everything else in this spec is the
durable follow-on once the deploy path is reliable.
