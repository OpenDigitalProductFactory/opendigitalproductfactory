---
status: draft
---

# Portal outcome convergence

**Backlog:** BI-81AB897A. **Workroom:** WC-6D8C9787.
**Status:** proposed integration scope; independent approval pending.

The confirmed task scope is investigation and an improvement plan. The October
28 request asks to complete this thread's outcomes; clarification of whether it
also extends to implementation is pending. This commit changes documents only.
Future execution needs operator scope authorization and current shape, coverage
and independent admission. Within an authorized scope, a phase change alone
does not require another confirmation.

## Problem and boundaries

The client-help incident exposes disconnected representations of a single job:
page facts, assistant perception, work ownership, recovery and completion.
The [current assessment](../audits/2026-10-28-portal-outcome-assessment.md)
distinguishes observed failures, source-only coverage and unmeasured behavior.
This design amends the integration boundary of existing contracts. It creates
no issue database, workflow engine, scheduler, permission bypass or parallel
COO. Existing delivery owners and review receipts remain authoritative.

## Design grounding

Reuse the [portal evaluation framework](../../architecture/portal-ux-evaluation-framework.md),
[page perception contract](2026-08-05-coworker-page-perception-context-contract-design.md),
[authorized surface contract](2026-08-08-authorized-surface-contract-design.md),
[coordinated Workrooms](2026-09-03-coordinated-workrooms-design.md),
[toolchain delivery](2026-10-07-agent-toolchain-release-delivery-design.md), and
[background observation contract](../../architecture/background-operation-observation-contract.md).
The October 25 COO amendment owns recovery follow-through; Workroom drive owns
dispatch; room coordinators own local resolution; independent reviewers own
gate verdicts. The human owns decisions reserved by the current action policy.

## Objectives

**OBJ-FACTS:** The operator and authorized coworker read consistent current facts,
with loaded, installed and released tool identities kept distinct.

**OBJ-CONTINUITY:** An accepted request retains its identity, context, confirmed
effects and next safe action through interruption and recovery.

**OBJ-OWNERSHIP:** A stalled job reaches a competent authorized owner, acknowledged
action and COO follow-through without an unowned ticket replacing execution.

**OBJ-TRUTH:** Presentation distinguishes captured, queued, executing, waiting,
artifact-complete, released and verified outcomes using existing source evidence.

**OBJ-COVERAGE:** Every portal route has an explicit coverage disposition, and
critical journeys have repeatable positive/adverse-state verification.

## Integration design

1. Extend existing read models and the authorized-surface registry. For client
   help, use `connected-clients.ts` once as the projection authority; strip
   credential identifiers from assistant summaries and apply current read
   authority before loading. A missing/unavailable projection remains explicit.
   Static route personas are adapters; the COO front-door contract retains its
   existing scope and clearance policy.
2. Use accepted message/request identity as the continuation anchor. Reuse
   TaskRun, ScheduledAgentTask, Workroom checkpoint/activity and result receipts.
   A retry requires current authority and budget, a bounded deadline and effect
   reconciliation. Unknown outcomes cannot be blindly replayed. Cancellation,
   revoked access, independent gates and explicit pauses remain effective.
3. Reuse the room-local/COO recovery contract. An obligation names local owner,
   follow-through owner, acknowledgement deadline, next check, blocker evidence
   and exact result locator. Requesting or enqueueing work is not acknowledgement
   of its outcome. Necessary human decisions surface once through owner attention.
4. Derive completion from the existing canonical source and delivery evidence.
   A historical finished artifact cannot label unresolved tasks as completed or
   claim that a release is running. Keep historical/raw evidence readable.
5. Extend existing purpose/route/surface contracts and regression tests. The
   audit export is a dated snapshot, never a second mutable registry. Select
   representative job/state fixtures and expand to shared consumers on failure.

## Research and benchmarking

Primary sources checked October 28:

