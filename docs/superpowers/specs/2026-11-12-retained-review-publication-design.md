---
status: active
---

# Retain completed review publication — BI-2A8A8FC8

## Objective and scope

A completed native semantic review must keep its publication obligation durable
until its server-resolved verdict is observed at GitHub, or an accurate technical
hold names an owner and next action. Review outcome stays completed; publication
is a separate phase of the same TaskRun. One atomic repair, one BI and one PR.

Design/preparation owner: public Workroom WC-BA6043DF, this chat's
codex/native-review-publication-recovery branch. It is a proposed external
implementer only. The subsequent normal implementation claim was refused because
existing native WC-D87C0262 / FB-E91802DE was active; that ownership refusal
remains binding. BI-2A8A8FC8 is the public implementation carrier for this ordered
fix design. This document is not a separate documentation implementation item,
an implementation admission, or a claim to private source content.
Funding scope is unresolved; this design grants no funding or inference authority.

## Observed source and grounding

Inspected a20ebaff6266eda6a9f4dcfb3582ddfe40d3f1a7:
semantic-review-background.ts persists final TaskRun/receipt, then attempts the
publisher. Its catch returns publicationPending/reason only to the worker.
reconcileSemanticReviews excludes completed tasks. The existing two-minute
mcp/task-run-dispatch-reconciliation job is the recovery owner, already quiescence
gated. failure-readiness-delivery-refresh.ts runs only for ready PRs or when
readiness is the sole red check, inside the PR reconciler's actuation policy.

Thus a lost publication cannot rely on PR readiness refresh, particularly with
another red check. This is a source gap, not proof of original transport or
authorization cause. Actual current public examples include PR6966 and PR6972;
the latter had retained native two-branch PASS cmwct19kg3y1r0emf295jid5u, followed
by a normal push and a successful status LIST returning no trusted readiness
status. Earlier PR6955/6956 later merged; that is not permanent recovery proof.

Grounding remains the shared-change-reviewer-control-design's Enforcement and
recovery, pr-follow-through-workroom-duty-design §§3.1–3.6 and the build-gate
runbook. Reuse TaskRun.progressPayload, immutable TaskArtifact request,
ExternalEvidenceRecord receipt, Workroom activity/readback, existing job,
inspectSemanticReviewAuthority, assessSemanticReviewReceiptFreshness,
resolveFailureAnalysisEvidence and the trusted server status publisher.
No new table, endpoint, status assertion tool, scheduler, provider, credential,
grant, review request, paid inference, auto-merge mode or production fixture.

## Acceptance contract

- Force a post-receipt publisher transport failure: the completed immutable review remains saved and its pending publication/error is durable and visible, with a named technical owner/next action.
- Through the existing governed job, a bounded legitimate continuation validates current room/head/tree/digest, evidence, receipt freshness, actor/grants and configured trusted publisher; it publishes the server verdict once without another model call, author artifact or new spend.
- Permission denial, changed source, revoked/expired evidence and an actual FAIL remain held with accurate reasons; no blind retry or success assertion. An uncertain/lost response is reconciled under the same operation before another effect.
- Survive worker restart/response loss; exercise retry bounds, concurrent/head-change fences and saved reload. Use existing job/evidence ownership rather than a parallel work carrier.
- Reuse the existing failed-check rerun only after genuine valid status publication; normal DCO, source tests/typechecks, native independent review, protected checks/queue and canonical deployment stay mandatory.
- Verify the actual retained PR6955/6956 scenario after delivery when the original receipts are still eligible, or record their real staleness/hold. This criterion does not itself authorize replay of either completed assessment or manual green status.

## Publication contract

