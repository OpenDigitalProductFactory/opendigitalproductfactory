---
status: active
---

# Local inventory unknown states — BI-A50B677E

## Design grounding

This small fix extends [local-model management](../specs/2026-08-24-local-model-management-design.md), especially R10 (management authorization) and C6 (honest unknowns), and the background-operation observation contract. Reviewed `OllamaManagement.tsx`, the status route, `useBackgroundOperationObserver`, and native DMR inventory. DMR owns installed facts; an initial empty client snapshot is not a successful inventory read. Preserve permission and intentional provider disable.

## Atomic delivery

One deliverable: truthful inventory presentation. Restricted, loading, failed, stale, and successful-empty are one observation contract and must ship together. No provider enable, inference request, permission expansion, schema or new route is included.

Traceability references: `REQ-HONEST-INVENTORY`, `CONTRACT-MANAGEMENT-AUTH`, `FLOW-INVENTORY-OBSERVATION`, `VERIFY-INVENTORY-STATES`.

## Implementation

1. Keep the management observer in an authorized child. The existing wrapper renders an explicit restricted state without mounting the observer for read-only viewers.
2. Derive inventory knowledge from `observedAt`, not array length. First load has no count. Failure before success has no empty state. Failure after success retains the known rows with a stale label. Successful empty alone recommends choosing a model.
3. Add failing behavior tests for restricted, initial, failed-empty, stale, and successful-empty states. Reuse the existing inventory component and observer; keep theme tokens and existing navigation/actions.
4. Run the colocated component suite, status-route authorization suite, local adapter/operations suites, web typechecks, prose/style guards and canonical pregate. Confirm source identity in runner output.

## UX and documentation

Platform owns the surface; the operator needs to know whether model inventory is known. No navigation or new control is added. Native inventory and routing eligibility remain distinct. UX critique requested as CE-3925EA14; no completed critique is claimed. Existing local-model design requires honest failure states; amend its failure-state explanation in the same branch. The original inventory UI remains the prototype substrate; the corrected state table is exercised in component fixtures before runtime verification.

## Risk and rollback

Risk: moving the observer boundary could reset local UI state on a permission change. Mounting/unmounting the authorized child is intended. Server authorization remains unchanged. Revert the UI commit to roll back; no persistent data is changed.

## Backlog coverage

Parent and atomic deliverable: BI-A50B677E. Workroom: WC-96C5E150. Immutable plan coverage is recorded before implementation; the live receipt is authoritative.

## Verification limits

DEV native `/models` and `/v1/models` return Qwen3.8 27B and Nomic; this proves inventory reachability, not tool use or routing. Scoped endpoint tests returned no endpoints because local was intentionally disabled under BI-734C1534. ChatGPT connection is investigated in another chat. PROD is read-only.
