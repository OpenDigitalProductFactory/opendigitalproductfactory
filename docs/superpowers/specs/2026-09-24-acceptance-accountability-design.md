---
status: active
---

# Acceptance accountability: awaiting-acceptance gets an owner, an age and a sweep

Backlog item: BI-5F3D6A37 (epic EP-AUTONOMOUS-DECIDE). Workroom WC-14AD6A20.

## 1. Problem

`awaiting-acceptance` is a legal backlog status (`apps/web/lib/backlog/transitions.ts`)
that nothing owns, ages or sweeps. Items enter it when a merge-ready PR is
submitted (`apps/web/lib/backlog/pr-submit-awaiting-acceptance.ts`), and only
the author tends to take them out. Every surface that counts delivery counts
`done` only, so an item that merged but never proved its acceptance criteria
reads the same as an item nobody started.

Measured on the development install, 2026-09-24 (Postgres, `BacklogItem`,
`WorkCapsule`, `BacklogItemActivity`, `WorkCapsuleActivity`):

| Measure | Count |
|---|---|
| items in `awaiting-acceptance` | 518 |
| created more than 30 days ago | 157 |
| with any Workroom | 128 |
| with a live (not archived/abandoned) Workroom | 121 |
| with a recorded entry (`status_change`, `payload.to = awaiting-acceptance`) | 263 |
| `reviewer-dispatch` room activities ever written | 0 |

A third of the pool arrived in the 2026-09-21 backfill (`actuator:
pr-submit-backfill`). The backfill revealed a pre-existing pool of
delivered-but-unaccepted work. It did not create one. `updatedAt` is not an
age and this design never uses it as one.

## 2. What already exists (substrate verification)

Swept on `origin/main` at `bd164881c07` (worktree of that commit), live
backlog (EP-AUTONOMOUS-DECIDE, 8 items) and open PRs (no overlap).

| Need | Existing substrate | Gap |
|---|---|---|
| What settles acceptance | `initiative-readiness` completion decision: each unmet code carries `accountableRole` and `nextAction` (`initiative-readiness/types.ts:145-160`, `readiness-guidance.ts:273-315`) | Computed on read, never recorded against the item while it waits |
| Who settles it | `resolveInitiativeReviewerRecovery` (`tak/initiative-readiness-tool-grants.ts:221`) resolves an `accountableRole` to a coworker through `INITIATIVE_READINESS_LANES` and live `AgentToolGrant`s; this is the only role-to-agent resolution and it is grant-backed | None for resolution. The `acceptance-reviewer` role maps to the `record_initiative_evidence` lane |
| A sweep that routes reviews | `dispatchOwedIndependentReviews` (`initiative-readiness/server-reviewer-dispatch.ts`, BI-A835D300), cron every 2 minutes, 5 random items per tick | Keeps only `independent` routes (`:135-137`), so the acceptance lane (`independent: false`) is computed and discarded. Candidates come only from rooms with an author OAuth connection, so the 397 items without a live room are never considered. 0 dispatches recorded on this install |
| Entry time | `BacklogItemActivity` `status_change` rows written by both entry paths (`pr-submit-awaiting-acceptance.ts:146-160`, `mcp/packs/backlog-pack.ts:448-457`); index `[kind, recordedAt]` | 255 of 518 items have no entry row (entered before the actuator existed) |
| A deterministic scheduled sweep | Weekly decision-engine review (BI-19CEC4B4): config in `packages/db/src/decision-engine-review-config.ts`, seed `seed-decision-engine-review.ts`, task kind in `operate/scheduled-jobs/agent-task-kind.ts`, branch in `actions/agent-task-scheduler.ts:252`, executor with no LLM on the path | None; this design adds a sibling task kind in exactly that shape |
| Waking a coworker without a client | Workroom drive (`queue/functions/workroom-drive.ts`): an `agent:` stage becomes a `ScheduledAgentTask` for that agent; the scheduler creates a `TaskRun` for the run (`agent-task-scheduler.ts:463`), which is what `record_initiative_evidence` objective mapping requires (`objective-mapping-repository.ts:269`) | None for mechanism. A `role:` stage becomes attention for a person (`drive-resolution.ts:288-309`), which is why the delivery shapes' `accept` stage (`role:acceptance-reviewer`) never reaches a coworker |
| A platform-convened room | `scheduled-steward` rooms upserted by idempotency key (`decision/concierge-sweep-runner.ts:147-165`) | None |

Rejected as the routing target: `DecisionResolutionProposal`. It is a queue of
doctrine rulings a person makes (`ruledByUserId`), keyed to a decision profile.
Routing acceptance there would send it to the founder, which is what this item
exists to stop.

