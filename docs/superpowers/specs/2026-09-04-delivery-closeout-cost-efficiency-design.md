---
status: draft
---

# Delivery closeout and cost efficiency

Date: 2026-09-04. Design owner: BI-154689E7. Epic: EP-WORKROOM-CLOSEOUT.
Workroom: WC-375F098A. Kernel recommendation: DI-619636A684B2.
Source inspected: f62c1edb4b (main after PRs #5050–#5053).
Status: source-grounded design; independent initiative review and implementation
coverage receipts remain required. This document is not evidence of deployment.

## Decision and scope

End an authoring execution when delivery and its durable acceptance handoff are
recorded. Run acceptance after deployment through the existing server orchestration.
Group compatible checks for the same served release so several PRs share one
verification execution. Preserve each outcome's individual acceptance requirements.
A failed check opens corrective work with a small evidence packet and a fresh
execution. It does not require resuming the original conversation.

This extends the [closeout design](2026-09-01-workroom-closeout-lifecycle-design.md),
[resilient process](2026-08-15-resilient-concurrent-development-process.md), and
[delivery throughput design](2026-09-03-local-first-agentic-delivery-throughput-design.md).
It preserves local capacity investment and shared runtime leases. It does not change
deployment authority, waive required acceptance, buy capacity, delete worktrees, or
introduce a scheduler, parallel backlog, or client-owned source of workflow state.

## Evidence and implementation reconciliation

The earlier September 4 live audit found 17 historical/reapable rooms among 27 late
stage rooms, and 45 among a capped sample of 50 working rooms. A janitor dry run
classified 25 of 72 decisions as clean merged Tier A. No worktrees were removed.
The capped 5,000-call MCP sample covered about six hours on August 28, despite a
seven-day request: 50.8% were lease claim/list/renew calls, 76.5% including quiescence
checks. These figures describe that sample, not seven-day averages. Local integration
telemetry reported 30% abandonment and 37-minute p95 wait; the queue was empty at
inspection. The platform cost ledger excludes external desktop subscription usage.

| Existing implementation | Finding and required change |
| --- | --- |
| `apps/web/lib/work-capsules/liveness.ts` | `hasOpenPr` tests URL/number presence. Add explicit observed PR state; unknown cannot count as open or as proof of abandonment. |
| `apps/web/lib/work-capsules/work-capsule-reaper.ts` | Delivered annotation depends on local branch-head ancestry and skips installed runtimes without Git. Squash merges replace the head SHA. Read verified provider merge observations from existing inventory/coordination records. |
| `apps/web/lib/work-capsules/work-capsule-reaper.ts` | Reconciliation has a fixed 500-row take and no cursor; archived delivery does not release authoring state through an explicit handoff. Use bounded cursor reconciliation and idempotent terminal transitions. |
| `apps/web/lib/work-capsules/delivery-task-hub.ts` | Recently merged Task Hub already has working/waiting/attention groups. Extend its projection; do not create another dashboard. |
| `apps/web/lib/build/git-promotion-intake.ts` | Push intake owns durable candidate identity. Candidate creation precedes event send; a failed send followed by duplicate intake returns without re-dispatch. Reconcile dispatch from durable state. |
| `apps/web/lib/queue/functions/git-promotion-sandbox-verification.ts` | Every queued default-branch candidate can run install/typecheck/full build in a serialized local sandbox. Reuse equivalent protected evidence or request the missing lane only. Supersede older queued builds without dropping their acceptance obligations. |
| `apps/web/lib/self-upgrade/notifications.ts` | `emitUpgradeEvent` is a no-op. `run-store.ts` separately publishes state on the agent event bus; that existing path must feed durable verification admission, rather than adding a second notification system. |
| `scripts/worktree-janitor.mjs` and existing session hooks | Cleanup has its own host safety checks. Room termination alone does not acknowledge thread archival or worktree removal. Record each actuator result separately. |

PR #5050 delivered adversarial recovery fixtures, #5051 the Task Hub, and #5053
durable one-shot inference. Their source availability does not establish served
version or live acceptance. Reuse these additions and their tests.

## Contracts and objectives

Each objective below is the scope baseline for one contract (CT-DC-*). The acceptance
table that follows binds every AC-DC-* criterion to the objectives it proves.

- **OBJ-DC-1:** Delivery evidence identifies repository, PR, authored head, merge commit, observed state/time, and verification provenance; a squash merge closes the correct delivery and a later unmerged head cannot inherit it (contract CT-DC-DELIVERY).
- **OBJ-DC-2:** Authoring ends only after a durable handoff records BI, Workroom, source revision, delivered scope, acceptance contracts, evidence links, unresolved risks, responsible controller, and next event; no full transcript is required to continue, and scope added after that receipt creates a new attempt (contract CT-DC-HANDOFF).
- **OBJ-DC-3:** Release membership uses the merge commit included in the served artifact, scoped to repository and installation; a passing pre-merge build never substitutes for operational acceptance (contract CT-DC-ACCEPTANCE).
- **OBJ-DC-4:** Waiting has a persisted identity and continuation; it holds no inference worker, client heartbeat, runtime lease, or required open client (contract CT-DC-WAIT).
- **OBJ-DC-5:** Archive and cleanup are acknowledged idempotent steps; dirty, pinned, active, conflicted, and unmerged source remains protected (contract CT-DC-CLEANUP).
- **OBJ-DC-6:** Execution, waiting, replay, cache use, and attention are measured separately; idle saved conversations are not counted as inference spending (contract CT-DC-COST).

| Acceptance | Objectives | Statement |
| --- | --- | --- |
| AC-DC-1 | OBJ-DC-1 | Squash merge, a new head after merge, stale or unknown provider state, an installed runtime without Git, and duplicate or out-of-order events all resolve to the correct delivery. |
| AC-DC-2 | OBJ-DC-2, OBJ-DC-5 | A crash between steps, an active dirty worker, a missing host, and a retry lose no acceptance and perform no unsafe deletion. |
| AC-DC-3 | OBJ-DC-4 | Waiting consumes no worker; a fresh task resumes from the handoff; unmerged source remains protected. |
| AC-DC-4 | OBJ-DC-4 | A canceled waiter is never admitted; a predecessor cannot kill its successor; a queued receipt actually executes. |
| AC-DC-5 | OBJ-DC-3 | Identical integration evidence is reused; a changed tree, lock, or check identity forces the appropriate verification. |
| AC-DC-6 | OBJ-DC-3 | Ten obligations with three compatible checks run three checks and keep ten results; tenant separation, duplicate dispatch, and rollback hold; a failure creates exactly one corrective item. |
| AC-DC-7 | OBJ-DC-6 | Billed, estimated, and unknown costs are distinguishable; a 10,000-row cursor fixture completes; no idle-task billing is assumed. |

## State, data, and ownership

Workroom remains the outcome coordination anchor. Its authoring attempt can archive
as delivered while linked acceptance remains pending. Backlog `done` continues to
require its actual acceptance contract. Archive does not manufacture that evidence.
Release the authoring claim without advertising delivered demand as new coding work.
The next-work selector must distinguish acceptance pending from implementation ready.

Use TaskRun for durable continuations and worker retries, RuntimeVerification for
acceptance obligations/results, GitPromotionCandidate for Git event identity, the
actual self-upgrade run and RuntimeTarget for served bytes. ReleaseBundle is used
when present; its current model primarily groups FeatureBuild rows, so external PR
delivery must not require a fabricated bundle membership.

RuntimeVerification already has optional Workroom, build, target, and candidate
relations and a unique verificationId. Preserve the writer's one-primary-attach-point
contract. Each obligation retains its own record. Shared execution evidence is
referenced by immutable ID in validated result data; never copy a pass to unrelated
requirements. TaskRun artifacts carry the compact handoff. Extend the existing
typed contracts; any new persisted closed axis must use the enum registry/migration
procedure. Do not expand free-form status strings ad hoc.

Provider observations must be authenticated, repository-bound, timestamped, and
version/fingerprint checked. Reuse contributor inventory for reconciliation and
Git intake for events. Unknown, stale, or unavailable provider state means
reconciliation required. It is neither open-PR proof nor permission to abandon.
Retain the previous known merge fact across an outage. Local Git is a useful
positive corroboration, with squash semantics explicitly accounted for.

## Event flow and failure recovery

FLOW-DC-1: verified merge observation -> persist acceptance handoff -> archive
authoring attempt and release execution ownership -> enqueue host closeout receipt.
Each step has an idempotency key and a retryable state. A client adapter can archive
the conversation when idle and acknowledge it; the server does not assume it did.
An actively writing process must first checkpoint and acknowledge release.

FLOW-DC-2: self-upgrade success + confirmed served SHA -> admit verification TaskRun
-> page pending obligations -> group compatible checks -> execute bounded campaign
-> attach evidence -> complete acceptance or capture corrective work.
Admission is keyed by installation, served SHA, and acceptance-plan digest. Duplicate
events reuse it. Persist before dispatch and reconcile undispatched work every five
minutes so a lost event or process restart cannot require a human retry message.

Check equivalence includes contract/version, route or capability, persona, tenant,
fixture/data preconditions, environment, and served SHA. Similar route names alone
are insufficient. A ten-change release with three equivalent checks executes three
checks and retains ten traceable acceptance decisions. Rollback or another upgrade
during execution invalidates results for the changed target; re-admit against the
new served SHA. Runtime verification must respect production data and authority.

FLOW-DC-3: infra failure -> bounded server retry with backoff -> durable attention if
the retry budget is exhausted. A behavior failure creates one corrective BI keyed
by acceptance contract + served SHA + failure fingerprint, using the existing
corrective intake. Repeated notifications coalesce; approvals and failures never
disappear into progress coalescing. A new implementation uses a fresh Workroom.

FLOW-DC-4: local capacity unavailable -> durable queue receipt -> caller ends ->
server admission wakes the execution once. Queue cancellation and supersession
remove the waiter atomically. Old lease holders cannot terminate successors. The
queue owns readiness; a future task does not depend on the old provider session.

## Verification lanes and refactoring

Fast affected tests/typecheck/lint provide early feedback before publication. The
protected integration build remains mandatory. Reuse a result only for the same
immutable integration tree, dependency lock, check definition, and relevant runtime
identity. A prior green branch build does not certify a different merged tree.
Use shared local runtime capacity for the evidence unavailable from that result.
Do not add a second exhaustive build simply because a default-branch push arrived.

Reserve 20% of implementation capacity for deletion/refactoring that reduces future
cost: unify PR-state readers, centralize handoff/closeout transitions, remove duplicate
dispatch/retry loops, reconcile gate-policy duplication, and replace misleading
retry instructions with one durable continuation contract. Measure eliminated calls
and duplicated checks. Do not use a lines-changed quota.

## Operator experience

Extend the current Task Hub to show Working, Waiting, and Needs attention. Waiting
states say what event owns progress, for example: "Delivered; acceptance will run
after the next upgrade. No worker is running." A release row summarizes included
changes, distinct checks, passed/failed/pending counts, and the next needed action.
Details expose individual obligations and evidence without expanding all tool calls.

Delivery complete and outcome verified are separate labels. Unknown runtime state
is visibly unknown. Use existing components and theme tokens, keyboard navigation,
text status labels, and narrow-screen layouts. Show cleanup pending/complete only
where it helps the operator; keep path and lease details in inspection views.

## Scale and metrics

All recovery scans use stable keyset cursors, bounded batches (initially 100), and
persisted continuation. No fixed first-500 sweep may starve later records. Index
access paths before increasing fleet size; measure query plans at 10,000 pending
obligations per installation. Events stay installation-scoped and do not fan out to
every peer. The owning closeout and throughput epics retain any measured scale gap.

Initial targets: close authoring within five minutes of acknowledged handoff; zero
client polls during durable waits; 95% reduction in sampled wait-management calls;
cleanup eligible source within 15 minutes of host release; start acceptance within
five minutes of served-version confirmation. These are targets, not measured gains.

Extend the existing outcome scorecard with p50/p95 queue, merge-to-deploy, and
deploy-to-acceptance times; abandoned admissions; duplicate executions; acceptance
deduplication; unreaped eligible worktrees; operator interventions; model calls per
outcome; input/output/cache-read/cache-write tokens and estimated/billed cost by
provider. Missing external billing is unknown, not zero. Provider cache TTL must
never define Workroom ownership or cleanup policy.

## Delivery boundaries and verification

Each row is independently shippable and needs its own governed plan/PR. The table
is design scope mapping, not a recorded implementation coverage receipt.

| Deliverable | Existing backlog | Verification |
| --- | --- | --- |
| Explicit PR state and squash-safe delivery observation | BI-9FF39058 | AC-DC-1: squash merge, new head after merge, stale/unknown provider state, installed runtime without Git, duplicate/out-of-order events |
| Durable closeout and host acknowledgement | BI-154689E7; BI-75565393 | AC-DC-2: crash between steps, active dirty worker, missing host, retry; no lost acceptance or unsafe deletion |
| Pause/ownership projection and bounded resumption | BI-33E1E5D7; BI-9A353411 | AC-DC-3: waiting consumes no worker; fresh task resumes from handoff; unmerged source remains protected |
| Capacity cancellation, successor fencing, durable gate execution | BI-9BDF9539; BI-2584792B; BI-2461C0B1 | AC-DC-4: canceled waiter never admitted; predecessor cannot kill successor; queued receipt actually executes |
| Evidence reuse and proportional checks | BI-282AE0BC; BI-8D56F777 | AC-DC-5: identical integration evidence reused; changed tree/lock/check identity forces appropriate verification |
| Release acceptance grouping and Task Hub projection | BI-E3B918C2 | AC-DC-6: ten obligations/three compatible checks; tenant separation; duplicate dispatch; rollback; failures create one corrective item |
| Cost and attention measurement | BI-69803ACC | AC-DC-7: billed/estimated/unknown costs distinguishable; 10,000-row cursor fixture; no idle-task billing assumption |

Order: delivery observations -> durable closeout/acceptance admission -> release
verification -> UI/metrics. Capacity defects can ship independently. Existing Task
Hub and async-operation work retain their owners; this successor extends their
published contracts. A governed reviewer must validate the final baseline and
coverage before implementation starts.

## Compatibility, rollout, and rollback

First run observation and cohort planning without closing tasks or running checks.
Compare proposed membership/dispositions with authenticated provider facts and the
served release. Then enable delivery handoff on newly merged work; historical rooms
require confirmed provenance. Finally enable verification execution and host cleanup
using their existing authority gates. Preserve dirty/active/unmerged protection.

Prefer additive contract data and readers that tolerate missing fields. Do not mass
rewrite statuses or introduce a database migration solely for a UI label. If indexes
or enums are required, add forward-only migrations tested on existing records.
Rollback disables the new actuator and preserves handoffs and pending obligations;
the existing runtime and source evidence remain readable. Never clear pending work
to make a queue look healthy.

## Research and benchmarking

- Temporal durable execution: adopt persisted continuation/replay semantics through
  existing Inngest/TaskRun; reject adding Temporal as another engine.
  <https://docs.temporal.io/workflow-execution>
- Argo Rollouts analysis: adopt release-scoped analysis with explicit outcomes and
  failure handling; reject per-PR live sessions as the analysis controller.
  <https://argo-rollouts.readthedocs.io/en/stable/features/analysis/>
- Kubernetes TTL-after-finished: adopt separate completion and cleanup with finalizer
  style acknowledgement; do not interpret an idle author as proof that source is safe
  to delete. <https://kubernetes.io/docs/concepts/workloads/controllers/ttlafterfinished/>
- Provider caching is a request optimization with limited retention and matching
  requirements, not durable workflow state. Idle task storage alone does not establish
  a token charge. Use measured cache metadata instead of a universal one-hour claim.
  <https://developers.openai.com/api/docs/guides/prompt-caching>
  <https://platform.claude.com/docs/en/about-claude/pricing>
  <https://ai.google.dev/gemini-api/docs/generate-content/caching>

## Review readiness

### September 5 delivery reconciliation

BI-921B7DC2 / PR #5072 already delivered bounded technical-review authority.
Reuse its exact server-bound review path; do not add an approval service or a
WWMD inference call for every routine receipt. Explicit always-HITL, grant and
subject checks, immutable binding, consequential-action protection, and required
reviewer independence remain enforced. Its recorded live test saved a research
receipt with no owner approval envelope. That evidence does not close this design.

BI-8B8731EE owns the remaining required-writer defect: an eligible reviewer can
finish with prose without saving its bound receipt. Our exhausted research TaskRun
ending 7E9DAA6EEFB0 must not be replayed or replaced merely to evade its state.
Implementation remains blocked by RESEARCH_REQUIRED and subsequent plan gates.

The [blocked implementation handoff](../plans/2026-09-05-delivery-closeout-efficiency.md)
may be published under PR #5084's concrete blocked-by coverage marker. Publication
preserves knowledge; it is not an approved plan, coverage receipt or implementation
claim. Historical reviews remain bound to their original immutable artifact.

Incremental approval work here measures prompts per routine successful review
(target zero), receipt-save failures, continuation latency and replay cost, and
verifies external-MCP/Build-Studio equivalence. Do not duplicate BI-921's repair.

The source audit found the schema/owners above and the kernel recommended this
option set. Independent initiative review runs through the server-issued reviewer
routes (request_coworker with the initiative-review binding from the readiness
recovery packet); authors do not hold the receipt writers directly, and that is
the intended authority split, not a blocker. Reviewer receipts are bound to the
immutable blob of this file at the reviewed commit, so any edit after a receipt
requires the affected gates to be re-recorded at the new head.

## PR-submit coding close and awaiting-acceptance (BI-7161625D)

Operator-ratified 2026-09-07. This addendum extends OBJ-DC-2/3/4; it is not a
second close-out design. Kernel scoring the same day preferred later verification
over treating merge as `done` (9.52 vs 6.20). The operator then locked a sharper
split: **coding ends when the merge-ready PR is submitted**, and **acceptance is
a separate `BacklogItem.status` batched in verification loops that do not use the
original thread, author, or worktree.**

This supersedes the earlier "prove we do not need a new status" clause on
BI-7161625D. Workroom `verifying` stays room liveness and is not reused as the
item lifecycle.

### Research note (medium-item design)

Problem: `done` mixed coding close-out with live acceptance. Authoring threads
were gone before `update_backlog_item_status(done)` could run, so shipped PRs
stayed `open` and `get_next_recommended_work` kept offering them. Observed
2026-09-07: BI-CA54ACC8 (#5126), BI-E54F7F87 (#4972), BI-D58567DC (#5044),
BI-SIG-463E478D (#5052), BI-MCP-EFF-CD5F744B (#4899) were on `origin/main` and
still `open`.

Options considered:

1. **Keep `done` as coding close; file misses as new BIs.** Fastest for authors;
   collapses acceptance into merge. Rejected: kernel and operator require live
   acceptance after deploy.
2. **Leave items `open`/`in-progress` until a later verification loop marks
   `done`.** No enum change. Rejected: the coding pool and next-work selector
   cannot tell shipped work from unstarted work (the 467-item rot).
3. **Add `awaiting-acceptance` and close coding at PR submit.** Chosen. DPF
   opens PRs only when merge-ready (no drafts), so submit is a durable server
   event. Verification stays independent.

Benchmarks: GitHub can close issues on merge — too late for DPF, whose PRs are
already merge-ready at open, and too early for acceptance (merge ≠ served SHA).
Jira/Linear "In Review" is the analogue we adopt, as a closed Prisma enum value,
not a free-form string. Argo Rollouts analysis and the parent spec's
release-scoped acceptance still own the later pass (OBJ-DC-3).

### Contracts added

- **OBJ-DC-8:** A merge-ready GitHub PR for a linked BacklogItem moves that item
  from `triaging`/`open`/`in-progress` to `awaiting-acceptance` without an
  authoring-session tool call. The item leaves implementation-ready next-work.
  `done` is reserved for batched verification against the served SHA.
  (contract CT-DC-PR-SUBMIT)

| Acceptance | Objectives | Statement |
| --- | --- | --- |
| AC-DC-8 | OBJ-DC-2, OBJ-DC-3, OBJ-DC-8 | Opening or marking ready a non-draft PR stamps the Workroom PR identity and moves the linked item to `awaiting-acceptance`. Withdrawing an unmerged PR returns it to `open`. `get_next_recommended_work` does not offer `awaiting-acceptance` as implementation-ready. A later verification loop moves a pass to `done` and files exactly one corrective BI on a fail, leaving the original in `awaiting-acceptance`. Already-PRed open items reconcile via Workroom `pullRequestNumber` or evidence `/pull/N` links without reconstructing the original session. |

Legal transitions (extend `apps/web/lib/backlog/transitions.ts`; do not fork):

- `triaging` / `open` / `in-progress` → `awaiting-acceptance` on PR submit
- `awaiting-acceptance` → `done` on verification pass (`completeBacklogItemTransition`)
- `awaiting-acceptance` → `open` if the PR is closed without merge
- `awaiting-acceptance` → `retired` for discarded delivered demand

Coding agents never own `awaiting-acceptance` → `done`. Federation does not
project `awaiting-acceptance` (delivered locally, not open demand). Visibility
gets a fourth bucket so the active coding lens does not show PRed work. Epic
remaining-count still treats the item as unfinished until `done`/`retired`.

Trigger: GitHub `pull_request` webhook on the existing
`/api/platform/git/updates` intake. Push-only sandbox evaluation is unchanged.
The actuator is server-side (`apps/web/lib/backlog/pr-submit-awaiting-acceptance.ts`)
so it survives the authoring session. A bounded reconcile sweeps Workrooms that
already have a PR number and items whose evidence links name `/pull/N`.

Failure: reuse the existing corrective-intake fingerprint
(`capture-corrective-bi.ts` pattern). Do not reopen the coding thread.

## Deployment closure addendum — 2026-10-03, BI-7161625D

The operator directed implementation of deployment-based BI closure and preparation of safe cleanup. For direct platform source delivery (the existing platform/common, no build/product/objective predicate), this supersedes earlier statements in this design that `done` always requires acceptance. A server-resolved merged PR included in the successful canonical deployment may close delivery. The terminal activity records deployment identity, closure basis and the actual acceptance state. Pending, unavailable or failed acceptance is never relabeled passed; a subsequent miss can create corrective work while the delivered original stays closed.

Extend the existing governed completion transaction, durable activities, SelfUpgradeRun and canonical served identity. Missing proof, a mismatched repository/served identity, unmerged code, conflicting or malformed scope and denied authority cannot use this path. Product/customer acceptance retains its contract. No new lifecycle enum or parallel completion engine is introduced. The implementation plan is [deployment-based BI closure](../plans/2026-10-03-deployment-bi-closure.md).

Delivery closure and source cleanup remain distinct decisions. Existing liveness, ownership, dirty-tree, pin and unmerged-work protections apply even to a closed BI. Prepare the concrete janitor report before any operator-approved removal. An unreadable ownership source means keep, never infer abandonment.

## Retained acceptance binding — 2026-10-16, BI-E3B918C2

DESIGN preparation only. This extends CT-DC-ACCEPTANCE, OBJ-DC-3/4 and AC-DC-6;
it does not approve Large implementation or complete the release campaign.
PR #6230 preserved wakeups and obligations but intentionally retained missing
reviewer/revision bindings as unresolved. Small delivered BI-D33F968A is a real
example. Medium-only 6451 recovery does not repair that Small obligation.

Kernel DI-AF2BCA4787FD chose RuntimeVerification over overloading objective
mappings with a non-baseline result variant. DI-CC29314E6113 chose independent
final criteria adoption rather than adding a separate Small plan-approval gate.
Both signals are usable, autonomy eligible and high confidence; their feature
estimates are grade C, not measurements. Agent outcomes are recorded. Neither
consult is native design approval, Large admission or acceptance.

### Canonical result and immutable criteria

Extend the existing final-acceptance RuntimeVerification result with a versioned
server-owned binding. Reuse TaskRun, the acceptance sweep and Task Hub. Add no
acceptance table, scheduler, provider, lifecycle status or parallel result ledger.
Objective mappings and raw observations remain references to their own records.

The binding identifies the original item/organization and canonical-deployment
closure activity; contract/version/digest; immutable criteria and check-plan
artifact; delivered repository/authored head/verified merge; installation,
actual served SHA and successful upgrade generation; tenant/persona/fixture and
check-definition digests; observation interval/evidence; and authenticated
reviewer/authority and exact reviewer-run generation. An acceptance_owed snapshot
is a projection, not the original obligation identity.

Use existing Document/DocumentVersion managed Markdown storage for prospective
criteria/check plans. Bind the exact version row and server-computed contentSha256,
not Document.currentVersionId alone. Source references distinguish original
criteria proven by existing artifacts/history from prospective check procedures.
Keep original body/source authors and the substantive plan author attributable.
A current BI body is an input with a captured digest; editing it cannot rewrite
the issued version or alter an in-flight result.

Proposed interface: extend the existing record_initiative_evidence operation set
with a governed acceptance-plan preparation operation. It accepts the item,
original closure reference, genuine criteria source references and proposed check
content. The service re-resolves subject/organization/closure/source authority,
computes the digest and records the authenticated author through the existing
document-store version writer. It creates no initiative scope baseline and
grants no acceptance power. A missing original criteria provenance returns a
typed criteria-provenance-missing remedy naming the actual owning principal or
unresolved role and this preparation operation; it does not silently substitute
a new goal or an unexplained empty gate list.

The preparation writer must reuse an extracted DB-only version append port from
saveManagedDocument, not call its outer transaction or embedding/rendition work
inside another transaction. Lock the item before the stable obligation document;
identical normalized content/provenance reuses the existing version, while a
substantive change appends a version. Keep managed-document projections after
commit. Preserve document history and applicable artifact retention pins.
Use immutable DocumentVersion.createdBy for version authorship; the mutable
Document.createdBy projection cannot replace original or substantive authors.
Adopting unchanged bytes preserves that authorship rather than rewriting it.
This is a proposed extension, not a currently available live operation.

For Small retained obligations, introduce no separate plan-approval gate. The
independently eligible final verifier judges the frozen plan adequate for the
original named criteria within its existing acceptance mandate and records that
judgment AND actual runtime observations in one typed receipt. Adoption alone
never fulfills acceptance. Inadequate or unproven criteria remain unresolved.
E3 implementation still owes its own Large approvals; they do not approve a
Small acceptance plan. Existing governed baseline approvals retain their rules.

Substantive authorship includes changing criteria, expected results, thresholds
or claimed coverage. Such an author cannot verify that scope. Acknowledging an
unchanged artifact is adoption, not authorship. Selecting permitted execution
details within its frozen procedure is not a new approval gate; changing material
fixture/context requires a new immutable binding and appropriate checks.
Cosmetic formatting, a new nonce, a different actor or a digest representation
change does not create a new acceptance obligation or authorize duplicate checks.
Resolve any relevant uncertain original execution through its supported recovery
contract before dispatch; a new packet cannot route around that uncertainty.

### Issuer, shape and actual execution context

Extend the existing acceptance-verification shape with a deliberate 1.2.0
successor; preserve pinned 1.0.0/1.1.0 definitions. The verify stage adds
record_runtime_verification to its existing mandated tools and declares exactly
the canonical required grant work_capsule_write. A shape ceiling never grants
that permission to a live actor: owner selection must find an actually eligible
independent actor with the existing effective grants/capabilities. Missing grants
or a pinned old shape returns an owning remedy through normal role assignment
or rebind_workroom_shape; never silently upgrade a room or widen permissions.

Extend issuance alongside issueAcceptanceObjectiveMappingPacket with a distinct
typed retained-runtime packet. Existing baseline-mapping packets remain unchanged.
Freeze criteria/version/digest, original closure, delivered subject, check context
and applicable runtime BEFORE check dispatch. Reuse server-owned request HMAC
and deterministic task identity; do not accept a caller-made binding flag.

The sweep records that packet as its own latest steward-room activity. Extend
the existing steward authority chain: exact acceptanceRoomKey/capsule/source and
outcome anchor, supported shape and verify-role binding, sweep-authored latest
packet, authenticated request digest, matching target agent, working TR-SCHED
sourceRef and exclusion of delivery/criteria/plan authors. Do not reuse an
unrelated uncertain review TaskRun or its budget.

Use the existing acceptance steward Workroom row as the shared packet-generation
fence. Retained packet issuance, replacement, withdrawal and completion lock that
same row and reread the latest packet and role binding under it. Whichever wins
the fence first is authoritative: a committed withdrawal cannot be followed by
a completion using the withdrawn packet. Serializable reads alone do not supply
this ordering. Audit global-sweep issuance and reviewer completion for inversions.

Propagate ToolContext.taskRunId through runtime-coordination/mcp-handlers.ts into
the typed runtime writer. Resolve the packet from server records and the actual
TaskRun; public result JSON is never authority. Enforce the same reserved
acceptance namespace in the shared runtime service so another ordinary writer
cannot forge it. Existing ordinary health/unit/UX observations remain unchanged.
The issuer and writer are proposed changes requiring normal Large admission.

### Reviewer identity and real transaction fences

Resolve the actual canonical Principal using reviewer-identity/GAID precedence.
Fail closed on absent or ambiguous identity; the generic actor helper's null
fallback is insufficient here. Exclude the full source delivery agent set AND
authenticated source, criteria and substantive plan author principals. Agent-only
delivery-actors.ts is not a human/principal exclusion set. Different chats with
the same accountable identity are not independent.

The reviewer's ownership is its own generation, not the global sweep's completed
lease. Reuse/extract the existing scheduled-task ownership protocol for the
reviewer ScheduledAgentTask: an owner token, exact TaskRun and expiry are bound
before execution and renewed only by that worker. A successor changes the token;
an expired or stale reviewer cannot commit even if its TaskRun still says working.

Require a real serializable transaction for typed acceptance; do not use the
generic inTransaction fallback fn(db). Pass the same transaction client through
authority/exclusions, ownership, duplicate lookup/create and projection writes.
Use this lock order for the new path: installation quiescence row; reviewer
ScheduledAgentTask; TaskRun; BacklogItem; acceptance steward Workroom;
immutable closure/document/source-room
bindings; then authoritative permission/binding rows in stable table/id order.
Audit existing interacting paths against it before implementation.

Take a shared lock on the existing PlatformConfig portal.quiescence row and
require persisted normal state. Canonical upgrades must update this same row
before drain/swap, so their write serializes with acceptance completion. Re-read
the authoritative successful SelfUpgradeRun generation and served identity
under this fence. Missing row, ambiguous generation, changed target or unknown
state refuses completion; a pre-transaction network read alone is insufficient.
Test every supported canonical upgrade path rather than assuming it shares this
protocol. No host-maintenance or direct-runtime substitute is authorized.

Resolve current actor capabilities/grants and applicable token/mandate authority
inside the same transaction. Lock the actual authority rows read, not merely a
Principal row that a grant deletion need not touch. Expiry uses database wall
clock and is rechecked before commit. Revocation visible at completion refuses
a new write. Once a valid receipt exists, later ordinary revocation preserves
that historical judgment; it is not re-authorized using today's grants or a
rotated secret. An explicit relevant invalidating finding is a separate fact.

### Primary attachment, duplicate and historical fulfillment

Add a context-validated retained-acceptance branch to the existing input validator.
Its sole primary attach point is the exact same-item/org status_change activity
with to=done and closureBasis=canonical-deployment. The current generic validator
does not count backlogActivityId. Reject competing runtime/build/candidate/room
or activity primary attachments; secondary runtime/room references belong in
the validated binding. Ordinary observation attachment rules stay unchanged.

Derive verificationId on the server from the canonical original closure,
contract/criteria/check-plan context, installation, campaign upgrade identity
and admitted reviewer execution identity. Use the existing unique verificationId
constraint and item/reviewer fences. Equal concurrent completion returns one
existing receipt; conflicting verdict/evidence refuses. Compare immutable semantic
content, excluding freshly generated audit timestamps/decision identifiers.
Do not change a passed result to fit a later contract.

The typed writer atomically records the result and a validated fulfillment
reference through the existing acceptance_owed projection. RuntimeVerification
is authoritative; the snapshot is a checked pointer/digest, not a second result
ledger. It retains the accepted actor/authority/request snapshot needed after
ephemeral TaskRun/audit retention or key rotation. Generic notes and unbound
result JSON cannot create that pointer or become acceptance.

Use unique-ID lookup for a known issued execution/fulfillment pointer. Recovery
and history query exact backlogActivityId plus kind=final-acceptance, ordered
createdAt DESC,id DESC with a strict tuple cursor and bounded 100-row pages.
Add a forward-only index on those existing columns after real query-plan
qualification. Persist incomplete lookup continuation in the existing acceptance
room/controller state; no latest-N cap may silently hide a relevant receipt.
Newer unrelated observations are ignored; an authenticated relevant newer
failure or unsupported binding version remains explicit. Revalidate the read
generation before committing a projection. Test at least 10,000 receipts with
equal timestamps and interrupted paging; EP-WORKROOM-CLOSEOUT owns fleet scale.

A known pointer proves its receipt, not the absence of subsequent relevant facts.
Use the existing steward Workroom activitySequence as the current-through
watermark, scoped to the obligation and contract in the projection. All typed
result, criteria/contract and invalidating-observation writers lock the same item
and steward row and append their existing Workroom activity in that transaction.
The writer's activity generation orders committed facts; receipt insertion time
does not determine observation recency. Preserve the admitted campaign/runtime
generation and observation interval to distinguish delayed older observations
from a genuinely later relevant failure; ambiguous overlap stays unresolved.
Recheck the sequence under the projection fence; on change, resolve intervening
relevant events before publishing current acceptance. An interrupted scan yields
pending/unresolved current applicability while preserving historical Verified
on N. Do not treat acceptance_owed snapshots as cached current verdicts. Prove
that every supported relevant writer participates; an unfenced path prevents
this optimization rather than allowing an assumed current pass.

Separate two predicates. Admission/write requires the exact current applicable
runtime and refuses rollback/drift between preparation and commit. A valid
immutable result fulfills its named original obligation/campaign and remains
Verified on release N after unrelated N+1. It does not certify N+1. A later SHA
inequality alone neither erases that fulfillment nor reopens every original.
Explicit changed contract/new campaign or a later relevant observed failure
owns additional work. Do not give an old pass to a new obligation.

The sweep consumes validated receipts before its unresolved fallback. Keep
delivered originals Done; behavior failure uses existing deduplicated corrective
intake, while infrastructure/incomplete execution uses bounded existing retry.
Preserve fail/incomplete panels, review rounds and every original Task. This
receipt cannot settle unrelated child processes/remote effects or authorize
old uncertain-review replay.

### Operator view, compatibility and verification

Use the existing Task Hub/read model: delivery Done with separate acceptance
Pending, Passed, Failed or Unresolved, actual next owner/event and Verified on N
versus current applicability. Details expose immutable criteria, reviewer,
check context and evidence. Reuse theme tokens, focus behavior and narrow-screen
components. No new dashboard, author-session retention or routine approval loop.

Legacy, malformed, caller-forged and unknown-version data cannot become a pass.
Mixed-version readers remain explicit. Rollback disables the new actuator/consumer
while preserving all observations, receipts and pending work; no invented
historical backfill or bulk status rewrite. Preserve accepted history separately
from current verification freshness.

[in-toto Statement v1](https://github.com/in-toto/attestation/blob/main/spec/v1/statement.md)
supports immutable subject/type separation; use existing DPF authority/persistence,
not another signing service.
[Argo Rollouts analysis](https://argo-rollouts.readthedocs.io/en/stable/features/analysis/)
separates check definitions/executions and retains inconclusive results; absorb
those semantics into the existing sweep, not another controller.

Required first-failing tests cover real issuer-to-drive-to-TaskRun-to-writer
context, pinned shapes/missing grants, Small criteria provenance/adoption and
author exclusions, closure-only attachment, equal/conflicting concurrency,
stale reviewer after sweep completion/takeover, grant revocation, upgrade between
preparation and commit, rollback, historical N→N+1 display, changed contract and
later failure, malformed/future versions, and bounded 10,000-receipt recovery.
Run real PostgreSQL and native adapters before containing-release acceptance.
All implementation, new tests and native Large approvals remain unrun. See the
[existing wakeup plan](../plans/2026-10-12-acceptance-upgrade-wakeup.md).