PUB-IDENTITY: Bind the operation to the original task/request digest, receipt id,
repository and immutable source commit plus full review identity. Never follow
a changed room head. Read the original packet through request-store; recheck
current actor/task grants, current Workroom source, full receipt freshness,
current failure-analysis evidence and the authoritative current verdict.
Only the same eligible reviewed receipt may satisfy this continuation. FAIL,
inconclusive, exception-only, revoked/stale evidence, unknown legacy identities
and authority denial cannot produce a success status. Preserve existing general
publisher behavior for other callers; an optional internal expected binding must
fence this continuation and be checked inside the publisher before its effect.

PUB-DURABLE: In the transaction saving terminal review and receipt, retain a
versioned publication marker in the same semanticReview payload before any
remote effect. Fields: immutable binding, phase, attempt count, last/next
observation, fixed safe reason, accountable role and next action. Use existing
TaskRun CAS/updatedAt plus an operation generation; no separate work carrier.
Review state/receipt/completedAt never change to submitted or working for
publication. A server crash after review commit leaves a discoverable obligation.
Existing eligible completed native tasks with no marker are initially uncertain,
never assumed unpublished or allowed to infer again.

PUB-BOUNDS: The existing dispatch-reconciliation job processes a bounded batch
independently of PR check readiness and broad merge actuation mode, within its
current entry quiescence gate. Reuse the existing SEMANTIC_REVIEW_MAX_ATTEMPTS value (three) as the
maximum publication-effect cap; do not misstate the reconciliation job's own
retries:1 as a three-attempt policy. Persist publication consumption
before the effect so worker/job replay cannot replenish it. Publication does not
consume/reset an inference dispatch or recovery counter. Use bounded backoff and
receipt/evidence eligibility for retry time limits; no new provider or spend.
The cap's reuse requires the normal policy/source review; it does not grant
another inference attempt or extend an original review deadline.
Missing/invalid counters or marker identities hold; exhausted attempts name the
technical delivery owner. A terminal denied/changed/stale hold is not retried
unchanged. An unreachable observation remains unconfirmed, not absent.

PUB-RECONCILE: Before a subsequent write, observe the exact commit's status LIST,
not the combined status endpoint. Validate complete/parseable response, exact
context, current configured publisher identity, expected state and the existing
one-hour status freshness contract. A matching trusted status settles the same
operation without another POST. Lost POST response/worker restart/concurrent
tick first reconcile; CAS reserves the effect once and a fresh operation owner
cannot overlap an active generation. A stale claim cannot publish by merely
timing out; uncertain predecessor execution requires observation/settlement.
If a prior POST may still be executing or its response was lost and the
matching remote status cannot be confirmed, retain an unconfirmed hold. A
missing status on one read does not prove that in-flight work settled. Only
proven not-dispatched/settled transient failure may spend another bounded POST.
GitHub commit statuses have no caller idempotency key; do not promise exactly
once remote creation across an unknowable response. Never infer permission from
a 404 or missing row; only a verified current target and allowed transient
failure can enter the bounded continuation. No raw provider text/secrets enter
saved owner copy.

PUB-VISIBLE: Existing owner-admitted Task/Workroom readback exposes review
outcome separately from publication pending/published/held/unconfirmed, safe
reason, technical owner and concrete next action. A terminal review result must
not imply protected delivery or business acceptance. Reload uses durable state.
No new controls or route, no access expansion, no generic request to resend the
review. Use existing activity/result projection and content admission.

PUB-DELIVERY: Only genuine valid publication permits the existing failed-check
rerun path. Do not clear unrelated checks, assert success from client material,
replay a completed review, change protected checks, or merge outside the queue.
Source tests, canonical exact-tree gate, independent native review and served
acceptance remain separate.

## Ordered implementation and verification

1. PUBLISH-RED — Before production edits, claim actual affected source/tests and
   consume find_related_tests and changeImpactContract, expanding verification
   when graph advice is missing. Reproduce worker post-receipt throw, restart
   after commit/before POST, response loss after effect, duplicate/concurrent
   ticks, changed head, receipt/evidence staleness, grants denied, actual FAIL,
   malformed counters and exhausted budget. Assert no new inference, unchanged
   original receipt and task completion, durable publication state and reload.
   Use injected provider/DB ports and labelled isolated test records only.

