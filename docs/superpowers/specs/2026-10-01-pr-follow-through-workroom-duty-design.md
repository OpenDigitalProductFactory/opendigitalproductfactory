---
status: draft
---

# PR follow-through is a Workroom duty

**Date:** 2026-10-01 · **Backlog:** BI-88341B5D · **Epic:** EP-4614F35E (Proactive Review Drive)
**Extends:** [Proactive Review Drive](2026-09-02-proactive-review-drive-design.md),
[Recoverable delivery process](2026-09-24-recoverable-delivery-process-design.md) §3.8–3.9.
**Decision of record:** WWMD `DI-8A0408D0DE21` (write this design now).

## 1. Problem

Opening a pull request is DPF's "ready to merge" signal
([all-changes-land-via-pr](../../founder-kernel/wiki/principles/all-changes-land-via-pr.md)),
so getting it merged is part of the work. Whether that happens today depends on
which client opened the PR:

- **The Claude desktop app** has a per-session "auto-fix" switch. When it is on,
  the app wakes that one session when a check fails. Nothing else in DPF can see
  the switch, and it does not exist for Codex, Grok, Antigravity or Build Studio.
- **Build Studio rooms** have a server-side reconciler. It updates a branch that
  is behind, turns on auto-merge, and escalates conflicts. It does nothing about
  failing checks.
- **Every other room** has nothing. A red PR sits until a person notices.

So the same change can merge on one surface and strand on another. That breaks
two kernel rules:
[platform function never depends on a client](../../founder-kernel/wiki/principles/platform-function-never-depends-on-a-client.md),
and recoverable-delivery rule 2: "the platform owns the next step; a client may
speed it up, never gate it."

## 2. What exists (verified at `origin/main` 37fd9b885, 2026-10-01)

| Piece | What it does today | Gap |
|---|---|---|
| `delivery-shapes.ts` `merge()` stage | Every delivery shape ends in `merge`: "the PR is green on required checks and merged through the queue". Accountable principal `role:author`, governed-decision advance, evidence `merged-sha`. | Because the principal is a role, `resolveDrivePlan` returns `attention`. The drive raises the stage to a person and never acts on it. |
| `build-pr-delivery-reconciler.ts` + `queue/functions/build-pr-delivery-reconcile.ts` | 5-minute cron. `behind` → update branch (bounded). `ready` → enable auto-merge. `conflict`/`closed` → `PlatformIssueReport`. State is kept in `workspaceState`. | Selects only rooms with `featureBuildId` (Build Studio). Defaults to `shadow` (`resolveBuildPrReconcilerMode`). `checking` (red CI included) waits with no limit. |
| `github-pr-readiness.ts` | One GraphQL read per PR: checks, merge state, review threads, queue entry. Projects to `ready / behind / conflict / queued / checking(reason) / merged / closed`. Mutations are limited to update-branch and enable-auto-merge. | `checks-failing` is reported but nobody consumes it. Failing checks are not named. |
| `autonomous-recovery-policy.ts` | Declares `post-push-ci-failure → repair-ci-and-push-new-sha`, bound 2, and `queue-stale-base → leave-queue-replay-and-reenroll`, bound 1. | Nothing ever classifies a post-push failure, so these never fire. |
| `app/api/platform/git/updates/route.ts`, `git-promotion-intake.ts` | Signed webhook receiver: `push` and `pull_request` (merged/closed). Idempotent on delivery id (§3.9). | No `check_suite`, `workflow_run` or `merge_group`, so a CI outcome never reaches the room. |
| `work-capsules/liveness.ts` `hasOpenPr` | An open PR observed in the last 20 minutes makes the room `live`. | It ignores CI state, so a room with red CI and no one working on it looks healthy. |
| `queue/functions/workroom-drive.ts` + `drive-resolution.ts` | Client-neutral wake, lease and dispatch. Agent stages → `dispatch_agent` (`ScheduledAgentTask`). Role stages → `attention`. At `preauthorized`, governed agent stages dispatch (EP-4614F35E). | The PR has no agent-actionable stage. |
| `scripts/check-stuck-auto-merge.mjs`, `check-merge-queue-churn.mjs`, `check-missing-ci-dispatch.mjs` | GitHub Actions alarms that comment on the PR. | They know nothing about Workrooms, so the room never hears. |
| `scripts/pr-origin.mjs` | Maps a PR head SHA to the room and client that produced it (`lookup_change_origin`). | Not wired to anything. |

