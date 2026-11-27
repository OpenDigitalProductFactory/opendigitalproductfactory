# S5 single-assessment compatibility implementation plan

**Status:** draft sequencing, no live coverage receipt or implementation admission yet.
**Item:** BI-5EF67818. **Workroom:** WC-75CCF40B, delivery-large@1.0.0.
**Design:** [exact compatibility design](../specs/2026-11-27-s5-single-assessment-compatibility-design.md).

For agentic workers: execute this plan as one independently reviewable backlog item, one branch and one PR. Use DPF test-first implementation, the governed local merged-code gate and DCO publication process.

## Delivery boundary

This is one atomic compatibility deliverable. Decoder, original binding validation, lineage scope and transaction ceiling must ship together: shipping only a parser leaves admission refusing, while shipping a widened admission without shared validation risks excessive authority. Independent policy approval, original issuer correction and read_task_result transport are separate existing obligations, not children or approvals granted by this plan.

## Phase 1: establish the immutable design and admission

The human selected the new closed version and confirmed existing operator shared-platform funding on 2026-11-27. DI-9CEEEA881A93 remains an unusable kernel consultation, not a verdict. Verify the exact item funding binding and high-sensitivity scope. Obtain ordinary independent design/spec approval, plan review and live coverage. Claim exact source/test/doc paths before edits. Bind the actual checkout/head; do not use another Workroom or baseline. Resolve every testImpact, guardObligation and docsImpact from gate context. An unresolved contract expands verification.

Deliverable: immutable approved design and plan, coverage receipt and implementation-ready verdict. No implementation before these exist.

## Phase 2: shared closed policy shape, binding and legacy proof

Expected homes: apps/web/lib/mcp-task-reassessment-policy.ts and its tests; mcp-task-review-reassessment.ts and preparation/authority tests. Use existing binding parsing and canonical JSON. Follow the approved version option; preserve v1 bytes/digests and expose no arbitrary subject allocation. A proposed new version must pin the exact original binding and reject mixed policy blocks. Red tests first, then minimal shared validator changes.

Verification: AC-S5-1, AC-S5-2 and AC-S5-3. Mutation cases include duplicate JSON keys, extra keys, unsupported versions, other subjects, second gate/requirement, changed tuple and missing or stale independent policy proof. Source test success is not an independent policy approval.

## Phase 3: consistent atomic one-subject allocation

Expected homes: mcp-task-reassessment-admission.ts and admission tests/PostgreSQL tests; mcp-task-reassessment-lineage.ts and its pure/PostgreSQL tests. Derive the wider exact-S5 subject allocation inventory from server-validated policy, preserve legacy inventory semantics and existing ordered locks. Remove only duplicated shape-specific assumptions, not authority checks. Count accepted present tasks across all artifact/policy/key/family/reviewer variations. A matching exact winner may be joined; consumed/conflicting or incomplete histories refuse.

Verification: AC-S5-4 and AC-S5-3. Real PostgreSQL races prove at most one accepted task, including cancellation/uncertainty/failure, changed artifact, changed policy baseline, stale source and malformed/truncated inventory. No real historical original or production fixture is used.

## Phase 4: execution propagation and governed delivery

Expected homes: existing reassessment worker, authority, capture and version-qualification owners only where source impact proves changes necessary; do not create a parallel engine. Verify immutable policy semantics survive preparation/worker/writer and runtime seals. Reuse existing negative suites and legitimate passing evidence. Update the owning authorization runbook after claiming it.

Verification: AC-S5-5 and AC-S5-6, affected unit tests and web source/test typechecks, applicable guard/doc checks, real race tests and exact-source shared canonical gate after a legitimate Mac reservation. Run independent source review once the actual evidence is ready. All new changes use a DCO-signed PR and normal protected merge. PR links and supported watch ownership follow T3 delivery rules.

## Phase 5: canonical verification and status reconciliation

Use request_self_upgrade only when an advance is needed. Require mandatory preflight CAN-TEST for the actual merged feature before served qualification. Use an independently authorized inert fixture, not a real S5 assessment or old-task replay, and prove positive/refusal behavior. If canonical qualification is unavailable, record the exact dependency and owner, not a pass. Record source/delivery/runtime identities and reconcile this item's true status without silently completing S5's independent policy or issuer work.

## Coverage references

Single proposed deliverable: S5-COMPAT -> BI-5EF67818.
requirementRefs: OBJ-S5-SHAPE, OBJ-S5-BOUND, OBJ-S5-ONE, OBJ-S5-LEGACY, OBJ-S5-PROOF.
contractRefs: CONTRACT-S5-POLICY, CONTRACT-S5-BINDING, CONTRACT-S5-ONE, CONTRACT-S5-AUTHORITY, CONTRACT-S5-EXECUTION.
flowRefs: FLOW-S5-PREP, FLOW-S5-ADMIT, FLOW-S5-VERIFY.
verificationRefs: AC-S5-1, AC-S5-2, AC-S5-3, AC-S5-4, AC-S5-5, AC-S5-6.

Live plan coverage is NOT YET RECORDED. These are draft references, not a fabricated receipt. Bind the approved immutable design/plan and submit normal atomic coverage before implementation; copy the actual resulting receipt here only when obtained.

## Stop conditions and rollback

Stop at an actual authority/refusal, unresolved independent baseline, unknown allocation pool or unsafe compatibility/restore proof. Preserve artifacts and historical effects, report the exact owner remedy and continue unrelated authorized work. Do not force claims, create policy-of-policy retries, swap credentials or reduce gates. Code rollback cannot erase spent allocations or active fences; disabling new admission may be safer than an unsupported downgrade.
