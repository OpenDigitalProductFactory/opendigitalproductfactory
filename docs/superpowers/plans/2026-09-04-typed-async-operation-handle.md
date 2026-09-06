---
status: draft
---

# Implementation plan: typed asynchronous provider-operation handle

**Backlog item:** BI-2B619BC9
**Spec:** `docs/superpowers/specs/2026-09-04-typed-async-operation-handle-design.md`

## Ordered fix sequence

1. Add RED tests proving the provider operation identity is lost between adapter, inference, fallback, and routed persistence, while sync results remain unchanged.
2. Add one typed `AsyncOperationStartResult` and propagate it without reading provider `raw` data as authority.
3. Replace the obsolete Gemini start/poll shapes with the current background Interactions API, keep the interaction ID opaque, and reject unsupported providers before dispatch.
4. Persist a truthful zero-token start audit row, the existing platform `AsyncInferenceOp`, and fallback downgrade provenance before the background return.
5. Run focused and adjacent inference/routing tests, web typecheck, source guards, DCO, and all protected PR checks. Record an unavailable local capacity gate as inconclusive; never infer a PASS from it.

## Backlog coverage

- Decision: atomic
- Parent: `BI-2B619BC9`
- Rationale: The typed provider handle, current provider protocol, accepted-start persistence, and fallback provenance share one compatibility boundary; no phase is safe or independently useful without the others.
- Typed asynchronous provider-operation handle through inference fallback -> `BI-2B619BC9`
- Dependencies: none
- Receipt: `cmtmuvg2c0b6n01pbdzk075ae`

This plan atomically covers BI-2B619BC9 only. It restores the existing provider-start tracking boundary but deliberately does not claim the durable digest, CAS lease, worker/reconciliation, cursor-read, or notification outcomes owned by BI-801313EB and BI-05D7A0DC.

## Traceability

`FLOW-ASYNC-HANDLE-01` is the ordered sequence above: prove the lost handle, introduce the typed contract, use the supported provider protocol, persist the accepted start and routing provenance, then verify the complete slice.

| Deliverable | Requirement refs | Contract refs | Flow refs | Verification refs |
| --- | --- | --- | --- | --- |
| Typed asynchronous provider-operation handle (atomic, not independently shippable) | OBJ-ASYNC-HANDLE-01, OBJ-ASYNC-HANDLE-02, OBJ-ASYNC-HANDLE-03, OBJ-ASYNC-HANDLE-04 | AsyncOperationStartResult, AsyncInferenceOp | FLOW-ASYNC-HANDLE-01 | AC-ASYNC-HANDLE-01, AC-ASYNC-HANDLE-02, AC-ASYNC-HANDLE-03, AC-ASYNC-HANDLE-04 |

## Rollback

Revert the typed-handle slice as one commit. No schema migration is involved and historical `AsyncInferenceOp` rows remain readable.
