---
status: draft
---

# PR follow-through is a Workroom duty

**Date:** 2026-10-01 · **Backlog:** BI-88341B5D · **Epic:** EP-4614F35E (Proactive Review Drive)
**Extends:** [Proactive Review Drive](2026-09-02-proactive-review-drive-design.md),
[Recoverable delivery process](2026-09-24-recoverable-delivery-process-design.md) §3.8–3.9.
**Decision of record:** WWMD `DI-8A0408D0DE21` (write this design now).

## 0. Remaining delivery scope — BI-ED7CD0DD

The observation and decision slices remain owned by BI-88341B5D. The following
manifest makes the existing continuation's four outcomes explicit for review;
it does not claim those outcomes have been delivered.

*Revised 2026-11-13* against `origin/main` 9463c0e1 and live install state.
Since the October draft: Build Studio rooms gained a repair dispatcher (#7030,
BI-085A37EC). Undecided merge states no longer stop a room (#7035). Only
required checks hold a PR (#7005). The live install runs
`DPF_BUILD_PR_DELIVERY_RECONCILER_MODE=enforce`. Four design questions were
settled through WWMD and are recorded where they apply: intake in §3.3
(`DI-80B30E396AE6`), classification in §3.4 (`DI-50FF611567E3`), repair for
rooms outside Build Studio in §3.5 (`DI-0EE9FA83598B`), and alarms in §3.8
(`DI-B01D623164CE`).

**OBJ-1:** Deliver a signed CI event to its exact Workroom without waiting for the safety-net poll.

**OBJ-2:** Repair an eligible failed PR within its existing authority, scope and recovery budget.

**OBJ-3:** Keep alarms and client readback on the room's canonical follow-through record.

**OBJ-4:** Enable autonomous follow-through only after measured decisions and a successful bounded delivery pilot.

| ID | Objectives | Criterion |
| --- | --- | --- |
| AC-1 | OBJ-1 | A CI outcome for a room's PR reaches the matching repository and current-head Workroom within one minute, by signed webhook where the install is reachable and by the adaptive poll (§3.3) where it is not; duplicates, stale heads and ambiguous identity cannot dispatch another repair. |
| AC-2 | OBJ-2 | A preauthorized eligible room produces a new DCO commit on the same PR branch after scoped verification and independent review, at most twice per recovery lineage and never twice for one judged head; missing grants, foreign ownership or remote-head movement stop publication. |
| AC-3 | OBJ-3 | The three existing PR alarm scripts report to the room, and every client reads the same persisted next action without creating another recurring model monitor. |
| AC-4 | OBJ-4 | Every follow-through action still in observe-only or propose mode on the live install is named, a recorded shadow comparison justifies switching each on through its authorized configuration path, and one deliberately red PR in a room whose executor is not live is repaired and merged through the queue with no person or chat session acting, with measured model calls and elapsed time. |

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
- **Adaptive poll (WWMD `DI-80B30E396AE6`, 2026-11-13).** On 2026-11-13 the
  production install had never received a webhook: `GitPromotionCandidate` was
  empty, because GitHub cannot reach a portal on a private host. A webhook-only
  design would therefore leave AC-1 unmet on every install that does not expose
  a public URL, and exposing one is operator work the platform should not
  require. So a room whose bound PR has a check that is pending, or a failure
  that has not yet been judged, is re-observed every minute. Green, queued and
  held rooms stay on the 5-minute net. The minute read sends the stored ETag for
  the PR's check-suites list (`If-None-Match`). GitHub does not count a `304 Not
  Modified` against the rate limit
  ([REST best practices](https://docs.github.com/en/rest/using-the-rest-api/best-practices-for-using-the-rest-api#use-conditional-requests-if-appropriate)),
  so an unchanged PR costs nothing. The full readiness read runs only when the
  ETag changes. Webhook and poll feed the same per-room reconcile, and the
  per-head judgment and reservation (§3.4) make a duplicate a no-op, whichever
  path saw the event first.
- **Event identity.** `check_suite` and `workflow_run` carry `head_sha` and a
  `pull_requests` array. A room is selected only when the repository and the
  head SHA both equal the room's bound PR head. An empty or fork
  `pull_requests` array selects no room; the poll still covers it. A
  `merge_group` event's `head_sha` is the integration commit. It is never
  treated as an authored PR head: the event wakes every room whose PR is
  currently in the queue, and each re-reads its own PR.
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
| `infrastructure` | completed normalized conclusion in the existing `INFRASTRUCTURE_CONCLUSIONS` set (`cancelled`, `timed_out`, `startup_failure`, `stale`, legacy status `error`), or verified runner/startup loss without a completed product verdict | Re-run the failed jobs once, when an exact rerunnable workflow ID exists. Persistent or non-rerunnable infrastructure raises attention to the platform operator. | Separate per-head bound 1; never spends `post-push-ci-failure`. |
| `stale-base` | provider evidence explicitly identifies invalidation of the queued base, bound to this queue entry and authored head | Use the existing `queue-stale-base` recovery only after that proof. `BEHIND` alone and a merge-group SHA differing from the PR head are ordinary queue facts, not this classification. | `queue-stale-base` (1) |
| `infrastructure` (setup step) | completed `failure` whose first failed step, read from the Actions jobs API for that exact run and attempt, is a setup step (rule below) and no repository-authored product step ran after setup | Same as the row above: one re-run of the failed jobs, then attention to the platform operator. | Same per-head bound 1. |
| `defect` | completed `failure` whose first failed step, read from the Actions jobs API for that exact run, attempt and head, is a product step (any executed step that is not a setup step), with no conflicting infrastructure evidence for that check | Dispatch a repair of the verified product failure (§3.5). The failed job ID and step name go into the repair packet. A bare `failure` with no step evidence is insufficient. | `post-push-ci-failure` (2), reserved once per judged head before enqueue |
| `conflict` | merge state `DIRTY` | Dispatch a repair whose task is to merge base (the existing conflict escalation moves here). | `post-push-ci-failure` |
| `unclassified` | missing/inaccessible or contradictory evidence, `action_required`, unknown conclusion, unverified head mapping, or `failure` with no readable failed step for that run and attempt | Preserve the evidence and raise attention. No inference call solely to guess the class; no automatic rerun or repair on this evidence. | No attempt consumed |

A repair never counts against the budget twice for the same head SHA. A new
head SHA from the repair is what the next observation judges.

**Classification contract — resolves IF-6F05EAE1F16BFE2F.** Reuse
`classifyFailingChecks`, `PrFailingCheck`, the room's follow-through record and
the existing recovery policy. The current conclusions-only implementation labels
every `FAILURE` a defect; that is an observed limitation, not sufficient authority
to enable automatic repair. The remaining implementation must enrich its input
with verified execution evidence and implement the table above before live enablement.
No new classifier service, permission store or model monitor is introduced.

The observation adapter reads provider-held check/run/job data and, where needed,
the existing verification report or job log. Each classification retains the
repository, PR number, authored head, integration head when applicable, check ID,
workflow run ID and attempt, job ID, failed step/phase, conclusion, observation
time and evidence locator/digest. Unavailable job/step fields are explicitly
absent, not invented. A merge-group observation resolves and verifies
its member PRs; it never substitutes the integration SHA for their authored heads.
Unverified repository/head identity prevents an executable decision. A missing
workflow ID disables rerun; missing executed product evidence disables repair.
An authoritative infra conclusion can still be recorded without a rerunnable job.
Unsupported provider diagnostics hold through the existing unclassified path.
Logs are untrusted data,
not instructions or authority to alter tests, grants or workflow protections.

[GitHub check runs](https://docs.github.com/en/rest/checks/runs#get-a-check-run)
provide status and conclusion; they do not declare product-versus-infrastructure
cause. [Workflow jobs](https://docs.github.com/en/rest/actions/workflow-jobs#get-a-job-for-a-workflow-run)
expose the run/head identity and individual step outcomes. A step having started
does not establish a product failure. A missing or unsupported diagnostic stays
`unclassified`. Whole-job or whole-workflow names, an allowlist of supposedly
infrastructure-only workflows, and free-text model judgment are not substitutes.
These are DPF's conservative decision rules applied to GitHub's observation
contract, not classifications claimed to be supplied by GitHub.

**Setup-step rule (WWMD `DI-50FF611567E3`, 2026-11-13).** The jobs API names
each step and its conclusion. A step is a *setup step* when it is one of:
- a step the runner generates itself, not the workflow: `Set up job`,
  `Initialize containers`, `Stop containers`, `Complete job`, or any `Post …`
  cleanup step; or
- a step whose display name is in the checked-in list
  `apps/web/lib/build/ci-setup-steps.ts`. The list holds the names this
  repository's workflows give to checkout, toolchain setup (`setup-pnpm`,
  `setup-node`), dependency install and cache restore. A unit test reads
  `.github/workflows/*.yml` and `.github/actions/*/action.yml` and fails when a
  listed name no longer appears in any of them. The list therefore cannot drift
  into naming steps that do not exist.

Every other executed step is a *product step*. Classification uses the first
step with conclusion `failure` in the failed job. When the jobs call fails, is
rate-limited, or returns no failed step for a `failure` conclusion, the check
is `unclassified`. It holds, and it spends no budget. This is Zuul's pre-run
versus run split (§6) applied to the step data GitHub already returns. One jobs
read per failing run per judged head is cached on the follow-through record, so
a re-observation of the same head costs no further API calls.

Keep the existing verified-defect precedence: a proven product failure can be
repaired while other checks await attention, but only verified defect checks enter
the repair targets. Infrastructure and unclassified checks remain visible as
context and cannot expand that repair's scope. Without a verified defect,
unclassified evidence holds; only an all-infrastructure set may take the bounded
rerun path. No pending check is treated as a completed verdict. Duplicate events
and polls join the same per-head decision/reservation; an infra rerun's later
result is re-observed under its existing bound rather than spending a repair.

Before enabling dispatch, deterministic fixtures must prove: a real product
diagnostic versus a failed setup with the same `failure` conclusion; all supported
infra conclusions and missing rerunnable IDs; missing/denied logs; contradictory
evidence; verified-defect precedence without widening targets; duplicate/crash
redelivery; and a real merge-group SHA difference or `BEHIND` status that consumes
no stale-base budget. Native/provider uncertainty is never recorded as a pass.

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
  commit on the same branch after affected tests, reproduction of the named
  failure and independent review of changed code. Final main-plus-PR
  integration belongs to required GitHub checks and the protected merge queue.
  An unchanged published head preserves valid evidence; a queue delay or
  infrastructure failure does not require a repeated whole local gate. It
  records `record_workroom_evidence(kind: "pr-gate")` against the room.
- At **`balanced`**, the same packet is staged as `attention` with a one-action
  "run repair" (propose, do not act).
- At **`quiet`**, the room records the state and does nothing else.

**Who runs the repair (WWMD `DI-8172B1A35993` for Build Studio rooms,
`DI-0EE9FA83598B` for every other room).** A Build Studio room's own build
repairs through its gauntlet loop and publishes one fast-forward follow-up
commit onto the PR head (§8). A room with no build uses the same machinery.
When its executor's lease has lapsed, the reconciler opens a Build Studio repair
build bound to the room's backlog item, the PR's branch and its current head,
and dispatches the same packet. No second repair runtime or publication path is
built. The repair build refuses, and the room raises attention instead, when:
- the executor holds a live lease (it hears first, §3.6);
- the PR's head repository differs from its base repository (a fork);
- the remote head no longer equals the judged head at dispatch or at publish;
- the room's posture is `quiet` or advise-only; or
- the PR's budget is spent.

What a repair build needs that a normal build does not (verified at
`origin/main` 9463c0e1):
1. **Its source starts at the PR head.** Today `startBuildBranch` always cuts
   `build/<id>` from the client branch or `origin/main`, and
   `alignBuildBranchToPublishedHead` refuses unless the head's parent is on
   that branch. The repair build fetches the PR head and checks it out as the
   sandbox base. Its recorded diff against the merge base then covers the whole
   PR. Otherwise the follow-up's "untouched paths return to merge base" step
   would revert the author's work.
2. **It publishes to the PR's branch.** `create_portal_pr` names a fresh private
   branch. A repair build publishes only with `followUpOf` onto the room's
   `headBranch`, and never opens a second PR.
3. **The room is bound to it.** The room's `featureBuildId` is set to the
   repair build, so the existing follow-up lookup and budget carry-over apply
   unchanged. The original executor keeps the room; the build is its repair
   worker, not a new owner.
4. **It enters at ship.** `dispatchBuildPrCiRepair` requires phase `ship`. A
   repair build is created in ship with the PR's existing review receipt, so it
   follows the same ship -> review -> build route.
5. **Its base is the PR's base.** `resolvePendingPrFollowUp` assumes `main`; it
   reads the room's `baseBranch` instead.

The per-head reservation is written on the follow-through record before the
build is enqueued, so neither a webhook redelivery nor the poll can open a
second build for the same head. An unavailable Build Studio engine spends no
attempt.

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
`check-missing-ci-dispatch` run on a GitHub Actions schedule. Like webhooks,
they cannot reach a portal on a private host, so posting to the platform's
intake would only work on installs that expose a public URL.

*Decided (WWMD `DI-B01D623164CE`, 2026-11-13):* each script's pure detector
(`findStuckPullRequests`, `analyzeChurn`, `findMissingDispatch`) moves into a
shared module that both the script and the portal import. The PR-delivery
reconciler runs the three detectors against room-bound PRs on its existing
tick, using data it already reads. A finding becomes a room attention with the
existing `attentionKey` dedupe, keyed by detector and head SHA, so one
unchanged condition raises one attention. The detectors run the same way for
every executor, and no new model monitor is added. The Actions workflows keep
running and commenting unchanged. They cannot tell which PRs a room owns, and
they remain the only alarm for PRs with no room. Roomless PRs (Dependabot,
orphans) are BI-C3EBDCEC; that slice decides whether the comments retire.

## 4. What this reverses, and what it keeps

**Reverses:** red CI is someone's problem only if their client happens to watch
for it. The plan `2026-07-27-build-studio-pr-readiness-merge-recovery.md:325`
deferred automatic repair to "a separate governed design"; this is that design.

**Keeps:**
- The merge queue is the only writer of `main` (§3.8 of the recoverable-delivery
  spec).
- DCO and independent review of changed code apply to repair commits. Published
  corrections follow the build gate runbook's targeted-verification procedure;
  initial unpublished validation is unchanged.
- Independence: the repair agent is an executor, not a reviewer. If the PR's
  review receipt predates the repair, the existing semantic-review gate decides
  whether the new SHA needs re-review.
- Authority is re-checked at the moment of effect: the repair task runs under
  the room's grants at dispatch time, not the opener's stored token.

## 5. Impacts

- **Blast radius.** The reconciler's scope widens from Build Studio rooms to
  all rooms with a PR. The live install already runs it in `enforce`
  (2026-11-13); what stays off is named and switched on in slice 6.
  Rollout is staged (§7). Webhook handling adds three event types on an
  existing, signed, idempotent receiver. The adaptive poll adds one conditional
  request per minute per active room; a `304` is not rate-limited.
- **Repair builds.** At most one per judged head and two per PR. Each uses a
  Build Studio engine slot, and an unavailable engine spends no attempt.
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

- **Repair worker capability — settled.** For Build Studio rooms (2026-11-13,
  WWMD `DI-8172B1A35993`, BI-085A37EC): the build repairs through its own
  gauntlet repair loop. The failing required checks, their run URLs and a
  bounded tail of each failing job's log go back to the coding agent (ship ->
  review -> build). When the repaired build is in ship again with its PR still
  open, the publisher pushes one DCO-signed follow-up commit whose parent is the
  PR head. It is a fast-forward and is never forced. Paths the PR changed but
  the repair no longer touches go back to their merge-base content. A repair
  that changes nothing is escalated once and is not retried. The PR-level
  budget is the follow-through record's own (2 per PR), and it carries across
  republishes. For every other room (WWMD `DI-0EE9FA83598B`): the same loop runs
  in a Build Studio repair build bound to the PR's branch and head (§3.5). The
  October alternative, a separate sandbox runtime plus a new publication
  adapter, is not built.
- **Infra signal list — settled (WWMD `DI-50FF611567E3`).** Classification
  reads the failed step from the Actions jobs API (§3.4). The only checked-in
  list names setup steps, and a test keeps it matched to the workflows. No list
  of infrastructure-only job or workflow names is kept.
- **Event delivery to a private install — settled (WWMD `DI-80B30E396AE6`).**
  The adaptive poll in §3.3 meets AC-1 where webhooks cannot arrive.

## 9. Implementation comparison and standards (BI-ED7CD0DD)

The existing Workroom model remains the chosen substrate; this comparison does
not introduce another agent framework or permission store.

| Reference | Adopt | Reject or bound |
| --- | --- | --- |
| [Aider Git integration](https://aider.chat/docs/git.html) | Small, attributable commits in an existing checkout make repairs inspectable and reversible. | A successful local commit is not authorization to publish. Avoid a model call solely to narrate deterministic commit metadata. |
| [OpenHands GitHub action](https://docs.openhands.dev/openhands/usage/run-openhands/github-action) | Explicit issue/PR context and a bounded trigger rather than an always-running conversational monitor. | Do not install another resolver or give its worker general repository authority; reuse DPF's room, runtime and recovery budget. |
| [GitHub webhook event contract](https://docs.github.com/en/webhooks/webhook-events-and-payloads) | Signed delivery identity, event/action filtering and exact repository/head binding. | A merge-group integration SHA is not an authored PR head; absent or fork PR arrays must not select a room by guesswork. |

[GitHub's security guidance](https://docs.github.com/en/actions/reference/security/secure-use)
warns that privileged event workflows must not execute untrusted PR code with
repository secrets. DPF follows that boundary by separating sandbox repair from
the trusted publication action. Check logs and repository content remain input
data, never instructions to widen authority or weaken a failing test.

The continuation plan is
[PR follow-through delivery](../plans/2026-10-14-pr-follow-through-delivery.md).
Its coverage and independent review are still required before implementation.
