---
status: draft
backlog: BI-5C81001E
workroom: WC-DA6C2123
---

# Source-free Workroom binding and original approval evidence

## Ownership and admission

This is the bounded corrective design for BI-5C81001E, under EP-WORK-CONVERGENCE.
The admitted design executor is Codex chat
01a1421f-60dd-76c3-b146-a8dd1b11ebdb, AGT-EXT-CODEX. Native design admission
IRD-9702CC1C4D5A selected delivery-medium@1.0.0 in WC-DA6C2123, on protected
base 256b8317580727136d1cfcb88e9632423adfe691. Design admission is not
implementation, independent approval, qualification or permission to repeat a
historical action. Funding ownership remains unresolved in the native claim.

The original QA room WC-840613D1 and approval
cmw0314h91dh301n2wne9nnho remain intact. The original source room WC-966F4217
stays archived. The frozen specialist framework branch is not this repair's
implementation carrier.

## Measured problem and limits

Fresh native reads after deployed main957 show the QA room blocked with
executorKind codex-desktop, executorRef null, no source head/branch/worktree,
and activity sequence9. Its objective explicitly calls for browser acceptance
of already deployed BI-A009189A without source edits. Its original approval is
failed, labeled Authorized, but did not complete; failure evidence is
missing/result-unproven and action evidence is unsupported. The full room
projects failedHandoffRecovery:null and source-identity-missing/adopt_worktree.
Renewal and evidence activities do not prove executor binding or completed QA.

These observations prove a current unresolved workflow, not its original
execution's cause or absence of effects. No QA fixture, model call, approved
operation retry or synthetic failure was created to investigate it.

Current source contains real recovery, with deliberately narrow eligibility:
`apps/web/lib/coworker/approval-action-evidence.ts` binds one actual original
execution to its envelope, tool, actor and input; failed handoff explanation
requires a consistent handoff-transaction-required refusal.
`apps/web/lib/work-capsules/workroom-failed-handoff-recovery.server.ts` further
requires an original request-phase command, current source identity and
lineage before offering request/receiver acknowledgement. Missing evidence is
not that known refusal. This design does not weaken those conditions.

## Existing design coverage and overlap disposition

Extend the coordinated-workrooms contract in
[coordinated Workrooms](2026-09-03-coordinated-workrooms-design.md), the existing
[bounded handoffs](2026-10-15-bounded-workroom-handoffs-design.md), and
[recorded approval recovery](2026-10-25-approval-result-recovery-design.md).
This document is the occurrence-specific corrective extension, not another
coordination engine.

- BI-97445674 AC5 retains general coordinator admission and approved-operation
  recovery policy. It is adjacent triage work. This item owns the narrower
  source-free initial executor binding and truthful recovery projection. It
  cannot alter coordinator-versus-approver separation. Reconcile any newly
  found overlap with that owner before implementation.
- Delivered BI-5366EF78 / BI-F1FC0B62 retain ordinary same-mandate transfer;
  delivered BI-FF2FA0F7 addressed source-worktree adoption, not permission to
  invent source for acceptance. Neither closed item is reopened.
- Delivered BI-A83A4188 owns known-refusal presentation; unknown historical
  effects cannot be made known by copying that classification.
- Delivered BI-4A06271B owns continuation briefs, not binding mutations.
- BI-E27F3600 owns specialist instantiation; its plan explicitly leaves
  executor-handoff implementation to existing owners. Its current missing
  design/baseline and coverage gates are not bypassed by this repair.
- BI-A009189A and routing chat01a132d8-977a-76e0-8d9c-eff5d1e00af8 retain live
  feedback acceptance. A source repair does not supply its acceptance result.

The live search used lexical titles/previews because embeddings were unavailable.
Broad backlog lists were context-truncated; the runtime excludes the spec/plan
corpus. Exact named-item reads and source design/history reads support the
scope above; there is no claim of exhaustive absence across the whole backlog.

## Objectives and acceptance

**OBJ-BIND:** An already admitted source-free task has its real authenticated
executor binding or an explicit current binding prerequisite.

**OBJ-EVIDENCE:** The original approved binding's execution evidence is resolved
truthfully and privately, with unknown outcomes preserved.

**OBJ-RECOVERY:** The operator and executor see a supported next step that fits
the real task, rather than fabricated source identity or repeated approval.

| Acceptance ID | Objective IDs | Statement |
| --- | --- | --- |
| AC-BIND-1 | OBJ-BIND | A source-free room created through an admitted ordinary assignment binds its actual canonical executor session, or returns an accountable pre-effect hold; another room or foreign non-null executor cannot be overwritten. |
| AC-BIND-2 | OBJ-EVIDENCE | Exact original approval evidence validates envelope, tool, actor, input, attempt membership and result; missing, ambiguous, contradictory and private evidence stays bounded and never proves no effects. |
| AC-BIND-3 | OBJ-EVIDENCE, OBJ-RECOVERY | Only authentic proven recoverable original failure can produce an existing current-authority request/real-receiver-ACK action; unproven operation history remains held without replay or a replacement approval. |
| AC-BIND-4 | OBJ-RECOVERY | Full and bounded Workroom reads, caller approval status and operator UI agree; a genuinely source-free task never receives adopt_worktree or invented source hashes as its binding remedy. |
| AC-BIND-5 | OBJ-BIND, OBJ-EVIDENCE | Foreign owner/session, revoked delegation, changed mandate/lease, concurrent binding, duplicate acknowledgement and unknown effects preserve their existing refusals. |
| AC-BIND-6 | OBJ-RECOVERY | Named-ref reproductions, meaningful source tests, normal protected delivery and served verification distinguish delivered repair from original feedback acceptance, which remains independently owned. |

