# Retained acceptance binding continuation

**BI:** BI-E3B918C2
**Scope:** CT-DC-ACCEPTANCE; OBJ-DC-3 and OBJ-DC-4; prerequisite portion of AC-DC-6
**Status:** DESIGN preparation only. Implementation, coverage and independent approvals remain unadmitted.
**Source inspected:** 8fd58cbc0b9047122704550f55bd39f4b901683b

For agentic workers: execute this plan one independently reviewable backlog item at
a time — one BI, one branch, one PR. Use `dpf-tdd` for red-green implementation,
`dpf-local-merge-ci-before-push` plus the plan's completion gate before any success
claim, and `dpf-pr-with-dco` for handoff.

## Existing authority and boundary

Continue the October 16 retained acceptance addendum in
[the delivery closeout design](../specs/2026-09-04-delivery-closeout-cost-efficiency-design.md#retained-acceptance-binding-2026-10-16-bi-e3b918c2)
and its [existing execution plan](2026-10-12-acceptance-upgrade-wakeup.md#retained-reviewerruntime-binding-continuation-october-16).
Those artifacts remain authoritative. This document sequences their first
implementation slice; it does not replace their design, prior delivery or history.

The original criterion remains:

> AC-DC-6: Ten obligations with three compatible checks run three checks and keep ten results; tenant separation, duplicate dispatch, and rollback hold; a failure creates exactly one corrective item.

The slice below supplies a truthful, authenticated result for one retained
obligation before compatible obligations can be grouped. It does not implement
the full campaign or claim AC-DC-6 passed. Grouping, campaign-wide corrective
fingerprints and release summaries remain in existing BI-E3B918C2. Cost metrics
remain BI-69803ACC. Durable handoff and original-execution settlement retain
their existing owners.

Native DESIGN claim WC-65B54867 / IRD-33B24FA01893 allowed Large preparation on
October 24. Its one edit scope is this plan. The historical WC-DC780E03 is archived
and remains historical. No archived room was reactivated or rebound. The old
worktree location is now another item's source and is outside this continuation.
Funding ownership is unresolved; no allocation is inferred from DEV or admin status.

The original E3 review ending 7F9018F14572 retains request digest
`39ab86f6abcbc35e6d68ba01b094984a200a24a13f98643beeb908e80fd9213c`.
The last authenticated result read on October 24 reported execution proof
incomplete, outcome unknown and replay disallowed. No new packet, reviewer,
request key or budget may stand in for its required original settlement.

## Source findings that constrain implementation

| Existing source | Reuse and required change |
| --- | --- |
| `apps/web/lib/documents/document-store.ts:saveManagedDocument` | Extract its DB-only document/version/reference append port and post-commit projection wrapper. Today it always appends, accepts a caller-supplied hash and projects mutable document authorship; the acceptance wrapper must compute its own hash, preserve immutable version authors and reuse identical content/provenance. |
| `apps/web/lib/backlog/initiative-readiness/body-baseline-version.ts:bodyCriteriaVersion` | Reuse the criterion parser, stable anchors and digest semantics where the original source is a BI body. Preserve the complete captured body digest separately from normalized criteria identity. |
| `apps/web/lib/backlog/initiative-readiness/body-baseline-persistence.ts:ensureItemBodyBaseline` | Do not invoke this Medium-only baseline writer for Small retained work. It creates a scope baseline and has a different authority contract. Preparation must create neither a baseline nor approval. |
| `apps/web/lib/backlog/initiative-readiness/body-baseline-reader.ts` | Reuse authenticated immutable-version paging and digest verification concepts; its current baseline/current-body predicate is not the retained-closure predicate. Extract the common reader rather than weakening the existing lane. |
| `apps/web/lib/mcp/packs/initiative-readiness-pack.ts:handlerFor` | Add the proposed typed acceptance-plan operation beside the current gate-receipt/objective-mapping operations. Existing steward objective-mapping restrictions remain specific to that lane. |
| `apps/web/lib/backlog/acceptance-sweep/retained-acceptance.ts` | Keep the explicit unresolved fallback until the shared authenticated receipt validator proves the exact obligation fulfilled. |
| `apps/web/lib/backlog/acceptance-sweep/steward-objective-mapping-authority.ts` and `issue-objective-mapping-packet.ts` | Extract common steward identity, latest packet, HMAC, role and sourceRef checks; introduce the retained-runtime packet without changing baseline-mapping semantics. |
| `apps/web/lib/work-management/acceptance-verification-shape.ts` and `work-shape-prior-versions.ts` | Add explicit 1.2.0; keep pinned 1.0.0/1.1.0 definitions. Add only the runtime writer and its required grant. A shape ceiling does not grant an actor permission. |
| `apps/web/lib/runtime-coordination/mcp-handlers.ts:recordRuntimeVerificationTool` and `runtime-targets.ts:recordRuntimeVerification` | Propagate actual ToolContext.taskRunId. Reserve the typed acceptance namespace in the shared service. Public result fields and caller verificationId are not acceptance authority. |
| `apps/web/lib/backlog/acceptance-sweep/acceptance-sweep-lease.ts` and `owed-snapshot.ts` | Reuse ownership/fence mechanisms and existing acceptance_owed projection. The independent reviewer owns its own scheduled-task generation, not the completed global sweep's lease. |
| `apps/web/lib/work-capsules/delivery-task-hub-store.ts`, `delivery-task-hub.ts`, and `apps/web/components/build/work-control/DeliveryTaskHub.tsx` | Consume the same validated acceptance projection as the sweep. Preserve delivery Done while presenting the actual independent acceptance state. |

No new campaign table, result ledger, scheduler, status or provider is required.
Existing DocumentVersion, RuntimeVerification, TaskRun and Workroom histories are
the canonical homes. Existing result payloads remain readable as observations.

## First red-green increment: immutable plan preparation

This is internal sequencing within the typed-acceptance slice, not an independently
complete acceptance feature. Claim exact implementation paths and resolve their
change-impact contract only after normal Large implementation admission.

1. Add a small typed service alongside the initiative readiness artifact helpers,
   proposed `retained-acceptance-plan.ts`, with colocated tests. Its inputs are
   item ID, original canonical-deployment closure activity, genuine original
   criteria source references and proposed check-plan content. Do not accept
   authoritative organization, author, digest, receipt status or baseline fields
   from the caller.
2. Resolve the authenticated principal and effective authority from context. Resolve
   item, organization, exact closure and original source provenance on the server.
   Closure must belong to the same item/org and record `to=done` with
   `closureBasis=canonical-deployment`. The prospective check procedure and
   original criterion provenance remain separately named.
3. Serialize on item, then stable obligation document. Use the extracted DB-only
   document port with that transaction. Compute the frozen content and provenance
   digests server-side. Identical normalized semantics/provenance reuses the same
   DocumentVersion and original substantive author. A substantive criterion,
   expected result, threshold or coverage change appends a new version with its
   actual author. Current BI body edits cannot rewrite an issued version.
4. Return an exact immutable artifact reference with DocumentVersion ID, content
   digest and version author identity. A missing source/provenance returns the
   typed `criteria-provenance-missing` remedy naming the owning principal or
   unresolved role and this operation. No PASS or completion side effect occurs.
5. Keep vector, graph and rendition work after commit. Never call the outer
   `saveManagedDocument` transaction inside the acceptance transaction. Preserve
   existing document caller behavior and applicable retention pins.
6. Resolve retention explicitly before final acceptance can depend on this version.
   The existing InitiativeArtifactRetentionPin is tied to a unique activity and
   currently authored only by baseline writers. Do not mint a fake baseline to
   obtain a pin. Reuse the governed retention mechanism with the truthful typed
   preparation activity if its existing policy admits that use; otherwise name
   the exact policy dependency for data review rather than inventing persistence.

First failing behaviors:

- Forged actor/hash/org, cross-item closure and non-canonical closure refuse with
  no document/version/activity side effect.
- Genuine Small retained criteria can be prepared without a new Small plan gate
  and without an initiative_scope_baseline; missing original provenance refuses.
- Two simultaneous equivalent preparations create one stable document/version;
  repeated adoption by another actor preserves substantive authorship.
- A material plan change creates the next immutable version; an issued old
  reference continues to resolve exact old bytes after current BI/body changes.
- Projection failure after commit does not cause a second version on retry.
  Rollback before commit produces neither a version nor an authoritative pointer.
- Ordinary managed document saves, references, rendition requests and document
  history retain their behavior through the extracted port.
- Exact artifact reads enforce content access and digest identity, bound their
  pages, and refuse revoked access or a substituted currentVersionId.

Real PostgreSQL coverage must prove item/document lock ordering, duplicate
preparation and rollback. Unit fakes alone do not prove serializable behavior.

## Complete typed acceptance slice

The preparation service is useful only as the beginning of this sequence:

1. **Issue and admit.** Freeze the prepared version, closure, delivered repo/head/
   verified merge, installation and successful upgrade generation, served SHA,
   tenant/persona/fixture and check-definition identity before dispatch. Reuse
   deterministic task identity and server request authentication. Select an
   actually independent and granted reviewer. Missing grants, ambiguous principal
   or pinned old shape returns its normal owning remedy.
2. **Run under exact ownership.** Bind the reviewer's ScheduledAgentTask token,
   TaskRun and expiry; renew only that worker. Extend the actual scheduled-run
   authority resolver, not public result JSON. Exclude all delivery actors and
   immutable source/criteria/substantive plan author principals. Different chats
   with one accountable principal are not independent.
3. **Commit one authoritative result.** Use a real serializable transaction and
   the design's lock order: quiescence row, reviewer scheduled task, TaskRun, item,
   acceptance steward room, immutable closure/document/source bindings, then
   actual authority rows in stable order. Recheck database wall-clock expiry,
   current packet, grants, persisted normal quiescence and successful upgrade
   generation before commit. Shared steward-row fencing orders issue, withdrawal,
   replacement and completion.
4. **Attach and project atomically.** The sole primary attach point is the exact
   canonical closure activity. Secondary runtime/room references stay inside the
   validated binding. Server-derived verification identity plus semantic equality
   returns the same receipt for equal completion; conflicting evidence/verdict
   refuses. Record RuntimeVerification and its checked acceptance_owed fulfillment
   pointer atomically. Preparation/adoption alone never fulfills acceptance.
5. **Read bounded history and show it.** Exact known receipt lookup plus strict
   (createdAt,id) descending cursors, 100-row pages and an indexed closure/kind
   predicate recover relevant history. Preserve incomplete continuation; no latest-N
   scan claims absence. Shared validation and steward activitySequence recheck
   distinguish historical Verified on N from current applicability. Delayed older
   observations do not mask a relevant newer failure. Unknown versions stay explicit.

No independently shippable sub-deliverable is asserted here. The typed writer,
shared reader and Task Hub projection must agree before the slice can be accepted.
Live D33 behavior and receipt consumption remain necessary after a containing
canonical deployment. Full grouped-campaign acceptance remains separately owed
under the same existing E3 coverage.

## Required integration and operator checks

| Behavior | Required proof |
| --- | --- |
| Actual issuer → drive → TR-SCHED → runtime writer | Native adapter propagates exact run and authenticates stored packet; direct caller forgery and wrong sourceRef refuse. |
| Shape, grants and independence | Old pinned shapes, missing grant, removed authority, ambiguous identity and human/agent author overlap refuse; an eligible final verifier records both plan adequacy and observations. |
| Duplicate and stale completion | Equal concurrent completions yield one receipt/pointer; conflicting verdict refuses; expired/replaced reviewer and committed packet withdrawal prevent late writes. |
| Runtime generation | Preparation-to-commit swap, non-normal quiescence, rollback generation or ambiguous served identity refuses admission; historical valid N survives unrelated N+1 without certifying N+1. |
| History and continuation | At least 10,000 receipts including equal timestamps, unrelated newer rows, relevant later failure, interrupted pages and concurrent projection/result; retain the existing 601-obligation fairness test. |
| User-facing outcome | Delivery Done plus acceptance Pending/Passed/Failed/Unresolved, actual next owner/event, immutable criteria/reviewer/evidence links, keyboard focus, themes and narrow layout. No duplicate dashboard or author-session requirement. |

Claim the eventual exact production/test paths before implementation. Consume
every testImpact/guard obligation, run affected suites and official types, then
real PostgreSQL/native adapter checks and the governed exact-source gate.
Independent exact-source assessment, DCO/protected checks/queue and containing
deployment do not replace live outcome acceptance.

## Backlog coverage and stop conditions

Existing parent/slice: BI-E3B918C2. Proposed atomic rationale: preparation,
authenticated dispatch, fenced result and shared consumption are one acceptance
contract; shipping a partially trusted PASS would not meet the objective.
Requirement refs: OBJ-DC-3, OBJ-DC-4. Contract refs: CT-DC-ACCEPTANCE, CT-DC-WAIT.
Flow refs: FLOW-DC-2, FLOW-DC-3. Verification refs: AC-DC-6 (prerequisite slice).

Native coverage receipt: **not recorded**. No new BI, campaign, case, reviewer task
or approval was created by this preparation. After the original relevant
uncertainty is settled through its existing owner, use the server's exact current
recovery packets to obtain the canonical design/spec/architecture approvals,
immutable plan coverage/review and Large implementation admission. No fresh review
is implied by this plan.

The DESIGN claim's change-impact contract is resolved: no testImpact or guard
obligations; the doc-index derived-artifact check applies. This checkout currently
classifies source-only because dependencies and generated Prisma artifacts are
absent. No production tests or typecheck are claimed.

Keep the requested refactoring work in the shared document port, identity/
authority checks, scheduled ownership and receipt reader; do not clone existing
baseline logic. Funding allocation remains unresolved and requires its recorded
owner before a new budget decision.

Rollback disables the new actuator/consumer while preserving documents, versions,
original Done closures, immutable receipts, unresolved obligations and all old
TaskRun identities. Do not rewrite historical passes or invent backfill.

## October 26 continuation: actual ownership and acceptance boundary

This is a DESIGN-only continuation of BI-E3B918C2. It records new operational
evidence and corrects the proposed proportionality boundary. It does not deliver
the acceptance writer, approve a design, settle an original execution or satisfy
plan coverage.

### Native ownership and original review

The existing WC-65B54867 was transferred through genuine request
`handoff-5060335a-9b72-45b1-bb51-71cfb93c6dc0` and the actual receiving chat's
acknowledgment `e3-actual-evaluation-receiver-ack-design-5060335a-20261026`.
The request digest is
`c9d770613e9a3c193fc2b7cd75be85735b46af33b37d8aec73df187936c6dde6`.
Native completion preserved the human owner, admitted assistant, Large shape,
branch, base and head; it changed only the recorded executor to the receiving
chat. The initial `branch_occupied` refusal is retained. No forced claim or
new branch was used.

The receiving chat consumed the complete native command/manifest through
bounded selected-value reads. An oversized full payload and snapshot were
explicitly undelivered; they were not treated as complete receipts. The writer
revalidated the immutable request and current authority during acknowledgment.

A fresh requester-authorized original `tasks/result` read on October 26 returned
HTTP 200 for the exact original 7F task and digest. It still reports
`input_required`, `terminal: false`, `resumable: false`,
`classification: unknown`, `replayAllowed: false`, and
`original-execution-proof-incomplete`. Required proof remains:

- authoritative original dispatch;
- authoritative descendant closure;
- complete reconciliation of unresolved and late effects.

The task-linked inventory is incomplete. Its zero observed artifact, tool,
approval and async-operation rows do not prove absence. The checkpoint remains
October 16 at 10:37:38.596 UTC, attempt 1. An outer process close does not
establish descendant closure. A later writer fence does not retroactively prove
the original attempt's effect closure.

After the real handoff, the current native DESIGN decision is allowed.
PLAN and IMPLEMENTATION remain input-required. The refreshed design-spec route
names the same immutable spec blob `dc87d98cdf74f9a4d7f96a862e3e631a58f8268f`
as the original 7F review, with no original recovery locator. It was not
submitted: a new Workroom locator or plan commit cannot authorize repeating the
unchanged held design. The completion read's unpersisted allowed projection is
not implementation admission or independent acceptance.

### Proportional acceptance contract

The current sweep unconditionally calls `retainedAcceptanceWithoutBinding`
for Done items. That fallback currently supplies the acceptance-reviewer role
for all shapes. Preserve its truthful missing-binding state, while keeping the
required actor proportional to the recorded shape and sensitivity.

The existing DB4 owner is separately addressing BI-80D1FBBF / WC-80FA2F4F, the low-sensitivity Small-lane
defect. E3 must consume that owner's governed result rather than implement a
second Small fix. Small runtime-check acceptance must not acquire an independent
reviewer, spec baseline or plan gate solely because delivery already closed.
Medium/Large work retains the independence it actually owes. High/elevated
sensitivity continues to raise the applicable requirements.

For every lane, actor, closure, original criteria, delivered revision and current
runtime applicability must come from authenticated server context and immutable
records. Caller-authored RuntimeVerification result JSON, a different chat with
the same principal, deployment alone and a client assessment are not substitutes
for a required independent receipt. Existing observations stay readable without
being reclassified as authenticated acceptance.

Known consumers remain separate:

- BI-A83A4188: delivered Medium approval-result repair, scoped live UI/MCP proof
  retained; independent deployed-revision acceptance remains missing.
- BI-5366EF78: delivered handoff repair, actual receiver ACK and duplicate fence
  proof retained; browser waiting/completion evidence is now recorded, while
  formal acceptance and missing hostile/concurrency cases remain distinct.
- BI-DB4E6F81: existing low-sensitivity Small repair and its runtime-check lane;
  it must not inherit Medium independence from the retained fallback.

### Refactoring allocation and verification

The operator's current direction for this continuation is 80% relevant
refactoring/integration/reliability work and 20% thin new behavior. It supersedes
the earlier 20% direction within this task. It is a planning target, not a
retroactive assertion about elapsed labor or token use. Funding ownership is
still unresolved; this does not change organization-wide allocation.

Use four consolidation packages: immutable criteria/version reads, authenticated
issuer and scheduled-run identity, transaction-bound result validation, and the
shared sweep/Task Hub projection. Keep only the final typed adapter and
presentation wiring as the thin behavior package. Do not refactor unrelated
code to satisfy a percentage. Record future source work and checks against these
packages; past uninstrumented effort remains unmeasured.

After authentic original settlement or a genuinely supported disposition is
available, obtain current native design/spec/architecture approval and exact
coverage/plan review before implementation. Reuse existing valid source/PG and
live evidence only when its identities and scope match. Repeat the original
failure-inspection, layout, normal refresh and authorized offline/recovery
scenarios after the containing canonical deployment; compare observable task
outcomes and report timing bounds without claiming a latency improvement.

The existing original-proof producer/effect owners retain the missing
settlement prerequisite under BI-7906C73E and its current coordinator. This
continuation creates no proof, disposition, approval, review attempt or receipt.
The next permitted implementation event is actual native readiness allowing it,
not another operator confirmation or another read of unchanged history.
