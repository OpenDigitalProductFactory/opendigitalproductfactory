---
status: draft
---

# Local served-context transaction implementation plan

**Backlog:** BI-041CD15B  
**Design:** `docs/superpowers/specs/2026-11-03-local-context-transaction-contract-design.md`  
**Workroom:** WC-2BD45483  
**Branch:** `fix/local-context-transaction-contract`

## Outcome

An authorized context change becomes one verified, durable, reversible transaction. Operator changes and boot reconciliation share the same policy and coordinator; routing never advertises more context than DMR verifies.

## Acceptance baseline

- AC-ONE-POLICY: Operator mutation and boot reconciliation use one context transaction and no contradictory above-estimate rules remain.
- AC-ORDER: Durable intent and routing projection never advance before exact-model DMR readback verifies the requested value.
- AC-COMMIT: Success leaves PlatformConfig, verified DMR service, and every matching local ModelProfile consistent.
- AC-ROLLBACK: Every failure boundary either restores the captured state or returns recovery-required while routing to the lower verified bound.
- AC-RECONCILE: Restart preserves a committed operator choice and repairs drift without inventing or silently clamping intent.
- AC-DIAGNOSTICS: Operator evidence distinguishes requested, estimated, model maximum, live, committed, qualified, and rollback values.
- AC-AUTHORITY: Existing manage-providers authorization remains; sensitivity, grants, coworker floors, routing admission, and deadlines do not change.
- AC-QUALIFICATION: Source tests and DMR configuration are never presented as live capacity or semantic-review qualification.
- AC-UX: Any changed operator surface passes independent desktop, narrow, keyboard, focus, announcement, contrast, and recovery review.

## Atomic backlog coverage

This plan is atomic under BI-041CD15B. Policy extraction alone leaves split writes; transaction code without reconciliation leaves restart drift; reconciliation without rollback can still misroute work. The deliverables therefore ship together.

| Deliverable | Design acceptance | Result |
| --- | --- | --- |
| D1 policy and receipt contract | AC-ONE-POLICY, AC-DIAGNOSTICS, AC-AUTHORITY | One pure decision model and typed transaction outcome |
| D2 transaction coordinator | AC-ORDER, AC-COMMIT, AC-ROLLBACK | Verified DMR prepare, database commit, compensation |
| D3 action/reconcile adoption | AC-ONE-POLICY, AC-RECONCILE | Both entry points use D2 and preserve permissions |
| D4 UX and governed verification | AC-DIAGNOSTICS, AC-QUALIFICATION, AC-UX | Honest operator states and independent evidence |

## Phase 1 — Red tests and contract extraction

1. Add `build-studio.test.ts` cases proving the current defect: an operator value accepted by reconcile policy is rejected by the action, and a successful action does not persist the reconcile target. `[D1, AC-ONE-POLICY]`
2. Add reconcile tests for stale PlatformConfig, DMR, and ModelProfile combinations. Assert that routing never exceeds verified live context. `[D1, AC-ORDER, AC-RECONCILE]`
3. Define pure input facts, decision states, structured receipt, and rollback status. Include separate fields for requested, estimated ceiling, model maximum, live before/readback, durable before/after, profile before/after, and qualified maximum. `[D1, AC-DIAGNOSTICS]`
4. Extract the shared policy evaluator without changing behavior beyond eliminating the contradiction demonstrated by the red tests. Above-estimate operator requests require explicit confirmation; reconciler honors only committed pins. `[D1, AC-ONE-POLICY, AC-AUTHORITY]`

## Phase 2 — Transaction coordinator

1. Add injected DMR and persistence ports so every boundary is deterministic in unit tests. Keep the production adapter server-only. `[D2, AC-ORDER]`
2. Implement before-state capture, DMR apply, exact-model readback, and a single Prisma transaction for PlatformConfig plus matching ModelProfile rows. `[D2, AC-COMMIT]`
3. Add failing-then-green tests for DMR refusal, timeout, mismatched readback, database commit failure, successful compensation, failed compensation, and projection repair. `[D2, AC-ROLLBACK]`
4. On unverified compensation, project the lower verified bound and return `recovery-required`; never swallow the error or return success. `[D2, AC-ROLLBACK]`

## Phase 3 — Adopt at both entry points

1. Refactor `applyLocalModelContext()` to preserve `manage_providers`, validate its public inputs, call the coordinator, and map the structured receipt to its UI-facing result. `[D3, AC-AUTHORITY]`
2. Refactor `reconcileLocalModelContext()` to resolve the selected model and delegate mutation/projection to the same coordinator. Preserve no-model, unsupported, unreachable, and deferred meanings. `[D3, AC-RECONCILE]`
3. Delete duplicated ceiling decisions, profile persistence, and contradictory comments once parity coverage is green. Keep unrelated keep-alive/speculation behavior intact. `[D3, AC-ONE-POLICY]`
4. Prove idempotence: repeated reconcile at committed state performs no writes; restart after operator commit converges to the committed value. `[D3, AC-RECONCILE]`

## Phase 4 — Operator experience and verification

1. If the existing form cannot present the receipt honestly, claim its exact files before editing. Show serving now, requested, estimated, and qualified facts; use progressive technical details for transaction and rollback evidence. `[D4, AC-DIAGNOSTICS, AC-UX]`
2. Add component tests for blocked, provisional confirmation, committed, rolled-back, deferred, and recovery-required states; cover keyboard, focus, status announcement, narrow layout, and permission-disabled behavior. `[D4, AC-UX]`
3. Run focused tests after each red/green step, then affected graph tests, typechecks, style/prose guards, generated-document checks, and exact-head canonical CI. This worktree is source-only, so unavailable local gates must be recorded rather than claimed. `[D4, AC-QUALIFICATION]`
4. Obtain independent architecture/design acceptance before implementation, and independent semantic and UX-fit assessment before publication. Deliver through DCO, protected merge, canonical deployment, and post-deployment verification. `[D4, AC-UX]`
5. Keep live 81,920 qualification separate. Do not mutate model, context, grants, or routing during source delivery. A later authorized qualification follows the design's staged evidence and verified rollback contract. `[D4, AC-QUALIFICATION]`

## Refactor budget

Reserve approximately 20% of implementation effort for consolidating the policy evaluator, transaction coordinator, persistence projection, receipt types, and obsolete branches/comments. Refactoring stays within claimed served-context files and must be protected by parity tests.

## Stop conditions

- Stop before implementation if independent design or architecture admission is not approved.
- Stop and revise the design if DMR cannot provide model-specific readback after configuration.
- Stop if a database transaction cannot update intent and all matching profiles consistently; do not substitute best-effort writes.
- Stop if compensation cannot establish a conservative verified routing value.
- Stop before any live context mutation or capacity probe unless the D62 owner confirms its qualification is complete and a new governed runtime authorization exists.