The pieces exist. What is missing is the wire from "CI said no" to "the room
does something about it".

## 3. Design

### 3.1 The rule

Once a room's PR is open, the room owns it until it is merged or a person
closes it. The owner is the room, not the client. A client that opened the PR
may help (§3.6); it is never the reason the PR moves.

### 3.2 Follow-through state on the room

The reconciler's existing `workspaceState` record (`build-pr-delivery-state`)
generalises into a **PR follow-through record**. It keeps one shape for every
room:

```
{ repository, prNumber, prUrl, headSha,
  status: watching | repairing | queued | awaiting-person | merged | closed,
  checks: { required: [...], failing: [{ name, conclusion, runUrl, class }] },
  attempts: AutonomousRecoveryStateV1,   // reused, not re-declared
  lastObservedAt, escalationKey }
```

`attempts` is the existing `AutonomousRecoveryStateV1`, so the existing bounds
(`post-push-ci-failure`: 2, `queue-stale-base`: 1) are the budget. No new
policy table.

### 3.3 Inputs: events first, poll as the safety net

- **Webhook.** The receiver adds `check_suite` (completed), `workflow_run`
  (completed) and `merge_group` (checks_requested / destroyed). It uses the
  same signed, idempotent path as §3.9. Each event is matched to its room by
  repository and head SHA (the binder already does this for `pull_request`) and
  enqueues one reconcile for that room.
- **Poll.** The 5-minute reconciler remains the recovery path, as §3.9 already
  requires, because GitHub does not redeliver failed webhooks.
- **Reconciler scope.** The `featureBuildId` filter is removed. The scope
  becomes every non-terminal room with a bound PR. Build Studio rooms keep their
  autonomy-eligibility check. Other rooms use the room's action boundary
  (§3.5).

### 3.4 Classify before acting

A red check is not automatically a defect in the diff. The doctrine
[report only the verdict you reached](../../founder-kernel/wiki/principles/report-only-the-verdict-you-reached.md)
says a gate that could not run is not a verdict. Each failing required check
is classified once per head SHA:

| Class | Signals (from the check run / workflow run) | Action | Budget |
|---|---|---|---|
| `infrastructure` | conclusion `cancelled`, `timed_out`, `startup_failure`, `stale`; runner lost; known infra job names; zero jobs started | Re-run the failed jobs once. If it is still infrastructure after that, raise attention to the platform operator (not the author). | Its own budget; never spends `post-push-ci-failure`. |
| `stale-base` | merge state `BEHIND`, or a `merge_group` failure whose merge commit differs from the PR head | Update the branch (existing action), then `leave-queue-replay-and-reenroll`. | `queue-stale-base` (1) |
| `defect` | conclusion `failure` with a job that ran its steps | Dispatch a repair (§3.5). | `post-push-ci-failure` (2) |
| `conflict` | merge state `DIRTY` | Dispatch a repair whose task is to merge base (the existing conflict escalation moves here). | `post-push-ci-failure` |

A repair never counts against the budget twice for the same head SHA. A new
head SHA from the repair is what the next observation judges.

### 3.5 Who repairs: the room, at its proactivity level

The `merge` stage gets the same author-flip and boundary treatment EP-4614F35E
gave review stages. The stage stays `governed-decision`; merging is still done
only by the merge queue. What changes is the **repair** step in front of it:

- At **`preauthorized`** (full proactivity, the founder-chosen default for
  platform-development rooms), a `defect` or `conflict` classification makes
  the drive return `dispatch_agent` for a repair stage. The repair agent is a
  platform coding coworker running as a `ScheduledAgentTask` against the PR
  branch. It gets a structured handoff: PR, head SHA, failing check names, run
  log URLs, the room's backlog item and spec. It must produce a new signed
  commit on the same branch that passes the local gate before it pushes. It
  records `record_workroom_evidence(kind: "pr-gate")` against the room.
- At **`balanced`**, the same packet is staged as `attention` with a one-action
  "run repair" (propose, do not act).
- At **`quiet`**, the room records the state and does nothing else.

When the budget is spent, the room raises `attention` to its Process Overseer
with the failing checks, both repair attempts and their results. The drive's
existing "every tick concludes" rule (BI-12A083B4) guarantees the blockage
names an owner.