2. PUBLISH-STATE — Add a small typed publication helper beside existing
   change-review modules and integrate terminal worker persistence. Extract
   shared pure state validation/readback rather than further growing the worker.
   Persist intent before remote work; CAS reserve/finalize only this operation.
   Tests distinguish observation unavailable from verified missing status.
   Contracts PUB-IDENTITY/PUB-DURABLE/PUB-BOUNDS, verified by PUBLISH-TESTS.

3. PUBLISH-RECOVER — Extend the existing reconciliation function/job to process
   completed native publication obligations independently of other PR reds.
   Recheck current authority/source/receipt/evidence before any effect; use the
   same server publisher and status LIST reconciliation with expected binding.
   Initial legacy recovery is observation-first and must prove exact original
   receipt provenance. Concurrency, response loss, denial/staleness and bounded
   retries retain truthful holds. Contracts PUB-RECONCILE/PUB-DELIVERY, verified
   by PUBLISH-TESTS and PUBLISH-INTEGRATION.

4. PUBLISH-READBACK — Extend existing authorized Task/Workroom projection with
   bounded durable publication facts and fixed technical next actions. Verify
   saved reload, no secret/raw provider content, and unchanged content/actor
   access. Update the current delivery documentation, not historical specs.
   Contract PUB-VISIBLE, verified by PUBLISH-TESTS and PUBLISH-OWNER.

5. PUBLISH-DELIVER — Run affected unit suites, both web TypeScript programs and
   impact guards. Commit a signed clean tree. Obtain exact-tree canonical gate,
   one independent native semantic review of that identity, protected PR checks
   and queue merge; use pr:health without treating unreadable evidence as READY.
   Advance only through request_self_upgrade. Exercise served owner
   saved-review/pending/hold/recovery/reload with authorized isolated fixtures.
   Reconcile the retained PR6972/6966 (and older examples if eligible) without
   inference replay/manual status. Record actual stale holds if no longer
   eligible. Obtain independent medium acceptance and update BI/report accurately.

PUBLISH-TESTS means actual targeted worker/publication/status/readback suites,
including existing authority/failure-analysis and review recovery regressions.
PUBLISH-INTEGRATION means the canonical merged-tree gate and existing job
transaction/ports integration, not a worktree-launched portal.
PUBLISH-OWNER means served owner Task/Workroom state/reload and actual trusted
status/check readback after deployed containment, with no new expense/payment.

## Options and decision quality

Considered expanding only PR refresh versus retaining the original TaskRun
publication obligation in its existing reconciliation job. The former cannot
cover pre-PR/other-red/merge-mode-disabled cases; it is not a complete fix.
Kernel DI-49169E84F60A preferred the latter relatively but returned low confidence
and all-options-opposed because the supplied feature inputs described five cost
axes while omitting most benefit/evidence dimensions. This advisory is NOT a
passing autonomy or implementation decision. Preserve it. A second evaluation
DI-E808C2B68C93 supplied all20 relevant dimensions with explicitly labelled
engineering estimates and the actual source/occurrence context; it returned
proceed/high-confidence/autonomyEligible with no blockers. Choose same-task
continuation. Neither advisory grants implementation, funding or publication:
normal immutable coverage/readiness and independent review remain required.

## Backlog coverage

Decision atomic: PUBLISH-RED, STATE, RECOVER, READBACK and DELIVER form one
completed-review publication continuation. State without its resumer would strand
work; resumption without fencing could publish an ineligible verdict; readback
without durable state would mislead. None is independently shippable.
All map to BI-2A8A8FC8. The normal server record_plan_backlog_coverage must bind
this exact immutable path/blob and current scope/criteria before implementation
admission; this text is not that receipt. No baseline or coverage is fabricated.