Nothing here is new substrate. No table, no enum, no migration.

## 3. Design

### 3.1 Owed acceptance (who and what)

A pure projection, `projectOwedAcceptance(decision, author)`, over the item's
completion readiness decision:

- `owed`: every unmet or blocking requirement, each with `code`,
  `accountableRole`, `nextAction`. The specific unmet codes are the "what", not
  a role name.
- `owner`: the coworker `resolveInitiativeReviewerRecovery` resolves for the
  acceptance-family roles (`acceptance-reviewer`, `delivery-coordinator`),
  excluding the item's authoring agent. The acceptance lane is not marked
  independent, but a sweep that exists because the author did not finish must
  not route the work back to the author.
- `unroutable`: requirements with no lane or no granted coworker, carried with
  their reason. An unroutable item is reported by count and by code. It is
  never silently dropped and never defaulted to the founder.

The sweep records the projection as a `BacklogItemActivity` of kind
`acceptance_owed`, written only when it differs from the last one, so the
activity log shows who owed what and when that changed.

The snapshot is a derived read model, stated deliberately. Readiness stays the
single source of what is owed now, and every consumer that needs the current
answer recomputes it. The snapshot exists for the history: who owed what, and
since when. That history cannot be recomputed after the evidence changes. No
code reads a snapshot as the current verdict.

### 3.2 Age

`enteredAt` = `recordedAt` of the latest `status_change` activity whose
`payload.to` is `awaiting-acceptance`. When no such row exists, age is measured
from `createdAt` and marked `ageBasis: "created"`. That is an upper bound, and
the output says so rather than presenting it as entry age. `updatedAt` is never
used.

An item is **aged** at 14 days in the state. A delivery room already reviews
itself every 7 days (`delivery-shapes.ts` `reviewPoint`). Two review points
without acceptance is past the delivery appetite of every shape except
`delivery-large`, and a large item still owes acceptance within its own review
cadence. The threshold is a named constant in the sweep config.

### 3.3 The sweep

A new deterministic scheduled task kind, `acceptance-sweep`, composed exactly
like the decision-engine review: config in `packages/db/src`, an idempotent
seed, a branch in the scheduler, and no LLM on the sweep's own path. It runs
daily at 05:00 UTC, before the weekly decision review and the bookkeeping cycle.
The accountable coworker for the sweep itself is AGT-WS-PORTFOLIO, the same
steward as the decision review.

Each run:

1. Selects a bounded page of `awaiting-acceptance` items
   (`ACCEPTANCE_SWEEP_PAGE_SIZE`, default 100). Items with no `acceptance_owed`
   snapshot come first, then the items whose last snapshot is oldest. Newly
   entered items are therefore seen on the next run, and the whole pool is
   revisited every ceil(N / page) runs. Readiness is never evaluated for the
   whole pool in one tick.
2. Computes readiness and the owed projection. An item whose completion verdict
   is already `allowed` is reported as `closable`. The sweep does not close it:
   closing stays the terminal transition's decision, made through its gate.
3. Records changed `acceptance_owed` snapshots.
4. Routes aged items, oldest first, up to `ACCEPTANCE_SWEEP_ROUTE_LIMIT` per
   run (default 10). The bound serves responsible capacity use: 157 aged items
   routed at once would be 157 model runs in one tick.
5. Writes one run summary to the standing `Acceptance` steward room: counts by
   age band, routed, closable, unroutable by code, and `ageBasis: created`
   count.

### 3.4 Routing to a coworker

A routed item gets a `scheduled-steward` Workroom, upserted by idempotency key
`acceptance:<itemId>`, with an owner user (the install's operator, as the
decision-review seed does). The room names the item through `outcomeAnchor`
(`kind: backlog-item`), **not** `backlogItemId`. A live room bound through
`backlogItemId` counts as live ownership, and the author's own re-claim would
be refused (`work-capsules/backlog-workroom-ownership.ts:51,90-123`). The
steward room verifies the work; it does not own it. Its single stage is
`agent:<owner>`. The advance is **not** a governed decision: the stage is
"verify the unmet acceptance criteria on the live install and record the
evidence", and it completes when the evidence is recorded. The drive dispatches
it through the existing `ScheduledAgentTask` path. The prompt names the item,
each owed code and its `nextAction`, and the item's acceptance criteria.

The protection stays where it is. Recording evidence changes no status. Moving
the item to `done` still passes the completion readiness gate, and a coworker
cannot satisfy an independence requirement it is excluded from.