**Never relaxed:** the repair agent cannot merge, force-push, dismiss checks,
edit required-check configuration, or weaken a test to pass. The last is the
build-gate rule "never weaken auth to make a test pass", applied to every
test. A repair that touches files outside the PR's existing diff scope is
refused, and the room raises attention.

### 3.6 The client is an accelerator

If the room's executor holds a live lease, that executor hears first. The
signal arrives on its next `heartbeat_workroom` or MCP call (a `nextAction` on
the room readback), and through a session-start hook where the client has one.
It gets one drive interval (the existing 30-minute re-send window, §3.5 of the
recoverable-delivery spec) to push a fix itself. If it does not, the platform
repair in §3.5 proceeds. The Claude desktop auto-fix switch becomes one such
accelerator. It is never the mechanism.

### 3.7 Liveness reads CI

`hasOpenPr` becomes `live` only when the follow-through status is `watching`,
`repairing` or `queued`. A room whose PR is red with no repair in flight and no
budget left reads **`stalled`**, with the attention item as its reason. It is
never reaped while a PR is open.

### 3.8 The GitHub Actions alarms report to the room

`check-stuck-auto-merge`, `check-merge-queue-churn` and
`check-missing-ci-dispatch` keep commenting on the PR, and also post their
finding to the platform's signed intake. The platform resolves the room through
`pr-origin` and records it as room evidence. The same finding then reaches the
operator inbox (completing BI-F1DE364F) instead of living only in a PR comment.

## 4. What this reverses, and what it keeps

**Reverses:** red CI is someone's problem only if their client happens to watch
for it. The plan `2026-07-27-build-studio-pr-readiness-merge-recovery.md:325`
deferred automatic repair to "a separate governed design"; this is that design.

**Keeps:**
- The merge queue is the only writer of `main` (§3.8 of the recoverable-delivery
  spec).
- DCO, the local gate, and independent review all apply to repair commits
  exactly as to the first commit.
- Independence: the repair agent is an executor, not a reviewer. If the PR's
  review receipt predates the repair, the existing semantic-review gate decides
  whether the new SHA needs re-review.
- Authority is re-checked at the moment of effect: the repair task runs under
  the room's grants at dispatch time, not the opener's stored token.

## 5. Impacts

- **Blast radius.** The reconciler's scope widens from Build Studio rooms to
  all rooms with a PR, and its default changes from `shadow` to `enforce`.
  Rollout is staged (§7). Webhook handling adds three event types on an
  existing, signed, idempotent receiver.
- **Capacity.** At most 2 repair dispatches per PR head lineage, plus one infra
  re-run per check. That is bounded by the existing recovery budget.
- **Cost of being wrong.** A bad repair is a new commit on an unmerged branch.
  The merge queue and required checks still decide. Reversal is a revert of
  that commit or closing the PR.
- **Data.** There is no schema migration. The follow-through record lives in
  `workspaceState`, as the reconciler's state does today.
- **Docs.** The build-gate runbook "stuck auto-merge alarm" section, the
  contributor procedure runbook, and the `dpf-pr-with-dco` skill change to say
  the room owns follow-through.

## 6. Research & Benchmarking

Sources were fetched 2026-10-01. Where a tool's documentation is silent, the
table says so rather than guessing.

