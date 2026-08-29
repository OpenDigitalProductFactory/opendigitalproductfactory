---
status: active
---

# Durable Self-Upgrade Admission and Dispatch Reconciliation Plan

**Backlog item:** BI-3FD07259
**Workroom:** WC-25858CAB
**Branch:** `fix/durable-self-upgrade-admission-and-dispatch-reco`

## Outcome

One server-issued `SelfUpgradeRun` identity survives response loss, delayed queue
acceptance, dispatch failure, process restart, and duplicate delivery. The
Upgrade Center remains truthful and cannot invite a second click while the first
request is unresolved.

## Atomic implementation

1. Add the `SelfUpgradeDispatchStatus` enum and the minimal target, fingerprint,
   force, lease, attempt, acknowledgement, and failure fields to
   `SelfUpgradeRun`; add a forward-only migration and data-impact manifest.
2. Write failing run-store/admission tests for atomic admission, same-fingerprint
   reuse, active-run exclusion, dispatch leasing, acknowledgement, ambiguous
   failure, definite failure, target drift, newer-run refusal, and worker CAS.
3. Implement `admission.ts` as the single target-binding and dispatch state
   boundary. Refactor action/request callers to admit first, return the run id,
   and schedule the same dispatcher with Next.js `after()`.
4. Give every send the stable `self-upgrade:<runId>` event id. Persist returned
   event ids and make the worker claim the row by compare-and-swap before any
   preflight or physical action.
5. Add boot and periodic reconciliation for eligible pending/indeterminate rows,
   using the same lease and dispatch function. Preserve exact target/force
   binding and existing quiescence checks.
6. Write failing UI tests for the two red fixtures and for every durable dispatch
   state. Remove the 45-second local unlock and render calm, actionable status
   from the canonical row without adding another control.
7. Run focused and affected tests, web typecheck, migration validation,
   data-impact/prose/style guards, preflight, semantic review, and exact-tree
   local CI. Publish one DCO-signed PR and require every protected PR and
   merge-group check.
8. Create one canonical release from the protected merge, require publisher and
   release-mode clean-install success, perform one governed self-upgrade, and
   prove exact served SHA, data preservation, health, durable admission identity,
   dispatch reconciliation, and CAN-TEST before resuming BI-F48.

## Expected source surface

- `packages/db/prisma/schema/build-delivery.prisma`
- `packages/db/prisma/migrations/20260829040000_self_upgrade_admission_reconciliation/migration.sql`
- `docs/data-impact/2026-08-29-self-upgrade-admission-reconciliation.data-impact.json`
- `apps/web/lib/self-upgrade/admission.ts`
- `apps/web/lib/self-upgrade/admission.test.ts`
- `apps/web/lib/self-upgrade/run-store.ts`
- `apps/web/lib/self-upgrade/run-store.test.ts`
- `apps/web/lib/self-upgrade/request.ts`
- `apps/web/lib/self-upgrade/request.test.ts`
- `apps/web/lib/actions/promotions.ts`
- `apps/web/lib/actions/promotions.self-upgrade.test.ts`
- `apps/web/lib/queue/functions/self-upgrade.ts`
- `apps/web/lib/queue/functions/self-upgrade.test.ts`
- `apps/web/instrumentation.ts`
- `apps/web/instrumentation.test.ts`
- `apps/web/components/ops/SelfUpgradeTriggerControl.tsx`
- `apps/web/components/ops/SelfUpgradeTriggerControl.test.tsx`
- `apps/web/components/ops/SelfUpgradeTriggerControl.swap-resilience.test.tsx`

## Design grounding

- Existing design and plan reviewed:
  `docs/superpowers/specs/2026-08-29-self-upgrade-admission-reconciliation-design.md`
  and this atomic implementation plan. The separate BI-6CB35411 consumer
  start-path design remains the owner of install-tag and runtime-identity
  convergence; it is a delivery prerequisite, not source scope for BI-3FD07259.
- Current code substrate inspected: `SelfUpgradeRun` persistence and status
  projection, the self-upgrade server action and request boundary, the Inngest
  worker and boot instrumentation, and the Upgrade Center trigger control.
- Source of truth: the server-owned `SelfUpgradeRun` admission row, including its
  immutable release target, actor/force fingerprint, dispatch state, lease,
  attempt, acknowledgement, and terminal failure evidence.
- Architectural decision: commit admission before asynchronous dispatch; reuse
  one stable event identity; reconcile ambiguous delivery against the same row;
  acquire worker execution by compare-and-swap; and project the durable state to
  the UI so an unknown disposition cannot re-enable the control.
- Rejected boundary crossings: no client-generated admission identity, no
  synthesized dispatch success, no direct queue retry that changes target or
  force, no emergency-override expansion, and no edits to BI-6CB35411-owned
  start/restart or install-identity paths.

## Risks and rollback

The primary risk is treating an ambiguous dispatch as a rejection or allowing a
stale retry to target a different release. The admission fingerprint, immutable
stored target, stable event id, transaction lease, latest-run guard, and worker
CAS make both paths fail closed. Rollback is a protected revert; new nullable
dispatch metadata remains compatible with historical rows and requires no data
destruction.

## Backlog coverage

- Decision: atomic
- Parent: BI-3FD07259
- Receipt: blocked — no initiative scope baseline exists for BI-3FD07259; the
  atomic table below records the server-submitted mapping without claiming a
  receipt
- Rationale: schema, admission, dispatch, reconciliation, worker CAS, and UI
  projection are one safety contract. Shipping only a subset either keeps the
  ambiguous click, creates an unrecoverable pending row, or permits duplicate
  physical execution.
- Dependencies: none for source delivery; BI-6CB35411 remains a separate live
  runtime-identity prerequisite if tag/SHA/config identity does not converge.

| Deliverable key | Backlog item | Independently shippable | Requirement refs | Contract refs | Flow refs | Verification refs |
| --- | --- | --- | --- | --- | --- | --- |
| `durable-self-upgrade-admission` | BI-3FD07259 | no | OBJ-SUA-001, OBJ-SUA-002, OBJ-SUA-003, OBJ-SUA-004 | admission-transaction, dispatch-state-machine, consumer-cas, operator-projection | admit-return, post-response-dispatch, boot-reconcile, worker-claim, live-upgrade | AC-SUA-001, AC-SUA-002, AC-SUA-003, AC-SUA-004, AC-SUA-005, AC-SUA-006, AC-SUA-007, AC-SUA-008 |
