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
   snapshot come first, then snapshotted items round-robin from a cursor the
   previous run recorded. (Ordering by oldest snapshot would stall: a snapshot
   is written only on change, so an unchanged item's snapshot never gets
   newer.) Newly entered items are therefore seen on the next run, and the
   whole pool is revisited every ceil(N / page) runs. Readiness is never
   evaluated for the whole pool in one tick.
2. Computes readiness and the owed projection. An item whose completion verdict
   is already `allowed` is reported as `closable`. Under a recorded operator
   pre-authorisation the sweep closes it through the terminal transition, whose
   gate decides (§3.6, BI-45D3BBF4); without one it only reports it.
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

### 3.6 Closing what the gate already allows (as built, BI-45D3BBF4)

Measured 2026-10-07: about 298 of 685 awaiting-acceptance items pass delivery
and acceptance on merge evidence, so their completion gate allows `done`, and
nothing performed the close. These need no judgment, only an authorised actor.

**The authorisation.** One `PlatformConfig` row,
`acceptance-sweep.close-authorisation`, value
`{ schemaVersion: 1, scope: "close-when-gate-allows", enabled, setByUserId,
setAt, reason, maxClosuresPerRun, revokedByUserId?, revokedAt?, revokeReason? }`
(`lib/backlog/acceptance-sweep/close-authorisation.ts`). It defaults to absent,
which means disabled. The governed writer is two server actions,
`grantAcceptanceSweepCloseAuthorisation` and
`revokeAcceptanceSweepCloseAuthorisation`
(`lib/actions/acceptance-sweep-close-authorisation.ts`), restricted to a user
holding both `manage_platform` and `manage_backlog`, with a reason of at least
12 characters. A revocation keeps the grant's provenance and adds its own; the
row is never deleted.

**Checked at every run, against current state.** The record must parse, carry
the scope, and be enabled; the operator who recorded it must still be active and
still hold `manage_backlog` (`currentUserContext` + `can`); and the sweep's
coworker must hold a stored grant (`getAgentToolGrantsAsync`, never registry
defaults) that satisfies `update_backlog_item_status`'s mapping. Any failure
disables closing for that run, and the summary's `closing.disabledReason` /
`closing.because` say which: `not-recorded`, `malformed`, `out-of-scope`,
`revoked`, `operator-not-authorised`, `agent-not-granted`, `unavailable`.

**The closure.** Only an item whose projection is `closable` *and* whose
completion decision's verdict is `allowed` is passed on; the close module also
refuses any other verdict before calling anything. It re-reads the row, skips an
item no longer in `awaiting-acceptance`, and calls
`completeBacklogItemTransition` (the same boundary as the MCP status tool, the
backlog editor and the ops route) with:

- actor `{ actorType: "agent", actorRef: AGT-WS-PORTFOLIO, humanContextRef:
  <authorising operator>, agentContextRef: AGT-WS-PORTFOLIO }`;
- authority `actionKey: update_backlog_item_status`, snapshot
  `effectiveHumanCapability: manage_backlog`, `effectiveAgentGrant: <held
  grant>` (today `backlog_write`, already in the seed; no grant was added), and
  a rationale citing the pre-authorisation (key, scope, who, when, reason);
- `completionEvidence` citing the readiness decision acted on and each satisfied
  requirement's evidence refs.

The transition re-evaluates its own gate in a serializable transaction and
writes the authority decision log and readiness receipt, so a verdict that went
stale since the read is refused there and reported as `refused`.

**Bound and report.** At most `maxClosuresPerRun` per run (default 25, max 100,
never more than the page). The run summary gains `closing`: enabled, reason,
`authorisedBy`, limit, attempted, `closed` ids, `refused` (id, code), `skipped`,
`errored`, and `deferredByLimit`. The headline says how many were closed, or
`closing off (<reason>)`.

