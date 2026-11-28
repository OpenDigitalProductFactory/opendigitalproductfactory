---
status: draft
backlog: BI-5345BFC7
---

# Make amended design approval recoverable by the Workroom

**Backlog item:** BI-5345BFC7 · **Epic:** EP-DELIVERY-ENGINE-V2
**Parent contracts:** [Initiative readiness and baseline ownership](2026-08-08-initiative-readiness-and-goal-completion-reconciliation-design.md), [original initiative review settlement](2026-10-16-original-initiative-review-settlement-design.md), and [T3 absorption](2026-11-13-t3-code-absorption-design.md#current-convergence-ruling).

## Observed gap

In BI-348CC53B, the canonical writer rejected the original bound S5 approval because the packet lacked dispositions for AC-1 through AC-4. Its readback recorded an unknown execution, not an approval or a retry permit. The exact room was temporarily unavailable to recovery after the lease lapsed. Later same-owner renewal restored a route without recording an approval. Preserve both observations. The shipped readback and assessment-format changes did not prevent the incomplete packet or reconcile the unknown attempt.

At source `89cd7b12d4fb7fa89d4a74ac7a7c188859b0ca31`, `baseline-manifest.ts` already computes the semantic diff and `baseline-repository.ts` validates the disposition set under the canonical baseline lock. `terminal-recovery.ts` binds the expected baseline when issuing an independent review packet. That packet does not carry the changed-statement requirements before dispatch. The original result reader and recovery issuer already preserve evidence and refuse uncertain originals. The repair moves input validation earlier and connects these existing controls. It does not change the meaning of unknown.

## Objectives

**OBJ-INPUT:** Stop incomplete amended-design packets before they start reviewer work.

**OBJ-CUSTODY:** Preserve the exact correction and its current authorized next action independently of client or original lease.

**OBJ-SETTLE:** Record at most one independent approval and preserve uncertain execution when safe recovery cannot be proven.

## Acceptance

| Acceptance | Objectives | Statement |
| --- | --- | --- |
| AC-1 | OBJ-INPUT | An amended spec-approval packet names every changed/removed objective or acceptance ID relative to its current exact approved baseline before paid/native reviewer execution. Missing inputs produce a typed next action without dispatch. An unchanged or initial manifest does not incur a new duplicate review. Independent reviewer owns the actual dispositions and verdict. |
| AC-2 | OBJ-CUSTODY | A refused approval write keeps the exact baseline, artifact, rejection and authorized next action in existing durable Workroom/task state. Changing client or expiring the original lease preserves those facts and offers supported current-source re-admission where eligible. It never broadens read/write authority. |
| AC-3 | OBJ-SETTLE, OBJ-CUSTODY | A proven safely stopped eligible original without a receipt can record a corrected packet once through the canonical writer. A genuine existing receipt is reused. Unknown original execution missing dispatch/child-closure/late-effect proof remains held with a named owner and specific missing facts. Changed baseline, wrong actor, stale source, concurrent or delayed writer, and unproved effects cannot create a receipt or replay an old task. |
| AC-4 | OBJ-INPUT, OBJ-CUSTODY, OBJ-SETTLE | Verify a controlled regression based on the exact S5 four-clause case across lease expiry and client switch. Prove one receipt after safe correction, zero on unknown/unauthorized/stale paths, and no extra review dispatch. The regression is not approval or replay of the live S5 attempt. |

## Design and implementation order

1. **CONTRACT-APPROVAL-INPUT.** The existing issuer resolves the authoritative baseline and reads the exact new artifact through the repository provider. Both issuance and admission use the same manifest diff. An amended packet includes the baseline ID, artifact identity and exact ordered changed-ID set. If a required draft explanation is missing, return the IDs and the allowed author action without creating an execution. Drafts remain proposed input. The independent reviewer reads the artifact and confirms or replaces the explanations and determines the verdict. Do not require an independent verdict before dispatch. Equal or initial manifests require no explanations. At commit, re-read and compare under the existing baseline lock. Neither the client nor a mutable description chooses the baseline. Add a packet issuance and admission regression in the initiative readiness and independent review request suites before changing the issuer.
2. **FLOW-WORKROOM-CORRECTION.** Extend the existing TaskRun writer-wait checkpoint and Workroom stage recovery projection. Keep the original request digest, artifact, baseline, typed missing IDs and writer rejection, and derive the one next action from current authority. Current read access is not a lease. Effects use normal current Workroom/source admission and the existing independent reviewer authority. If custody has expired, offer the supported reacquisition or name the authority that must reconcile it. Do not prolong an expired lease implicitly, copy a reviewer identity, or allocate a second task. A changed input or newly reconciled source prompts fresh eligibility evaluation of the same durable obligation. Do not poll a provider to discover a draft.
3. **CONTRACT-APPROVAL-SETTLEMENT.** Reuse the existing original-result collector, same-task recovery issuer and receipt writer. Check for a genuine matching receipt first. Only positive authoritative stopped/writer and effect proof may allow a corrected write under a current, fenced generation. Corrections explain regulated changes; they do not carry authority or replay a provider turn. A stale generation loses to the transaction. If proof is incomplete, expose the original issuer and the specific missing facts and preserve the held state. Any genuinely separate current assessment follows its own existing policy and never settles or reclassifies the original by implication. Verify concurrent correction, delayed writer, baseline change and equal retry against the same protected receipt write.

## Verification and delivery

**VERIFY-APPROVAL-RECOVERY.** Red/green tests model the four changed IDs with no drafts and assert zero dispatch and exact missing IDs. Exercise the same user and coworker after a client change and ordinary source re-admission after expired ownership. Drive a known-stopped eligible original and observe exactly one canonical receipt and baseline advance, including a concurrent attempt. Drive an unknown original, wrong actor, stale source and changed baseline and observe no receipt or replay. Use real PostgreSQL for the receipt race and independent readback. Record source tests, canonical gate, protected delivery and actual served verification separately. No historical task or live S5 approval may be mutated by these tests.

## Boundaries and coverage

One atomic Workroom stage outcome under BI-5345BFC7. Input preflight, durable routing, and fenced correction must agree on the same packet before claiming recovery. Reuse Workroom, TaskRun and the receipt transaction. No new endpoint, scheduler, grant, review engine, approval policy or data store. Preserve older packet compatibility outside the amended spec-approval path. No Windows, production repair, preview launch or reassessment of the live S5 attempt in this source slice.

Current coverage is pending exact immutable publication, independent design disposition and the normal plan coverage check. The prior S5 approval and the paired execution remain separately governed under BI-AE2EF5E4. Coordinate the stage boundary with BI-B62B218E and original settlement with BI-7906C73E.