| Implementation | Adopt | Reject or limit |
| --- | --- | --- |
| [Inngest durable error handling](https://www.inngest.com/docs/durable-execution/guides-and-advanced/error-handling), open-source engine and hosted service | Persist completed step results; distinguish temporary, permanent and exhausted failure; stable idempotency keys for effects | Retries alone do not make an external action exactly once. No second recovery store. |
| [Temporal Durable AI](https://docs.temporal.io/ai), open-source server and commercial Cloud offering | Durable continuation, recovery after interruption and workload fairness as acceptance benchmarks | Do not add Temporal alongside DPF's existing durable work/task facilities. |
| [GOV.UK task pattern](https://design-system.service.gov.uk/patterns/complete-multiple-tasks/) | State which tasks remain, their order and real completion; preserve return paths | Do not impose a linear form sequence on every ongoing Workroom. |
| [W3C status messages](https://www.w3.org/WAI/WCAG22/Understanding/status-messages.html) | Expose progress/error/status changes to assistive technology without requiring focus | A status announcement does not establish that an effect happened. |

These are comparisons of continuation/task-state contracts, not a dependency
selection. DPF already has the necessary work carriers. Detailed implementation
of a new continuation adapter must inspect the corresponding persisted request,
deadline, current authority and effect receipt contracts before code admission.

Retrieval record, October 28, 2026 (the primary URLs are linked above): all four
returned readable HTML in the research browser. Inngest's Error handling page
states “reuses results from steps that already succeeded”; Temporal's Durable AI
page states “resumes automatically after a crash”; GOV.UK's task pattern names
task order and completion; W3C's SC 4.1.3 explanation states “without receiving
focus”. These excerpts support the compared patterns, not runtime conformance
or adoption of those products. The public research retrieval is separate from
the canonical-runtime evidence and carries no customer or credential data.

## Acceptance

| Acceptance ID | Objective IDs | Statement |
| --- | --- | --- |
| AC-FACTS | OBJ-FACTS | Client-help responses and the page derive their compatible authorized facts from the same read model, explicitly preserving unknown, unavailable and stale observations. |
| AC-CONTINUITY | OBJ-CONTINUITY | An accepted interactive request can survive navigation, reconnect and server restart and continue without retyping, with no duplicated side effect or authority expansion. |
| AC-OWNERSHIP | OBJ-OWNERSHIP | A blocked journey has a resolved local owner and COO follow-through obligation, acknowledged request, next check and verified result or a necessary human decision. |
| AC-TRUTH | OBJ-TRUTH | Current task and delivery receipts govern completion labels; unresolved tasks, pending promotion and an unverified release cannot appear as a verified deployed outcome. |
| AC-COVERAGE | OBJ-COVERAGE | The route coverage export reconciles exactly to existing inventories and identifies observed, source-only, unmeasured and justified inapplicable evidence without inferred passes. |
| AC-REGRESSION | OBJ-COVERAGE, OBJ-CONTINUITY, OBJ-TRUTH | Critical journeys exercise healthy, loading, stale, denied, capacity-held, failed and recovered states on admitted fixtures, with keyboard/mobile checks and evidence bound to served revision. |

## Compatibility, rollout and rollback

Preserve URLs, source records, identities, receipt histories and authority.
Deliver independently reviewable adapters/projections through existing BIs and
small successor slices. This documentation commit contains no data migration.
The continuity design must prove whether existing request/task/checkpoint rows
can hold executable intent, deadlines and effect receipts. If they cannot, that
slice must obtain data review for an additive compatible expansion, deployment
of tolerant readers/writers, supported migration/backfill and verified cutover
before any contract step. A new table or mandatory field is not pre-approved.
Stand down new recovery dispatch through current policy/release controls while
retaining obligations if a rollout fails. Retained intent keeps its original
identity, authority binding, cancellation and expiry. A rollback may stop new
dispatch but must not erase accepted work, extend deadlines or replay uncertain
effects. Already dispatched effects remain under their original reconciler;
incompatible readers must explicitly hold and expose pending intent. Schema
contraction waits until retained records and old writers are accounted for.
Do not delete evidence or reset queues.

## Failure analysis and admission obligations

These are design constraints for future delivery, not executed runtime
protection. Documentation checks establish only document integrity. Every owning
slice owes positive and adverse runtime evidence before acceptance.

| Failure and effect | Prevention / containment | Detection / recovery | Accountable delivery and evidence owed |
| --- | --- | --- | --- |
| A retained turn is stranded after restart; executable work is lost | Persist request identity before acknowledgement; retain context, expiry and next trigger | Observe task identity/age; continue only proven-not-started work, otherwise reconcile | BI-B7E2DD4B; restart/navigation/expiry fixtures, unrun |
| A lost response causes duplicate external action on retry | Stable effect identity and original receipt reconciliation; unknown effects hold dispatch | Detect missing/conflicting receipts; effect owner settles uncertainty before continuation | BI-B7E2DD4B; uncertain-effect and duplicate-prevention fixtures, unrun |
| Assistant context leaks identifiers or unauthorized facts | Bounded shared projection, identifier/secret removal and current user/coworker read checks | Explicit denied/unavailable state; remove adapter and preserve evidence on detected leak | BI-7CE02DE9; denied-read/redaction fixtures, unrun |
| Recovery storms work, capacity or provider cost | Existing dispatch identity, budget, deadline, backoff and concurrency limits; no new spending authority | Observe acknowledgements/progress; stand down dispatch, retain obligations and reconcile in-flight work | BI-C43FD3E5 and BI-B7E2DD4B; cancel/budget/bounded-dispatch fixtures, unrun |
| Completion claims contradict unresolved tasks or release evidence | Canonical current task-attempt/release projection; preserve superseded attempts | Show conflicts/missing evidence; repair projection without rewriting history | BI-69B29AEC; conflict/pending-release/verified fixtures, unrun |
| Blocked dependencies appear as scheduled execution | Preserve owner, blocker and admissible next action; release independent work separately | Read dependency evidence; resume dependent work only after existing gate/policy resolution | WC-6D8C9787 and Windows owners; acknowledgement/result evidence outstanding |

No runtime risk above is accepted or certified as mitigated by this draft.
Publishing a proposal is bounded by explicit incomplete labels and protected
review; the underlying runtime obligations remain open until evidence exists.

## Scale and verification

Use bounded existing reads, batch ownership lookup, cursor traversal and
event-driven invalidation. Do not scan the entire portal or invoke a model for
every room on each tick. The assessment covers the 373-route source snapshot;
runtime sampling and missing mutation fixtures remain explicit. Native reviews,
canonical shared-runtime tests, protected publication and deployed acceptance
are required according to each slice's shape. No coverage count waives a blocker.