**Known limit.** The sweep's verdict comes from the `get_backlog_item` read
projection, which does not evaluate the merge-through-gates signal for items
that are not yet `done`. Items whose `allowed` verdict depends only on merge
recognition may therefore read `input-required` on the sweep and not be closed;
whether the live count falls (AC-5) is to be measured on the install after
enabling, not assumed.

## 4. Research and benchmarking

| System | Mechanism | DPF adopts | DPF rejects |
|---|---|---|---|
| ServiceNow Incident: `Resolved` then `Closed` | A resolved incident awaits caller confirmation and auto-closes after N days (`glide.ui.autoclose.time`) | A distinct resolved-but-unconfirmed state with a clock on it; since §9, the auto-close on timeout too, for the customer question only | (Until §9) auto-close on timeout |
| GitLab `gitlab-triage` policies | Scheduled, declarative sweeps over issues by age and label that mention or reassign an owner | A deterministic scheduled sweep keyed on age, routing to an owner, idempotent per run | Label-driven ownership. DPF resolves the owner from grant-backed readiness lanes, not a free-form label |
| Jira Service Management SLAs | A clock per state with breach and at-risk thresholds, shown on the work item | Age measured from state entry, not last update, and shown where delivery is reported | Per-project SLA configuration. One named threshold serves every install until evidence says otherwise |
| GitHub auto-merge | A maintainer opts a PR in; it merges only once every required check and review passes, and the opt-in is revocable and attributed | §3.6: an explicit, attributed, revocable opt-in; the action fires only when the existing gate already passes | A per-object opt-in. One install-wide scope suits a pool of hundreds of items |
| Jira Automation rule actor | Rules act as a named actor ("Automation for Jira" or a chosen user), recorded in the history | §3.6: the closure records the steward coworker as actor in the authorising operator's human context | A free-form rule language. The only rule here is "the gate allows" |
| Renovate `automerge` | Off by default; enabled per config; merges only when tests pass; bounded by `prConcurrentLimit` / `prHourlyLimit` | §3.6: default off, gate-conditional, bounded per run | Platform-native automerge that bypasses the bot. Every closure goes through DPF's own transition |
| Kubernetes controllers | Level-triggered reconcile: recompute desired state each pass, act on the difference | Recompute owed acceptance each run; write a snapshot only when it changed | Nothing |

Standard followed: level-triggered reconciliation with bounded work per pass.

## 5. Objectives and acceptance criteria

- **OBJ-AA-1:** Every item in awaiting-acceptance records who owes its acceptance and which unmet readiness codes would settle it.
- **OBJ-AA-2:** Time in awaiting-acceptance is measured from state entry and visible where delivery is reported.
- **OBJ-AA-3:** Aged awaiting-acceptance items are routed automatically to an accountable coworker, never by default to the founder.

| Criterion | Objective | Statement |
|---|---|---|
| AC-AA-01 | OBJ-AA-1 | Every awaiting-acceptance item has a recorded acceptance_owed activity within one sweep run of entering the state, naming the specific unmet codes and the resolved owner or the unroutable reason. |
| AC-AA-02 | OBJ-AA-2 | Age is measured from the latest state-entry activity; an item without one is reported with ageBasis created and never presented as entry age; updatedAt is never read. |
| AC-AA-03 | OBJ-AA-3 | Aged items are routed to a coworker through a steward Workroom whose drive dispatches that coworker, at most the configured route limit per run; an item with no granted coworker is reported unroutable, not routed to a person. |
| AC-AA-04 | OBJ-AA-3 | On the development install, one aged item routed by a real sweep run has its acceptance evidence recorded by the dispatched coworker with no human action and no attached AI client. |
| AC-AA-05 | OBJ-AA-2 | The Ops epic progress and the command-center summary show awaiting-acceptance and its aged share distinctly from done. |
| AC-AA-06 | OBJ-AA-2 | Every sweep run records the count of items aged over 30 days in its run summary, so the trend is measured by the platform rather than asserted. |

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
- ~~Closing items on a timeout or on silence.~~ Superseded for non-customer
  work by §9 (operator direction 2026-10-27): delivery evidence closes the
  item, and a customer-reported item's one confirmation question is satisfied
  by silence after a bounded window. Closures still go only through §3.6's
  governed transition under the recorded operator pre-authorisation.