| Tool | On a failing required check | Retry / flaky handling | Code repair | Escalation |
|---|---|---|---|---|
| **GitHub merge queue** ([docs](https://docs.github.com/en/repositories/configuring-branches-and-merges-in-your-repository/configuring-pull-request-merges/managing-a-merge-queue)) | The PR is removed from the queue; the groups behind it are rebuilt without it. | None. A timeout treats silent CI as failed. | None. | The removal reason goes on the PR timeline; requeueing is manual. |
| **Mergify** ([lifecycle](https://docs.mergify.com/merge-queue/lifecycle), [CI retries](https://docs.mergify.com/changelog/2026-03-18-automatic-ci-retries-in-merge-queue/)) | Dequeue. A failing batch is bisected to find the culprit. | `max_checks_retries` (default 0) recreates the run up to N times. Cancelled checks are requeued without a code change. `checks_timeout: auto` uses the p95 of successful runs. | Not documented. | A check run plus status comments. |
| **Renovate** ([automerge](https://docs.renovatebot.com/key-concepts/automerge/), [rebaseWhen](https://docs.renovatebot.com/configuration-options/#rebasewhen)) | No merge, no retry. | Not documented. `rebaseWhen=auto` becomes `conflicted` when a merge queue exists, to avoid double-updating. | Not documented. | Adds the assignees and reviewers it withheld at creation. |
| **Zuul** ([gating](https://zuul-ci.org/docs/zuul/latest/gating.html), [job attempts](https://zuul-ci.org/docs/zuul/latest/config/job.html)) | The failing change is reported and dropped; changes behind it are re-tested without it. | A failure in the **pre-run** (setup) phase is retried up to `attempts` (default 3). Run-phase failures are reported at once. | None. | Reported to the change owner. |
| **Copilot cloud agent** ([changelog](https://github.blog/changelog/2026-05-18-one-click-fixes-for-failing-actions-with-copilot-cloud-agent/)) | A person clicks "Fix with Copilot" on the failed run. | Not documented. | Yes: it pushes a fix and tags the person. Whether it pushes to the branch or opens a stacked PR is inconsistent across sources (unverified). | The person reviews. |

**Adopt:**
- **Zuul's split by phase** is the model for §3.4. Retry only failures that are
  infrastructure by construction, such as setup, cancellation, timeouts or no
  job started. A failure in the diff's own run goes to repair or a person,
  never to a silent retry.
- **Mergify's bounded retry, default zero for real failures**, and its "cancelled
  means requeue without a code change". This matches the `infrastructure` row's
  single re-run.
- **Renovate's quiet-until-failure escalation.** A person hears only when
  automation gives up, with the attempts attached.
- **Renovate's deference to the merge queue.** When the queue is on, the room
  updates a branch only when `BEHIND` blocks queue entry or a `merge_group`
  failure shows a stale base. It does not chase every new commit on `main`.
- **Event-driven watching with a poll fallback** (`check_suite` and
  `workflow_run` completed, `merge_group` destroyed). This is consistent with
  §3.9 of the recoverable-delivery spec.

**Reject:**
- **Dequeue with no owner** (the GitHub default). In DPF the room owns the
  requeue.
- **Retry everything.** It hides real defects and spends CI capacity. That is the
  opposite of "a gate that could not run is not a verdict".
- **Repair only on a human click** (Copilot). It is the per-client-toggle problem
  again. DPF's repair is platform-initiated, bounded and governed.
- **A new external service** (Mergify as a dependency).
  [Absorb, don't adopt](../../founder-kernel/wiki/principles/absorb-dont-adopt.md):
  every capability here extends substrate DPF already runs (the merge queue,
  reconciler, drive, recovery policy and webhook receiver).

**Where DPF is new ground.** None of the tools above documents an automatic,
bounded repair loop for real failures. That is why §3.5 gates it on the room's
proactivity boundary, refuses scope growth, and keeps the merge queue as the
only path to `main`.

## 7. Delivery slices

1. **Observe for all rooms (shadow).** Generalise the state record. Widen the
   reconciler scope. Add classification. Record follow-through state and
   liveness `stalled`. No actions outside Build Studio.
2. **Events.** `check_suite`, `workflow_run` and `merge_group` intake, with a
   deterministic event id and the binder by head SHA.
3. **Infra re-run and stale-base**, enforced for all rooms (low-risk actions
   that already exist).
4. **Repair dispatch** at `preauthorized`, plus the staged packet at
   `balanced`. Exhaustion goes to attention.
5. **Client accelerator readback** (`nextAction` on `heartbeat_workroom` /
   `get_workroom`), and the alarm scripts report to the room.
6. **Flip the default** to `enforce` after slice 4 has run on the development
   install with recorded outcomes.

Each slice is its own backlog item and PR.

## 8. Open questions

- **Repair worker capability.** Can the in-platform coding coworker check out
  and push to an existing external branch through the governed sandbox, or does
  it only work on builds it created? This needs verification against the Build
  Studio sandbox and `start_external_work` before slice 4 is planned.
- **Infra signal list.** Which job names and conclusions in this repository's
  workflows are infrastructure-only. Proposed source: the merge-queue churn
  script's existing classification, if it has one; otherwise a small checked-in
  list with a ratchet.
