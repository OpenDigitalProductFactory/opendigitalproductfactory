---
status: draft
---

# Owned review checkpoint evidence

Backlog: BI-CAP-21C511CA. Workroom: WC-0750EFD3.
Design admission: IRD-ECDA590AA3BB (large/high). This draft is not canonical
design approval, implementation admission, execution settlement or retry authority.

## Problem and source basis

At inspected source 95d9746940171a45af9f6bed76208e2e4ab07742,
`apps/web/lib/change-review/semantic-review-recovery-readback.ts` reads admitted,
owner-scoped node output snapshots but omits request contracts. Its closed
provider-outcome projection does not expose whether a complete checkpoint set
passes the existing canonical validators. A projected unknown is insufficient
to conclude either that positive proof exists or that it cannot exist.

The existing branch remains at 2506e9dceb5b44643c261bc52d106390f8e58c01 before
this documentation change. Implementation must reconcile to current source and
revalidate these contracts; this draft does not merge newer runtime code.

Existing contracts are `restoreSemanticReviewCheckpoint` in
`semantic-change-review.ts`, `hasFinalReviewCheckpointSet` and
`hasProvenCapacityCheckpointSet` in `semantic-review-capacity-recovery.ts`, and
`readSemanticReviewRemediation` in `semantic-review-remediation.ts`, all under
`apps/web/lib/change-review/`. Reuse these predicates rather than reproduce
their rules in the reader or client.

BI-CAP-29F5787B delivered the bounded projection and remains done. This proposed
increment supplies normalized proof observations; it does not retract that work.
The existing broader owned-task design and original review 70069 remain separate.
Original runner review TR-GATE-8E869B6EDE7394BB1470F4CE is not settled by this design.

## Proposed contract and alternatives

Extend the existing get_workroom owned-review recovery detail. Retain original
owner admission, immutable request verification and current authority checks.
Read requestContract server-side only, scoped to the admitted task and owner.
Obtain expected specialists, digest and recovery attempt from the verified
original request/state, never caller-supplied reconstruction.

Return fixed normalized facts: complete-set coverage, canonical final-verdict
proof, canonical capacity-deferral proof, and an explicit unavailable/unknown
reason. Keep checkpoint proof distinct from recorded runtime-health remediation,
execution settlement outside these proof contracts, budget and retry admission.
`retryAuthorized` remains false. Do not expose raw result, request contract,
prompt, credentials, provider output, arbitrary diagnostic text or another task.

A broad task-result reader would unnecessarily expand this disclosure surface.
Client-side raw checkpoint verification would require private transport and
duplicate server obligations. The existing bounded reader plus canonical
predicates is the proposed smaller change; no new tool, grant, schema or store.

## Objectives and acceptance mapping

**OBJ-PROOF:** Let an admitted owner distinguish positive canonical checkpoint
proof from incomplete observation without granting effects.

| Acceptance | Objective | Required evidence |
| --- | --- | --- |
| AC-P1 | OBJ-PROOF | A six-node final-verdict fixture passes the actual final-set predicate and the bounded projection reports that result. |
| AC-P2 | OBJ-PROOF | A complete six-node mixture of preserved PASS and typed predispatch capacity deferrals passes the actual capacity predicate; every branch is covered. |
| AC-P3 | OBJ-PROOF | Missing, failed, running, unknown, duplicate, foreign, wrong-digest, wrong-agent, wrong-generation and wrong-attempt cases never produce positive complete-set proof. |
| AC-P4 | OBJ-PROOF | Truncation, unavailable immutable request and denied/unavailable current authority suppress positive proof; a foreign caller causes zero protected detail reads. |
| AC-P5 | OBJ-PROOF | Serialized output contains only the closed allowlist; health, budget, retry and historical outcome fields do not become affirmative solely from projection. |
| AC-P6 | OBJ-PROOF | An authorized served read agrees with canonical verification of its exact admitted source records, or is explicitly unavailable; no fixture is presented as historical settlement. |

Six nodes is a verification fixture size, not a hard-coded production roster.
Expected coverage comes from the immutable request. Empty unresolvedNodeIds,
completed status, a parsed verdict alone, or a partial PASS subset cannot replace
complete-set validation. Superseded generations follow the canonical predicate.

## Ordered plan and backlog coverage proposal

One atomic deliverable maps AC-P1 through AC-P6 to existing BI-CAP-21C511CA.
These phases are internal sequencing, not separate shippable work or new cases.
Coverage is proposed, not a recorded plan-coverage receipt.

1. Reconcile current immutable source and scope with the existing owned-task
   design. Record this exact design baseline and obtain required independent
   specification/architecture approval and objective mapping. Resolve owning
   budget and current review allowance before any paid review. Stop on refusal.
2. Obtain normal implementation admission and claim only recovery-readback,
   its tests and necessary shared type/consumer paths identified by gate context.
   Reuse helpers; changing their proof semantics is outside this proposal and
   requires a new design assessment under this same carrier.
3. Write failing readback tests for AC-P1 through AC-P5 using actual canonical
   predicates and realistic unmodified fixture contracts. Test all six branch
   identities, not just aggregate booleans. Assert negative controls and zero
   disclosure before implementing the normalized projection.
4. Implement the projection, run affected readback/capacity/remediation tests
   and package typechecks, then normal exact-source review and publication
   gates. Retain root banners, source identities and test counts. Infrastructure
   failure is unrun/inconclusive, never pass.
5. After protected merge and canonical deployment by its existing owner,
   perform AC-P6 through the authorized reader. Preserve any genuine unknown.
   Record acceptance against the approved baseline; never replay original 8E
   or 70069 merely to validate the reader.

## Risks, rollback and stop conditions

Incorrect roster/generation selection could falsely certify a partial set;
canonical predicates and complete negative controls are mandatory. Authority
or source changes during observation must invalidate positive proof; use the
existing admission/final-fence contract and recheck it before implementation.
Byte/node limits must fail closed. A valid checkpoint does not by itself prove
arbitrary external children stopped or authorize a recovery budget.

Rollback removes only the additional normalized projection, retaining original
checkpoints, receipts, health records and review histories. No DB mutation or
reclassification of historical effects is part of implementation or rollback.
Stop at denied scope, unavailable baseline, unresolved funding/allowance,
missing positive proof or implementation admission. No raw private proxy,
broad thread_read grant, new case, substitute review or protected-gate bypass.

## Validation status

Design and ordered plan only. No implementation or tests run for this proposal.
Canonical design review, objective mapping and plan coverage remain pending.