## 9. Closure follows delivery (operator direction 2026-10-27)

Backlog item: BI-C899BB40. Absorbs the closure half of BI-B1B44777. This
section supersedes §8's "never on a timeout or on silence" for work no
customer reported, and the "acceptance remains a separate verification
obligation" wording of §3.6 and of the delivery-closeout addendum
(`2026-09-04-delivery-closeout-cost-efficiency-design.md`).

### 9.1 The direction

> "We seem to have more process gates than needed, the actual closure is
> predicated on seeing results, which unless it's automatable, we don't want
> to have open items hanging out forever. We have LOTS of items remaining open
> and no thread to close them automatically. I can't imagine this is how most
> organizations work, as getting validation is really only required if there
> is a customer reported thing, and even then a simple question and response
> would do it." (Mark Bodman, owner of platform doctrine, 2026-10-27)

Measured on the production install the same day: 352 items in
`awaiting-acceptance`, 318 of them older than seven days, 105 owing
`ACCEPTANCE_EVIDENCE_REQUIRED` and nothing else. Done items closed by
canonical deployment were re-selected by the sweep on every run because their
`acceptanceObligation` was `pending-independent-verification`, which nothing
could discharge.

### 9.2 The rule

1. **Delivery evidence closes every shape.** A merge through CI, the merge
   queue and PR review (a SHA reachable from `origin/main`) or a canonical
   deployment is delivery. A hand-built completion manifest keeps its own
   lanes (operational, documentation, small-shape acceptance). When delivery
   passes, `ACCEPTANCE_EVIDENCE_REQUIRED`, `OBJECTIVE_BASELINE_REQUIRED` and
   `OBJECTIVE_RECONCILIATION_REQUIRED` are `not-applicable` at completion
   (`projectDeliveryClosure`, `deployment-closure.ts`). This holds for small,
   medium, large and unshaped items. Other unmet completion codes keep their
   meaning.
2. **Recorded failure still blocks.** The newest evidence in any dimension
   being a failure (BI-4A222439), an objective reconciliation that failed, a
   conflicting or malformed baseline, and an xlarge aggregate whose children are
   not delivered all keep the item open. A merge never outranks a failure.
3. **Automated checks are the only other post-delivery gate.** An acceptance
   check declared at filing and run by the platform (BI-B1B44777) is the lane
   for "not obvious" outcomes. No such declaration exists in the substrate
   today, so nothing waits on one; when BI-B1B44777 adds it, a declared check
   that has not yet run holds the close and is the only thing that does.
4. **No indefinite obligation.** The terminal transition records
   `acceptanceObligation` on every delivery closure:
   - `satisfied` when acceptance evidence passed;
   - `corrective-work-required` when a deployment closure carried a failed
     acceptance;
   - `not-owed` for work no customer reported;
   - `pending-submitter-confirmation` for customer-reported work.
   `pending-independent-verification` is no longer written. A legacy done item
   carrying it is re-selected only if it is customer-reported, and then only to
   ask its one question. Every other legacy item is treated as `not-owed`.
5. **Customer-reported work gets one question.** `isCustomerReported`
   (`backlog-completion-evaluation.ts`) reads the provenance that exists:
   lifecycle tag `ecosystem-inbound`, the origin markers
   `[origin:ecosystem-upstream-issue:`, `[origin:ecosystem-peer-demand:`,
   `[origin:federatedDemand:` and `[origin:founderDemandCluster:`, a `BI-PIR-`
   id, or a `Source report:` line (`actions/quality.ts`). `upstreamIssueNumber`
   is not a customer signal: the issue bridge sets it when this install files
   its own item upstream, and the bridge already comments when that item closes.