Why a coworker and not the founder: under
`principles/escalation-is-a-gate-not-a-trust-tier`, a person is engaged only
when an action is damaging or nothing recorded can steer it. Verifying acceptance
criteria and recording evidence is not outward, irreversible or
authority-changing, and the sweep is a scheduled mandate, which is one of that
page's named steering sources. An item whose acceptance does meet a human
condition (an owed code whose governing gate declares consequence) stays
unroutable-to-agent and is reported so. It is never routed silently.

When a routed room has run and the item is still not accepted on the next
sweep, the room is not re-created. The drive's own writeback latch and review
point govern it, and the sweep reports it as `routed-unresolved` with its age.

### 3.5 Delivered is not accepted, on the surfaces

The Ops backlog epic progress (`components/ops/OpsClient.tsx:70-71`) and the
command-center summary (`lib/workspace-home/command-center.ts:346-348`) count
`done` only. Both gain an `awaiting acceptance` count beside `done`, with the
aged share shown, so merged-but-unproven work is visible and never reads as
finished. Colours use `--dpf-*` tokens (AGENTS.md §9).

## 4. Research and benchmarking

| System | Mechanism | DPF adopts | DPF rejects |
|---|---|---|---|
| ServiceNow Incident: `Resolved` then `Closed` | A resolved incident awaits caller confirmation and auto-closes after N days (`glide.ui.autoclose.time`) | A distinct resolved-but-unconfirmed state with a clock on it | Auto-close on timeout. Silence is not acceptance, and `structural-verification-is-not-functional` forbids treating it as one |
| GitLab `gitlab-triage` policies | Scheduled, declarative sweeps over issues by age and label that mention or reassign an owner | A deterministic scheduled sweep keyed on age, routing to an owner, idempotent per run | Label-driven ownership. DPF resolves the owner from grant-backed readiness lanes, not a free-form label |
| Jira Service Management SLAs | A clock per state with breach and at-risk thresholds, shown on the work item | Age measured from state entry, not last update, and shown where delivery is reported | Per-project SLA configuration. One named threshold serves every install until evidence says otherwise |
| Kubernetes controllers | Level-triggered reconcile: recompute desired state each pass, act on the difference | Recompute owed acceptance each run; write a snapshot only when it changed | Nothing |

Standard followed: level-triggered reconciliation with bounded work per pass.

## 5. Acceptance criteria

- **AC-AA-01** Every `awaiting-acceptance` item has a recorded `acceptance_owed`
  activity within one sweep of entering the state (unsnapshotted items are paged
  first). The activity names the
  specific unmet codes and the resolved owner, or the unroutable reason.
- **AC-AA-02** Age is measured from state entry. A missing entry row is reported
  as `ageBasis: created` and is never presented as entry age.
- **AC-AA-03** Aged items are routed to a coworker through a steward Workroom
  whose drive dispatches that coworker, with at most the configured limit per
  run. No aged item is routed to a human unless a human condition applies, and
  then it is reported, not routed.
- **AC-AA-04** Proved live on the development install: one aged item, routed by
  a real sweep run, has its acceptance evidence recorded by the dispatched
  coworker, with no human action and no attached AI client.
- **AC-AA-05** The Ops epic progress and command-center show awaiting-acceptance
  (and its aged share) distinctly from done.
- **AC-AA-06** Over the four weeks after deploy, the count of items aged over 30
  days in the state trends down. Measured by the sweep's own run summaries.

## 6. Slices

1. **Owed acceptance and age**: the pure projection and age function, the
   `acceptance_owed` snapshot writer, unit tests. No routing.
2. **The sweep**: config, seed, task kind, scheduler branch, executor, run
   summary room. Routing is off until slice 3 lands.
3. **Coworker routing**: the steward room per aged item, the agent stage, the
   bounded route limit, live proof (AC-AA-04).
4. **Surfaces**: awaiting and aged counts on Ops epic progress and
   command-center, UX-verified.

Each slice is one PR. The implementation plan lives at
`docs/superpowers/plans/2026-09-24-acceptance-accountability-plan.md`.

## 7. Scale

Per run, the sweep does at most `PAGE_SIZE` readiness evaluations and
`ROUTE_LIMIT` room upserts. Both are constant in the pool size. The ceiling it
holds: a pool up to about 100 × the revisit window. That is 3,000 items at a
30-day revisit with the defaults, per install. Installs are independent, so
the fleet size never enters the sweep. A pool past that ceiling is reported in
the run summary, which states the revisit period so it stays visible, and the
remedy is raising the page size, not a redesign.

## 8. Out of scope

- Fixing `dispatchOwedIndependentReviews` recording zero dispatches on this
  install. That is a separate defect and needs its own evidence first.
- Changing the delivery shapes' `accept` stage from `role:` to an agent. The
  steward room carries the agent stage, so the delivery shape keeps its human
  governed decision for rooms the author drives.
- Closing items automatically.
