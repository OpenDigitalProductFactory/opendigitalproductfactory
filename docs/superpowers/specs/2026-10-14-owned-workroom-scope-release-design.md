---
status: active
---

# Owned Workroom scope release

Implementation parent: BI-8D8939E5. Workroom: WC-C2B2C6C8.
WWMD: DI-2D3AB9580E90, bound_call_refinement, proceed.

## Problem and recorded policy

On source 69dda844d19a0b1d66a28928cf2e71a2fa9be34f,
`release_workroom_scope` declares `authority` for every call. The regression
`scope-release-consequence.test.ts` executes the actual tool definition with
the caller's live lease and exact owned claim. It fails because the resolver
returns `authority` rather than an ordinary effect. This is a classification
defect, independently of the repaired command-receipt transport in PR #6330.

The kernel's `principles/escalation-is-a-gate-not-a-trust-tier` requires a person
for declared damaging effects, consequential Cases, restricted data, or an
ordinary mutation without recorded steering. An autonomy-eligible WWMD decision
is platform direction; it does not grant permission or erase a damaging effect.
WWWD and WSID continue to resolve organization and practitioner decisions in
their own scope. No organization or profession policy is changed here.

BI-8D8939E5's original merge/retire examples therefore do not justify a general
DI-based approval bypass. Those consequential operations retain their existing
gates. The original nonprod-lease example already has the bounded existing
`leaseCleanupConsequenceForCall` engine, requiring exact authenticated-user task
provenance and the recorded lease binding; its live acceptance remains a separate
obligation. This design extends the same narrow-only tool-consequence contract
to own Workroom scope removal. It does not claim every coordination envelope was
wrong. BI-12E5DD91 owns complete card disclosure, BI-763D6E01 owns command-receipt
transport, and BI-AFEAAA76 owns approval completion/replay acceptance. Their
immutable histories and acceptance obligations remain intact.

## Objectives and acceptance

**OBJ-OSR-1:** Automatically classify exact owned scope removal as ordinary while preserving the current authorization and delegation engines.

**OBJ-OSR-2:** Prevent changes to scope or lease ownership between classification and mutation from authorizing a foreign release.

**OBJ-OSR-3:** Preserve genuine human and graduated-operator authority paths, command idempotency and recorded failures.

| Acceptance | Objectives | Statement |
| --- | --- | --- |
| AC-OSR-1 | OBJ-OSR-1 | A valid exact own claim on a nonterminal, unarchived room with the caller's current live lease refines authority to null; current connection delegation can steer it without a new envelope. |
| AC-OSR-2 | OBJ-OSR-1 | Missing identity, malformed requests, unknown rooms, unknown claim ownership, expired or foreign leases, and foreign requested claims retain authority. |
| AC-OSR-3 | OBJ-OSR-1 | Refinement does not bypass token, coworker grant, human capability, assistant, task, room admission, consent revocation, restricted-data, consequential-Case, explicit-proposal or always-human controls. |
| AC-OSR-4 | OBJ-OSR-2 | The mutation uses the same eligibility predicate and the existing scope/updatedAt compare-and-set; a changed owner or lease prevents an ordinary authorized call from removing foreign scope. |
| AC-OSR-5 | OBJ-OSR-3 | A genuinely approved or existing graduated-operator authority call retains its established path; forced claims, executor handoffs and grant/process changes are not refined by this change. |
| AC-OSR-6 | OBJ-OSR-3 | Exact duplicate release remains a harmless no-op on an owned live room; existing command receipts preserve exactly-once replay, cross-user/room isolation and terminal FAILED history. |
| AC-OSR-7 | OBJ-OSR-1, OBJ-OSR-2, OBJ-OSR-3 | Protected merge and qualified release precede live OAuth/portal acceptance; record actual outcome and persisted receipt, never infer acceptance from a source test or deployment alone. |

## Existing substrate and design

Reuse `resolveCallConsequence`'s narrow-only resolver. The declared authority
floor remains; exceptions or unproven inputs keep it. A pure shared predicate
reads server-resolved caller principal, exact requested kind/value pairs,
persisted claim attribution, room state and current lease. It accepts only
known claim kinds, a nonempty valid request, a proven caller and a live lease
held by that caller. Every matching persisted claim must belong to that caller;
unmatched pairs remove nothing. Raw malformed ownership entries matching a
requested pair fail closed. Extensions and shape records are retained.

The refiner resolves identity through existing `workCapsuleActor`, including
OAuth's human ownership and assistant attribution. It reads the exact capsule,
not an inferred active room. It adds no policy, delegation, approval or identity
store. The existing escalation engine still evaluates steering and limits.

