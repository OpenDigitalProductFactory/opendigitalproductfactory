---
status: draft
---

# Workrooms concrete next-action implementation

**Backlog item:** BI-E8542C82

Design: [Recorded next actions](../specs/2026-10-31-workrooms-recorded-next-actions.md). One atomic refactor; phases are sequencing, not independent features. DOC-82684072 / WC-4933D363.

## Backlog coverage

- Decision: atomic
- Parent: BI-E8542C82
- Receipt: blocked-by: no initiative scope baseline exists for BI-E8542C82; the independent reviewer must approve the immutable canonical design before plan coverage and implementation can proceed.
- Rationale: the safe projection, its grouped rendering and regression/served proof are one correction to the same existing owner read path; none independently delivers a trustworthy next action.
- Dependencies: existing Atlas health and liveness/recovery projections; no takeover of BI-B3D87B06 or its A1/A2/A3 implementation.
- Mapping: recorded-next-action -> BI-E8542C82

## Required owner outcomes

- AC-1: Default page separates demonstrably working, waiting and attention from retained history; leases alone never imply progress. Counts label bounded reads honestly.
- AC-2: Each actionable room names its recorded accountable person or honestly says unassigned, and gives a supported next step without inventing automatic recovery.
- AC-3: Lease timers, UUIDs, branches and diagnostic metrics are hidden behind labelled disclosures; keyboard and narrow viewport remain usable.
- AC-4: Repeated held causes are summarized once with affected room count and honest recovery guidance, preserving every case link and original evidence.
- AC-5: One existing inventory/read model serves unscoped and portfolio views. Compact loading and deferred history/diagnostics reduce default payload or rendered content with measured before/after evidence; no per-room DB queries or timer refresh.
- AC-6: Existing expiry grace/reaper safety and active holder protections remain unchanged and are tested; outcomes needing a person have an accountable recovery path.
- AC-7: Affected tests, typechecks, proportional guards, protected PR/merge, canonical deployment and actual desktop/narrow browser happy path prove delivery.

## Ordered phases

1. Resolve impact and all affected tests before source edits. Exact paths: workroom-operator-summary.ts/test; liveness-inventory.ts/test; WorkroomActivitySection.tsx/test; WorkroomInventory.tsx/test; HeldWorkroomsList.tsx/test; held-workrooms.ts/test; workroom-drive-state.ts/test only if required for safe recorded attention. Keep all canonical health and reaper states unchanged.
2. RED: fixtures for founder accountability versus actual requester, source prerequisite, unresolved review, executor missing-result, real recorded attention versus status-only, missing actor/action, lease waiting, heterogeneous grouped remedies, and omission of private recovery packet/tool/history fields.
3. GREEN: extend the existing safe summary and bounded projection; expose only plain actor/action display. Reuse canonical recovery and existing case links. Group rendering may use a shared condition only when all members agree. Never replay a task or widen access.
4. Keep technical evidence behind disclosure, localize UI text through workrooms messages, update workspace/work-rooms guide and UX evidence. Review My Work summary sentinel against existing case carrier; no new task substrate.
5. Execute related tests, both web typechecks, prose/style and all impact-contract guards. Obtain independent source review and served UX critique. Current native review outcome uncertainty is not approval or permission to retry.
6. Protected signed PR/merge and canonical release. Verify real owner attention/next actor/case drill-in, empty/unknown/failure states, keyboard/narrow layout and authorized fixture save/readback. Record exact unrun checks instead of passing them.

## Four-way traceability

Requirement: BI-E8542C82 AC-2.
Contract: Safe action presentation preserves canonical health and authority.
Flow: Existing Workrooms inventory and grouped recovery to the original room.
Verification: Actor/action negative controls and served owner readback.

## Risk and rollback

A wrong next actor can misroute work; private packet serialization can expose restricted history. Negative tests and a display allowlist protect these boundaries. A generic status is never a decision. Revert only the display extension through a signed PR; no schema or stored-work mutation.