## Failure analysis and rollback

Incorrect green or changed-head publication: prevent by authoritative receipt/
evidence/actor checks and exact expected target inside the existing publisher;
detect with denial, stale, head-race and competing-review regressions.
Duplicate effect/inference: prevent with original task CAS and persisted attempt,
observation-first recovery; provider-call counts must remain unchanged.
Crash/lost response: durable intent survives; if effect cannot be reconciled,
hold accurately rather than assert absence or spend a new assessment.
Hidden retry exhaustion/denial: fixed durable reason, technical delivery owner
and next action exposed through existing admitted readback.
Raw failure content: fixed reason classes and shared bounded redaction; tests
include credential-bearing errors. No new secret collection.
Unchanged held authority remains held. A protected revert removes the continuation,
preserves original receipts and publication history, and leaves missing status
unsatisfied. It does not revoke a real status or relabel an UNKNOWN review.

## As built (2026-11-13)

Owner change: room WC-BA6043DF passed to a Claude session on 2026-11-13 under
WWMD decision DI-BB9CED5CD546. Build Studio build FB-E91802DE stopped on a
mechanical Prose Lint Guard failure, not on a question for a person
(BI-91A085BC), so its earlier claim no longer blocks this work.

- `apps/web/lib/change-review/semantic-review-publication.ts` holds the
  publication record and one bounded step. The worker saves the record in the
  same transaction as the verdict, only when the request names its source
  commit, then makes the first attempt. A review with no bound commit keeps
  the old single direct attempt.
- `mcp/task-run-dispatch-reconciliation` gains the step
  `resume-retained-review-publications` (batch of 25). It does not depend on
  PR check state or the merge reconciler's mode.
- `publishFailureReadinessStatus` takes an optional `expectedHeadSha`. It
  checks that before the verdict or any post, and its errors now carry a typed
  code, so a rate-limited 403 is told apart from a permission refusal.
- The room's review view shows each review's publication state, reason, owner,
  attempts and next action. A current review whose status is not posted yet
  raises room attention.

Where this differs from the contract above:

- **No status read before a repeat post.** GitHub keeps the newest status per
  context. A repeat post after a lost response re-reads the server verdict for
  the same fenced commit and lands on the same result. A claim older than five
  minutes counts as a dead worker and spends one of the three attempts.
- **Old reviews with no record are not swept.** Completed reviews saved before
  this change have no record. They are left alone, never assumed unpublished.
  The PR delivery reconciler's existing refresh still covers ready PRs.
- **Authority that cannot be read waits.** It does not use an attempt. The
  24-hour window bounds it.
- **The failed-check rerun stays with the PR delivery reconciler.** It runs
  only after a real post.

## Delivery evidence

Design preparation only. Original signed df5d0fc93dafc87fa09426463dc7a8145eaf4763
was pushed normally with the fresh docs-only exemption and no override. Its exact
public immutable read succeeded. Formal plan coverage then failed provider
provenance resolution with UND_ERR_CONNECT_TIMEOUT after two attempts; no receipt
was recorded. The external implementation claim was refused by the active native
owner, so no production code was edited.

Unchanged-runtime baseline: four existing worker/readback/publication/job suites
passed 131 tests. This is baseline only, not repair verification. The concrete
existing FB-E91802DE handoff saved exact branch/commit/blob, all six criteria,
baseline checks, actual provider failure and active-owner refusal, plus the
PR6970/6972 missing-status cases. Stable evidence cmwctwn6p46js0emfqn9yqwpz;
current ownership qualification cmwctxpag46zt0emfmlt5r6hn. Notes are not admission.

Next action belongs to the existing native implementation owner: resolve this
current immutable design/source binding, record actual atomic coverage, then earn
normal implementation admission and complete the ordered fix. No implementation,
canonical coverage, native approval, protected publication, deployment or owner
acceptance is asserted here.