At execution, consume the monitor's server-created `authorityDecisionId`, never
an argument supplied by the client. Read its existing AuthorizationDecisionLog
and validate allowed disposition, tool, human and assistant binding. An ordinary
refinement reason causes a fresh evaluation of the same predicate at mutation
time. Missing/mismatched evidence on a governed assistant call fails closed.
Current approval/graduated paths are not narrowed accidentally: only the
ordinary-refined disposition applies this ownership restriction. Existing
human-owner portal checks remain responsible for direct human release.

The current decision subject for this tool is `platform:dpf`; do not falsely
claim the log already persists a capsule-specific subject. Exact target binding
comes from the current governed dispatch context, the refiner's exact lookup,
the write-time exact lookup and existing snapshot CAS. Caller data cannot supply
the internal decision id. Tests must demonstrate that boundary.

Extract the existing scope-release transaction into a focused store leaf rather
than grow the baselined monolithic store. Preserve activity, shape/extension
retention, transaction behavior and existing public exports. Share parsing and
eligibility between classification and mutation. This consolidation is part of
the repair, not a second approval system.

## Ordered delivery and verification

One atomic implementation deliverable OSR maps to BI-8D8939E5. Classification
without mutation revalidation is unsafe; mutation revalidation without routing
leaves the approval gap. The extraction, refiner, binding check and adversarial
tests therefore ship together. Historical merge/retire/nonprod observations are
dispositioned above; closure must not imply their live acceptance is proven.

1. Record reproduction/research and obtain independent review of this immutable
   design; bind live coverage before behavior implementation.
2. Implement shared parsing/eligibility, server-side narrow-only resolver and
   focused scope-release store. Wire the existing tool/handler after coordinating
   the active claim on `mcp-handlers.ts`; co-edit only after the existing governed
   claim has executed. Envelope cmv7mxfd807ie01obbyj63tgu executed on
   2026-10-14; Workroom activity sequence 40 records the exact handler co-claim.
3. Test own/foreign/unknown claims, mixed requests, null actor, malformed inputs,
   terminal/archive/expired/foreign leases, exact target, no-op, read failure,
   unknown raw claims, stale snapshots and lease changes, including expiry while
   an unkeyed call waits for transaction admission. Read and classify inside the
   existing transaction callback immediately before the snapshot CAS. Test decision binding
   across human/assistant/tool and ordinary versus approved/graduated execution.
4. Run graph-linked work-capsules pack/alias, tool-registry, scope-input parity,
   store/adoption/session/branch/reaper/terminal tests plus command-receipt,
   receipted-tool and existing escalation/governed-executor controls. The two new
   leaf paths have no graph links yet, so add colocated tests explicitly.
5. Check style-drift, doc-index freshness, capability-completeness freshness and
   module-size/prose ratchets; obtain package and test-program typechecks, exact
   merged-code shared-runtime gate, independent semantic review and protected
   PR health. Publish through normal DCO/queue, never an install hotpatch.
6. Coordinate qualified release with the existing producer. Verify current
   OAuth consent allow/deny/revoke, portal parity, exact owner/room isolation,
   stale UI, approval/denial/expiry and persisted exactly-once outcomes using
   the existing acceptance obligations. Never reset FAILED or use a new key to
   pretend a failed action succeeded. Browser policy denial remains a stopped
   verification channel with a separately recorded defect.

## Risks and rollback

The critical risk is classification/write drift under concurrent scope or lease
changes. Shared eligibility plus snapshot CAS must refuse before the effect.
Another risk is suppressing a legitimate human-approved authority operation;
tests must preserve that route. Unknown log or malformed scope data remains gated
or refused rather than guessed. Revert the refiner and its wiring through a
normal protected PR if acceptance fails; existing authority escalation remains
the conservative floor. No database reset, new grant, migration, self-approval,
credential repair or manual release tag is part of rollback.

## Backlog coverage

Independent review: initiative-06d5545b-ca1a-4f74-bafc-dedb695a5797,
passing review of commit 295df8913622a1369a050bda230628cc387c5385,
blob ca6fa23a044c48a703ed68158bbe9fc2ff63a059. Baseline:
baseline-e4e40c3d-c67e-4f50-8310-f5a8d1cf1957. Research:
initiative-ab219014-7a05-400c-9f51-c300a95f416e.

Atomic coverage receipt: cmv7jv3a24iof01qsegrgg83f; parent BI-8D8939E5,
deliverable OSR, no dependent or independently shippable children. Requirement
references OBJ-OSR-1 through OBJ-OSR-3; contracts resolveCallConsequence,
AuthorizationDecisionLog and workCapsuleActor; flow references current governed
dispatch context, write-time exact lookup and existing snapshot CAS;
verification AC-OSR-1 through AC-OSR-7. Native coverage readback was current and
implementation admission IRD-598C5907A1BC was allowed. Refresh immutable plan
provenance to the published implementation head before publication; these
historical review and coverage receipts remain immutable.

No protected delivery or live acceptance is claimed by this document.