6. **The question, its answer and its clock.** The sweep sends the question
   once, records it as a `submitter_confirmation` activity, and observes the
   answer on later runs:
   - GitHub origin: one comment through `GitHubForgeAdapter.commentOnIssue`,
     authenticated with the managed-repository controller credential. With no
     controller credential it records `question-not-sent` (`no-credential`)
     and the clock still runs. The item is never held.
   - A transient send failure (network, 5xx, rate limit) is recorded as
     `question-attempt-failed` and retried on later runs, at most three
     attempts in all (`SUBMITTER_QUESTION_MAX_ATTEMPTS`). A permanent one (no
     credential, 403, 404) is recorded once as `question-not-sent` and not
     retried. After the last attempt the sweep records `question-not-sent`
     and stops.
   - Founder demand cluster: one disposition notice through
     `queueFounderDispositionNotices`, under its own notice identity so the
     peer does not dedupe it against the original acceptance notice.
   - Any other customer origin: `question-not-sent` (`no-channel`).
   - Answer: the inbound re-poll records the source issue's state changes as
     `intake_origin` rows (`backlog-origin-reconciliation.ts`). The issue
     reopened after the question means "not fixed": `fileAcceptanceMiss` files
     one corrective item and the original stays done. Closed by the submitter
     means confirmed. No change within 14 days
     (`SUBMITTER_CONFIRMATION_WINDOW_DAYS`) is `satisfied-by-silence`. Each
     outcome is recorded with `resolved: true`, and a resolved item is never
     selected again.
   - A reply comment is not read: the inbound reader polls issue state, not
     comments. The question asks the submitter to reopen the issue if the
     change did not fix it. That is the signal the platform can observe.
7. **Drain.** The sweep keeps §3.6's governed close and pre-authorisation.
   Items with delivery evidence now read `allowed` and are closed. Items
   without it stay where they are. The default per-run bound rises from 25 to
   100 (`DEFAULT_CLOSE_LIMIT`, the existing maximum), so the measured pool
   drains in about four daily runs. A recorded authorisation that names its
   own bound keeps it (the live record says 25). The Admin card shows the
   bound; to raise it, the operator stops closing and allows it again with
   the higher number.

### 9.3 Research

| Practice | Mechanism | DPF adopts |
|---|---|---|
| Scrum / Kanban Definition of Done | An increment is done when it meets the team's DoD at merge or deploy; nobody re-opens a ticket to prove it again | Delivery evidence is the DoD |
| GitHub / Linear / Jira auto-close on merge | `Fixes #N` closes the issue when the PR merges; Linear and Jira move the ticket to Done on merge | Merge closes the item; no separate acceptance step |
| DORA continuous delivery guidance | Post-deployment verification is automated (tests, monitors, rollbacks), not a manual approval gate | Only an automated, declared check may hold a delivered item |
| Zendesk / Intercom solved-to-closed | A solved ticket asks the requester "did this fix it?"; a reply reopens it, silence auto-closes after a set number of days | The one-question lane, with a 14-day window and the corrective item as the "reopen" |
| Harness 2 (arXiv 2610.14224) | An agent loop runs under a bounded budget, always concludes, and compares outcomes without a separate verifier | Every obligation has a bound: one question, one window, one recorded outcome |

Rejected: holding delivered work open for an independent reviewer when no
customer is waiting. It produced the 352-item pool and no extra assurance:
any later defect is reported by whoever uses the change and becomes a new item.

### 9.4 Acceptance

| Criterion | Statement |
|---|---|
| AC-CFD-1 | A merged, green, non-customer item reaches done with `acceptanceObligation: not-owed` and is never selected by the sweep again. |
| AC-CFD-2 | A customer-reported item closes on delivery and gets exactly one question. A negative answer files one corrective item. Silence past the window records `satisfied-by-silence`. The question is never repeated. |
| AC-CFD-3 | The sweep closes awaiting-acceptance items whose delivery evidence passes, within the per-run bound, and leaves items without delivery evidence untouched. |
| AC-CFD-4 | The principles and this specification describe the behaviour that ships. |