## Proposed contract boundaries

1. **Task requirements, not missing fields, decide source need.** Resolve source
   requirements from the existing registered work-shape/stage and assignment
   contracts. Null source fields alone do not make a room source-free, and prose
   or a caller flag grants nothing. First inspect whether the QA room was given
   the wrong stage/shape rather than inventing another Workroom kind or schema.
   If existing typed requirements cannot express the task, return that precise
   design gap for governed sizing; do not silently exempt all blocked rooms.
2. **Initial binding differs from transfer.** Locate the existing room-birth and
   authenticated session-binding writers. A null executor may be filled only
   from an actually admitted assignment with matching current owner, agent,
   session and mandate. Use their existing serialized compare-and-set and
   command receipt boundary. The existing canonical actor seam is
   work-capsules/handler-actor.ts:workCapsuleActor, with current OAuth token
   binding and workroom-agent-access.server.ts:resolveAgentWorkroomAccess.
   Those authenticate a human/assistant, not an external chat. Before design
   finalization, named-ref research must identify the server-owned assignment
   or authenticated origin that binds the CURRENT executor session. A matching
   principal, caller-supplied executorRef or endorsed destination is insufficient.
   The existing handoff explicitly says no external chat is authenticated; keep
   that distinction. Historical direct calls may have an unrecorded thread;
   preserve the absence rather than filling it. Without the required current
   session provenance, return a pre-effect hold and its actual owner.
   Recheck the current assignment, authority, lease
   incarnation and task execution fence inside the final write transaction;
   a late or revoked writer cannot commit from an earlier admission snapshot.
   A non-null or changed executor follows the
   existing source-request/receiving-ACK contract instead of an initial bind.
3. **Historical evidence is read, never re-executed.** Consolidate bounded
   original evidence selection in its existing module. Preserve raw arguments
   and results server-side. If authentic stored evidence cannot establish the
   original result, expose a precise unavailable reason and accountable owner;
   do not manufacture a proof, infer settlement from inactivity, or broaden the
   known-refusal allowlist to make this occurrence eligible.
   Keep reads bounded by the existing exact-envelope selector and its LIMIT+1
   overflow detection in pproval-action-evidence.ts, and the two-candidate
   ambiguity check and PACKET_MAX_BYTES in the failed-handoff recovery reader.
   Reuse their constants; do not raise or copy them into another policy. Overflow
   or unknown attempt coverage remains unavailable. No inventory-wide scan is
   a recovery proof; any later indexed expansion belongs to EP-WORK-CONVERGENCE.
4. **Projection follows actual eligibility.** Reuse existing recovery projections
   and governed actions. Explain task kind, binding status, next owner and
   missing proof on the surface. Keep opaque identifiers under diagnostics;
   disclose detailed lineage progressively. Navigation and status reads have
   no execution effects. Do not add a second status ledger or retry scheduler.

## Ordered correction and verification

1. Re-read live BI-97445674 ownership and the original QA room/approval. Bind the
   reproduction to current protected source and served identity. Establish the
   task's registered source requirements, actual birth request/session context,
   and original approved execution evidence before asserting a cause.
2. Add first-failing tests at real producer/consumer seams: source-free creation
   and fixture eligibility, recovery projection, and exact original evidence
   selection. Include missing/ambiguous result, foreign or stale identity,
   duplicate and concurrent initial binds, same-assistant foreign-session and
   missing-session-provenance negatives, source-bearing task controls, and
   revoked authority. Do not run the real failed approval to obtain a test.
3. Record fix research through the existing initiative writer, with named source
   and actual executed reproduction/candidate-cause controls. Bind this ordered
   sequence to BI-5C81001E through normal coverage. Request implementation only
   when native readiness admits it; design admission does not suffice.
4. Refactor the existing birth/binding and requirement/recovery projection seams
   under current path ownership. Keep the shared exact-evidence selector once.
   At least20% of planned work is consolidation of existing predicates/read
   models and meaningful regression coverage, not another workflow surface.
5. Run affected source checks and required typechecks; record exact canonical
   qualification and independent review, then normal DCO/protected publication.
   Retain failed and skipped checks under their original source identities.
6. After a containing runtime is verified, read the same original QA room and
   approval. A genuinely supported original recovery action requires fresh
   eligibility and a real receiving acknowledgement. If historical proof is
   still unavailable, record the hold and separately prove new source-free
   binding with an authorized isolated fixture. Do not close BI-A009189A or
   declare actual Critic work from a fixture or from source delivery.

## Compatibility, rollback and explicit non-goals

No new table, permission, credential, background runner, approval endpoint or
universal retry path is proposed. No historical approval, original task, raw
result or participant identity is rewritten. Source-bearing rooms retain their
current immutable-source review gates. Existing handoff predicates, independent
review, sensitivity and consequential-effect controls remain mandatory.
Rollback is a normal protected revert of the repair, retaining historical
command/evidence records. It does not delete fixtures or recover data by replay.
This design authorizes no production/peer mutation and no provider change.

## Research status and owner route

Current native reads and exact source inspection are author diagnosis inputs,
not the required failing-then-passing reproduction or an independent approval.
No new product/dependency is proposed; the existing canonical design alternatives
and shared substrates above are reused. Finalization remains contingent on the
named-ref reproduction, current requirement-model inspection and scoped owner
review. The native admitted design owner is this chat in WC-DA6C2123; there is
no admitted implementation owner yet. Native implementation readiness currently
requires RESEARCH_REQUIRED and PLAN_REQUIRED. No classification, funding or
policy decision is inferred from the environment label.
